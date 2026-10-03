import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, schema, type DB } from "@/lib/db";
import { handleBotUpdate } from "@/lib/bot/handler";
import { resolveUser } from "@/lib/bot/identity";
import type { BotClient, InlineKeyboard } from "@/lib/channels/types";
import { copy } from "@/content/copy";

interface Sent {
  chatId: string;
  text: string;
  keyboard?: InlineKeyboard;
}

class FakeBot implements BotClient {
  readonly channel: "bale" | "telegram";
  sent: Sent[] = [];
  callbacksAnswered: string[] = [];
  fixtureFile: Buffer = Buffer.alloc(0);

  constructor(channel: "bale" | "telegram" = "bale") {
    this.channel = channel;
  }

  async sendMessage(chatId: string, text: string, opts?: { keyboard?: InlineKeyboard }): Promise<number> {
    this.sent.push({ chatId, text, keyboard: opts?.keyboard });
    return this.sent.length;
  }
  async sendChatAction(): Promise<void> {}
  async answerCallback(id: string): Promise<void> {
    this.callbacksAnswered.push(id);
  }
  async getFile(): Promise<string> {
    return "path";
  }
  async downloadFile(): Promise<Buffer> {
    return this.fixtureFile;
  }
  async setMyCommands(): Promise<void> {}
  async call(): Promise<unknown> {
    return {};
  }
  texts(): string[] {
    return this.sent.map((s) => s.text);
  }
}

function textUpdate(fromId: number, text: string): Record<string, any> {
  return { update_id: Math.floor(Math.random() * 1e9), message: { from: { id: fromId, first_name: "تست" }, chat: { id: fromId }, text } };
}
function photoUpdate(fromId: number): Record<string, any> {
  return { update_id: Math.floor(Math.random() * 1e9), message: { from: { id: fromId, first_name: "تست" }, chat: { id: fromId }, photo: [{ file_id: "s" }, { file_id: "l" }] } };
}
function callbackUpdate(fromId: number, data: string): Record<string, any> {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    callback_query: { id: "cb1", from: { id: fromId, first_name: "تست" }, data, message: { chat: { id: fromId }, message_id: 5 } },
  };
}

const FIXTURE_PNG = readFileSync(path.resolve(__dirname, "fixtures", "bill_barcode_sample.png"));

describe("bot handler — onboarding-lite", () => {
  it("first /start asks for the city; answer moves to the utility prompt", async () => {
    const db = makeTestDb();
    const bot = new FakeBot();
    await handleBotUpdate(bot, textUpdate(1, "/start"), db);
    expect(bot.sent[0].text).toContain(copy.intro);
    expect(bot.sent[0].text).toContain(copy.onboardingCity);

    await handleBotUpdate(bot, textUpdate(1, "تهران"), db);
    expect(bot.sent[1].text).toBe(copy.onboardingUtility);
    expect(bot.sent[1].keyboard?.inline[0].map((b) => b.callbackData)).toEqual([
      "onb:util:electricity",
      "onb:util:gas",
    ]);

    const { user } = resolveUser("bale", { externalId: "1" }, db);
    const profile = db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).get()!;
    expect(JSON.parse(profile.household).city).toBe("تهران");
  });

  it("utility callback completes onboarding and stores the preference", async () => {
    const db = makeTestDb();
    const bot = new FakeBot();
    await handleBotUpdate(bot, textUpdate(2, "/start"), db);
    await handleBotUpdate(bot, textUpdate(2, "شیراز"), db);
    await handleBotUpdate(bot, callbackUpdate(2, "onb:util:gas"), db);

    expect(bot.callbacksAnswered).toEqual(["cb1"]);
    expect(bot.sent.at(-1)!.text).toContain("شیراز");
    expect(bot.sent.at(-1)!.text).toContain(copy.billPrompt);
    const { user } = resolveUser("bale", { externalId: "2" }, db);
    const profile = db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).get()!;
    expect(JSON.parse(profile.household).main_utility).toBe("gas");
    expect(JSON.parse(profile.behaviour).onb_step).toBeNull();
  });

  it("/start mid-onboarding re-sends the pending step instead of help", async () => {
    const db = makeTestDb();
    const bot = new FakeBot();
    await handleBotUpdate(bot, textUpdate(3, "/start"), db); // city pending
    await handleBotUpdate(bot, textUpdate(3, "/start"), db);
    expect(bot.sent[1].text).toBe(copy.onboardingCity); // resumed, not copy.help
  });

  it("free-typed utility answer also works", async () => {
    const db = makeTestDb();
    const bot = new FakeBot();
    await handleBotUpdate(bot, textUpdate(4, "/start"), db);
    await handleBotUpdate(bot, textUpdate(4, "کرج"), db);
    await handleBotUpdate(bot, textUpdate(4, "قبض گازم"), db);
    const { user } = resolveUser("bale", { externalId: "4" }, db);
    const profile = db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).get()!;
    expect(JSON.parse(profile.household).main_utility).toBe("gas");
  });

  it("/start after onboarding shows help", async () => {
    const db = makeTestDb();
    const bot = new FakeBot();
    await handleBotUpdate(bot, textUpdate(5, "/start"), db);
    await handleBotUpdate(bot, textUpdate(5, "مشهد"), db);
    await handleBotUpdate(bot, callbackUpdate(5, "onb:util:both"), db);
    bot.sent.length = 0;
    await handleBotUpdate(bot, textUpdate(5, "/start"), db);
    expect(bot.sent[0].text).toBe(copy.help);
  });
});

describe("bot handler — bill capture", () => {
  it("a typed bill id captures, summarizes, and spawns insights (fails gracefully without AI)", async () => {
    const db = makeTestDb();
    const bot = new FakeBot();
    await handleBotUpdate(bot, textUpdate(10, "9706459904126"), db);

    const texts = bot.texts();
    expect(texts.some((t) => t.startsWith("📄 قبض برق"))).toBe(true);
    expect(texts).toContain(copy.insightsPending);
    // insights button present on the summary
    const summary = bot.sent.find((s) => s.text.startsWith("📄 قبض"))!;
    expect(summary.keyboard?.inline[0].some((b) => b.callbackData?.startsWith("insights:"))).toBe(true);

    // the fire-and-forget insights task settles into the no-AI failure message
    await new Promise((r) => setTimeout(r, 25));
    expect(bot.texts()).toContain(copy.insightsFailed);

    // user + bill persisted, messages logged
    const { user } = resolveUser("bale", { externalId: "10" }, db);
    const bills = db.select().from(schema.bills).where(eq(schema.bills.userId, user.id)).all();
    expect(bills).toHaveLength(1);
    const logs = db.select().from(schema.messages).where(eq(schema.messages.userId, user.id)).all();
    expect(logs.some((m) => m.role === "user" && m.content === "9706459904126")).toBe(true);
    expect(logs.some((m) => m.role === "bot" && m.content.startsWith("📄 قبض"))).toBe(true);
  });

  it("a bill photo goes through barcode extraction → capture", async () => {
    const db = makeTestDb();
    const bot = new FakeBot();
    bot.fixtureFile = FIXTURE_PNG;
    await handleBotUpdate(bot, photoUpdate(11), db);
    expect(bot.texts().some((t) => t.startsWith("📄 قبض برق"))).toBe(true);
    const { user } = resolveUser("bale", { externalId: "11" }, db);
    expect(db.select().from(schema.bills).where(eq(schema.bills.userId, user.id)).all()).toHaveLength(1);
  });

  it("non-bill documents get rejected after magic-byte sniffing", async () => {
    const db = makeTestDb();
    const bot = new FakeBot();
    bot.fixtureFile = Buffer.from("just some plain text, definitely not an image");
    const upd = {
      update_id: 1,
      message: { from: { id: 12 }, chat: { id: 12 }, document: { file_id: "d", mime_type: "text/plain", file_name: "x.txt" } },
    };
    await handleBotUpdate(bot, upd, db);
    expect(bot.texts()[0]).toContain("فقط عکس"); // sniffed by content, not the .txt name
  });

  it("an invalid typed id is not routed to billing", async () => {
    const db = makeTestDb();
    const bot = new FakeBot();
    await handleBotUpdate(bot, textUpdate(13, "7742890001028"), db); // bad checksum
    expect(bot.texts()).toEqual([copy.fallbackText]);
  });
});

describe("bot handler — callbacks & commands", () => {
  it("blocked users are dropped silently (admin block covers the bot)", async () => {
    const db = makeTestDb();
    const bot = new FakeBot();
    const { user } = resolveUser("bale", { externalId: "30" }, db);
    db.update(schema.users).set({ isBlocked: true }).where(eq(schema.users.id, user.id)).run();
    await handleBotUpdate(bot, textUpdate(30, "/start"), db);
    await handleBotUpdate(bot, callbackUpdate(30, "onb:util:gas"), db);
    expect(bot.sent).toHaveLength(0);
  });

  it("oversized documents get the size message without downloading", async () => {
    const db = makeTestDb();
    const bot = new FakeBot();
    const upd = {
      update_id: 2,
      message: {
        from: { id: 31 },
        chat: { id: 31 },
        document: { file_id: "d", mime_type: "application/pdf", file_name: "big.pdf", file_size: 11 * 1024 * 1024 },
      },
    };
    await handleBotUpdate(bot, upd, db);
    expect(bot.texts()).toEqual([copy.tooLarge]);
  });

  it("insights callback renders stored suggestions without regenerating", async () => {
    const db = makeTestDb();
    const bot = new FakeBot();
    // Seed: user + bill with suggestions already stored
    const { user } = resolveUser("bale", { externalId: "20" }, db);
    db.insert(schema.bills)
      .values({
        id: "b1",
        userId: user.id,
        billId: "9706459904126",
        utilityType: "electricity",
        amount: 1,
        createdAt: Date.now(),
        suggestions: JSON.stringify({ intro: "پیشنهاد ذخیره", tips: ["نکته یک"], targets: [] }),
      })
      .run();
    await handleBotUpdate(bot, callbackUpdate(20, "insights:b1"), db);
    expect(bot.callbacksAnswered).toEqual(["cb1"]);
    expect(bot.sent[0].text).toContain("پیشنهاد ذخیره");
    expect(bot.sent[0].text).toContain("• نکته یک");
  });

  it("/web without PUBLIC_BASE_URL says it is not configured", async () => {
    const db = makeTestDb();
    const bot = new FakeBot();
    await handleBotUpdate(bot, textUpdate(21, "/web"), db);
    expect(bot.texts()).toEqual([copy.webNotConfigured]);
  });

  it("/bill sends the bill prompt and plain text falls back", async () => {
    const db = makeTestDb();
    const bot = new FakeBot();
    await handleBotUpdate(bot, textUpdate(22, "/bill"), db);
    await handleBotUpdate(bot, textUpdate(22, "سلام ربات!"), db);
    expect(bot.texts()[0]).toBe(copy.billPrompt);
    expect(bot.texts()[1]).toBe(copy.fallbackText);
  });
});
