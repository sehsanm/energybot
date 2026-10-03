// Insights success path + the claim guard (legacy set_bill_suggestions_if_absent
// parity), with the AI provider mocked so no network is involved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, schema, type DB } from "@/lib/db";

const aiState = vi.hoisted(() => ({ calls: 0, delayMs: 0, content: "" }));

vi.mock("@/lib/ai/provider", () => ({
  aiChat: async () => {
    aiState.calls++;
    if (aiState.delayMs) await new Promise((r) => setTimeout(r, aiState.delayMs));
    return { content: aiState.content, model: "test-model" };
  },
  aiConfigured: () => true,
}));

const SUGGESTIONS_JSON = JSON.stringify({
  intro: "مصرف این دوره بالاست.",
  tips: ["کولر را تنظیم کن", "ساعت اوج را جا بینداز"],
  targets: [{ text: "کاهش ۱۰٪ مصرف", metric: "total_kwh", baseline: 600, target_value: 540 }],
});

import { handleBotUpdate } from "@/lib/bot/handler";
import { resolveUser } from "@/lib/bot/identity";
import type { BotClient, InlineKeyboard } from "@/lib/channels/types";

class FakeBot implements BotClient {
  readonly channel = "bale" as const;
  sent: { text: string; keyboard?: InlineKeyboard }[] = [];
  answered: string[] = [];
  async sendMessage(_chatId: string, text: string, opts?: { keyboard?: InlineKeyboard }): Promise<number> {
    this.sent.push({ text, keyboard: opts?.keyboard });
    return this.sent.length;
  }
  async sendChatAction(): Promise<void> {}
  async answerCallback(id: string): Promise<void> {
    this.answered.push(id);
  }
  async getFile(): Promise<string> {
    return "p";
  }
  async downloadFile(): Promise<Buffer> {
    return Buffer.alloc(0);
  }
  async setMyCommands(): Promise<void> {}
  async call(): Promise<unknown> {
    return {};
  }
}

function textUpdate(fromId: number, text: string): Record<string, any> {
  return { update_id: Math.random() * 1e9 | 0, message: { from: { id: fromId, first_name: "ت" }, chat: { id: fromId }, text } };
}
function callbackUpdate(fromId: number, data: string): Record<string, any> {
  return {
    update_id: Math.random() * 1e9 | 0,
    callback_query: { id: "cb", from: { id: fromId, first_name: "ت" }, data, message: { chat: { id: fromId }, message_id: 1 } },
  };
}

let db: DB;
let bot: FakeBot;
const settle = () => new Promise((r) => setTimeout(r, 80));

beforeEach(() => {
  db = makeTestDb();
  bot = new FakeBot();
  aiState.calls = 0;
  aiState.delayMs = 0;
  aiState.content = SUGGESTIONS_JSON;
});
afterEach(() => vi.clearAllMocks());

describe("insights flow (AI mocked)", () => {
  it("stores suggestions, adds goals, and renders the Persian layout", async () => {
    await handleBotUpdate(bot, textUpdate(1, "9706459904126"), db);
    await settle();

    const { user } = resolveUser("bale", { externalId: "1" }, db);
    const bill = db.select().from(schema.bills).where(eq(schema.bills.userId, user.id)).get()!;
    expect(bill.suggestions).toBeTruthy();
    expect(JSON.parse(bill.suggestions!).intro).toBe("مصرف این دوره بالاست.");
    expect(aiState.calls).toBe(1);

    const rendered = bot.sent.find((s) => s.text.startsWith("💡"))!;
    expect(rendered.text).toContain("• کولر را تنظیم کن");
    expect(rendered.text).toContain("🎯 هدف‌ها");

    const profile = db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).get()!;
    const goals = JSON.parse(profile.goals) as { text: string; source: string }[];
    expect(goals).toHaveLength(1);
    expect(goals[0].source).toBe("bill_suggestion");
  });

  it("re-tapping the insights button sends stored text without a new AI call", async () => {
    await handleBotUpdate(bot, textUpdate(2, "9706459904126"), db);
    await settle();
    const { user } = resolveUser("bale", { externalId: "2" }, db);
    const bill = db.select().from(schema.bills).where(eq(schema.bills.userId, user.id)).get()!;
    const before = aiState.calls;

    await handleBotUpdate(bot, callbackUpdate(2, `insights:${bill.id}`), db);
    expect(aiState.calls).toBe(before); // served from storage
    const rendered = bot.sent.filter((s) => s.text.startsWith("💡"));
    expect(rendered).toHaveLength(2); // one from generation, one from the tap
  });

  it("claim guard: concurrent generation sends exactly one insights message", async () => {
    aiState.delayMs = 40; // widen the race window
    await handleBotUpdate(bot, textUpdate(3, "9706459904126"), db); // capture spawns task #1
    // Immediately tap the button → task #2 races task #1.
    const summary = bot.sent.find((s) => s.text.startsWith("📄"))!;
    const billRowId = summary.keyboard!.inline[0].find((b) => b.callbackData?.startsWith("insights:"))!.callbackData!.slice(9);
    await handleBotUpdate(bot, callbackUpdate(3, `insights:${billRowId}`), db);
    await settle();

    // Both may have called the LLM, but only ONE rendered message reached the user.
    const rendered = bot.sent.filter((s) => s.text.startsWith("💡"));
    expect(rendered).toHaveLength(1);
    expect(bot.sent.filter((s) => s.text.includes("تدوین پیشنهادها الان ممکن نشد"))).toHaveLength(0);
  });

  it("invalid AI JSON degrades to the failure message without storing", async () => {
    aiState.content = "not json at all";
    await handleBotUpdate(bot, textUpdate(4, "9706459904126"), db);
    await settle();
    const { user } = resolveUser("bale", { externalId: "4" }, db);
    const bill = db.select().from(schema.bills).where(eq(schema.bills.userId, user.id)).get()!;
    expect(bill.suggestions).toBeNull();
    expect(bot.sent.some((s) => s.text.includes("تدوین پیشنهادها الان ممکن نشد"))).toBe(true);
  });
});
