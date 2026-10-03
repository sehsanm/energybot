// Chat pipeline with the AI provider mocked: context assembly, KB grounding,
// memory extraction + cap/disable. Uses a fixture KB dir for deterministic hits.

import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, now, schema, type DB } from "@/lib/db";

const aiState = vi.hoisted(() => ({ calls: [] as any[], reply: "پاسخ تست", memoryReply: "{}" }));

vi.mock("@/lib/ai/provider", () => ({
  aiChat: async (messages: any[]) => {
    aiState.calls.push(messages);
    // The memory extraction prompt is distinguishable by its header line.
    const isMemory = messages.some((m) => m.content.includes("سامانه‌ی حافظه"));
    const content = isMemory ? aiState.memoryReply : aiState.reply;
    if (content === "__THROW__") throw new Error("boom");
    return { content, model: "test" };
  },
  aiConfigured: () => true,
}));

import { answerChat, extractMemory } from "@/lib/chat/pipeline";
import { ensureSeeded } from "@/lib/kb/repository";
import { resolveUser } from "@/lib/bot/identity";
import { addMemory, listMemories, renderMemory } from "@/lib/chat/memoryRepository";

const SEED_DIR = [path.resolve(__dirname, "fixtures", "kb")];

function seededDb(): DB {
  const db = makeTestDb();
  ensureSeeded(db, SEED_DIR);
  return db;
}

function seedUser(db: DB, withProfile = true) {
  const { user } = resolveUser("bale", { externalId: "1" }, db);
  if (withProfile) {
    db.update(schema.profiles)
      .set({
        household: JSON.stringify({ city: "تبریز", occupants: "۴", main_utility: "gas" }),
        behaviour: JSON.stringify({ onb_step: null }),
        goals: JSON.stringify([{ text: "کاهش ۱۰٪ گاز", status: "active" }]),
      })
      .where(eq(schema.profiles.userId, user.id))
      .run();
  }
  return user;
}

beforeEach(() => {
  aiState.calls = [];
  aiState.reply = "پاسخ تست";
  aiState.memoryReply = "{}";
});
afterEach(() => vi.unstubAllEnvs());

describe("answerChat (AI mocked)", () => {
  it("assembles persona + profile + bill + memory + KB into the system prompt", async () => {
    const db = seededDb();
    const user = seedUser(db);
    addMemory(user.id, "constraint", "صاحبخانه اجازهٔ تعویض پکیج نمی‌دهد", db);

    const res = await answerChat(user.id, "دمای پکیج را چند بگذارم؟", db);
    expect(res.reply).toBe("پاسخ تست");
    expect(res.kbHitTitles[0]).toBe("تنظیم پکیج و شوفاژ"); // bm25 ranks the on-topic article first

    const system = aiState.calls[0][0].content;
    expect(system).toContain("دستیار صرفه‌جویی انرژی");
    expect(system).toContain("تبریز"); // profile
    expect(system).toContain("کاهش ۱۰٪ گاز"); // goals
    expect(system).toContain("قبضی ثبت نشده است."); // latest bill line
    expect(system).toContain("[1] صاحبخانه"); // memory with id marker
    expect(system).toContain("منبع 1 — «تنظیم پکیج و شوفاژ»"); // KB block with citation title
  });

  it("sends rolling history + the new message in order", async () => {
    const db = seededDb();
    const user = seedUser(db);
    const t = now();
    for (const [role, content] of [
      ["user", "سؤال قبلی"],
      ["bot", "جواب قبلی"],
      ["user", "قبض را فرستادم"],
      ["bot", "📄 قبض برق"],
    ] as const) {
      db.insert(schema.messages).values({ userId: user.id, channel: "bale", role, content, createdAt: t }).run();
    }
    await answerChat(user.id, "سؤال جدید", db);
    const msgs = aiState.calls[0];
    expect(msgs.map((m: any) => m.role)).toEqual(["system", "user", "assistant", "user", "assistant", "user"]);
    expect(msgs.at(-1).content).toBe("سؤال جدید");
  });

  it("no KB hit → honest-disclaimer block instead of sources", async () => {
    const db = seededDb();
    const user = seedUser(db, false);
    await answerChat(user.id, "سؤال بی‌ربط دربارهٔ سیاست", db);
    const system = aiState.calls[0][0].content;
    expect(system).toContain("مطلبی در دانش‌نامه پیدا نشد");
    expect(system).not.toContain("منبع 1");
  });

  it("propagates AI failures to the caller (surfaces show friendly errors)", async () => {
    const db = seededDb();
    const user = seedUser(db, false);
    aiState.reply = "__THROW__";
    await expect(answerChat(user.id, "سلام", db)).rejects.toThrow("boom");
  });
});

describe("extractMemory (AI mocked)", () => {
  it("applies add + remove from the extraction JSON", async () => {
    const db = seededDb();
    const user = seedUser(db, false);
    const keep = addMemory(user.id, "preference", "پاسخ کوتاه می‌خواهد", db)!;
    const drop = addMemory(user.id, "misc", "نکتهٔ قدیمی", db)!;
    aiState.memoryReply = JSON.stringify({
      add: [{ category: "constraint", text: "شیفت شب کار می‌کند" }],
      remove_ids: [drop.id],
    });

    await extractMemory(user.id, "من شیفت شب کار می‌کنم", "باشه", db);
    const memories = listMemories(user.id, db);
    expect(memories.map((m) => m.id)).not.toContain(drop.id);
    expect(memories.some((m) => m.text === "شیفت شب کار می‌کند")).toBe(true);
    expect(memories.some((m) => m.id === keep.id)).toBe(true);
    expect(keep.id).toBeGreaterThan(0);
  });

  it("never exceeds the 40-item cap", async () => {
    const db = makeTestDb();
    const user = seedUser(db, false);
    for (let i = 0; i < 39; i++) addMemory(user.id, "misc", `نکته ${i}`, db);
    aiState.memoryReply = JSON.stringify({
      add: [
        { category: "misc", text: "اضافه اول" },
        { category: "misc", text: "اضافه دوم" },
        { category: "misc", text: "اضافه سوم" },
      ],
    });
    await extractMemory(user.id, "x", "y", db);
    expect(listMemories(user.id, db).length).toBe(40); // 39 + 1, cap held
  });

  it("respects AI_MEMORY_ENABLED=false and tolerates bad JSON", async () => {
    vi.stubEnv("AI_MEMORY_ENABLED", "false");
    const db = seededDb();
    const user = seedUser(db, false);
    await extractMemory(user.id, "x", "y", db);
    expect(aiState.calls.length).toBe(0); // short-circuited

    vi.stubEnv("AI_MEMORY_ENABLED", "true");
    aiState.memoryReply = "نه جیسون";
    await expect(extractMemory(user.id, "x", "y", db)).resolves.toBeUndefined(); // swallowed
    expect(listMemories(user.id, db)).toHaveLength(0);
  });
});

describe("memory render (legacy render_memory port)", () => {
  it("groups by category with [id] markers", () => {
    const db = makeTestDb();
    const user = seedUser(db, false);
    addMemory(user.id, "misc", "نکته پراکنده", db);
    addMemory(user.id, "preference", "اتاق خنک دوست دارد", db);
    const text = renderMemory(listMemories(user.id, db));
    expect(text).toContain("آنچه درباره‌ی کاربر می‌دانم:");
    expect(text.indexOf("ترجیحات")).toBeLessThan(text.indexOf("سایر"));
    expect(text).toMatch(/\[\d+\] اتاق خنک دوست دارد/);
  });
});
