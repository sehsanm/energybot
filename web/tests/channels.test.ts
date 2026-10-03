import { afterEach, describe, expect, it, vi } from "vitest";
import { keyboardToPayload } from "@/lib/channels/types";
import { BaleClient } from "@/lib/channels/bale";
import { TelegramClient } from "@/lib/channels/telegram";

// TelegramClient imports fetch + ProxyAgent from undici directly — mock the module.
const undiciCalls = vi.hoisted(() => [] as { url: string; dispatcher?: unknown }[]);
vi.mock("undici", () => ({
  fetch: async (url: string, init: { dispatcher?: unknown }) => {
    undiciCalls.push({ url: String(url), dispatcher: init?.dispatcher });
    if (String(url).includes("/file/")) return new Response("image-bytes");
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1, file_path: "docs/x.jpg" } }), {
      status: 200,
    });
  },
  ProxyAgent: class {
    constructor(public url: string) {}
  },
}));

describe("keyboardToPayload", () => {
  it("maps callback buttons identically on both platforms", () => {
    const kb = { inline: [[{ text: "نکات", callbackData: "insights:x" }]] };
    expect(keyboardToPayload("bale", kb)).toEqual({
      inline_keyboard: [[{ text: "نکات", callback_data: "insights:x" }]],
    });
    expect(keyboardToPayload("telegram", kb)).toEqual(keyboardToPayload("bale", kb));
  });

  it("renders mini-app buttons natively on Telegram, as plain URLs on Bale", () => {
    const kb = { inline: [[{ text: "اپ", webAppUrl: "https://x.test/" }]] };
    expect(keyboardToPayload("telegram", kb)).toEqual({
      inline_keyboard: [[{ text: "اپ", web_app: { url: "https://x.test/" } }]],
    });
    expect(keyboardToPayload("bale", kb)).toEqual({
      inline_keyboard: [[{ text: "اپ", url: "https://x.test/" }]],
    });
  });

  it("passes through url buttons and falls back to callback_data for bare text", () => {
    expect(keyboardToPayload("bale", { inline: [[{ text: "لینک", url: "https://t.me" }]] })).toEqual({
      inline_keyboard: [[{ text: "لینک", url: "https://t.me" }]],
    });
    expect(keyboardToPayload("bale", { inline: [[{ text: "خاموش" }]] })).toEqual({
      inline_keyboard: [[{ text: "خاموش", callback_data: "خاموش" }]],
    });
    expect(keyboardToPayload("bale", undefined)).toBeUndefined();
  });
});

function okBody(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

describe("BaleClient", () => {
  it("posts sendMessage with the normalized keyboard and returns the message id", async () => {
    const seen: { url: string; body: any }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)) });
      return okBody({ message_id: 42 });
    });
    const c = new BaleClient("tok", "https://bale.test");
    const id = await c.sendMessage("123", "سلام", {
      keyboard: { inline: [[{ text: "بزن", callbackData: "go" }]] },
    });
    expect(id).toBe(42);
    expect(seen[0].url).toBe("https://bale.test/bottok/sendMessage");
    expect(seen[0].body).toEqual({
      chat_id: "123",
      text: "سلام",
      reply_markup: { inline_keyboard: [[{ text: "بزن", callback_data: "go" }]] },
    });
  });

  it("throws with the platform description on ok=false", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ ok: false, description: "chat not found" }), { status: 200 }),
    );
    const c = new BaleClient("tok", "https://bale.test");
    await expect(c.sendMessage("1", "x")).rejects.toThrow(/chat not found/);
  });

  it("answers callbacks with the callback_query_id", async () => {
    const seen: any[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(JSON.parse(String(init.body)));
      return okBody({});
    });
    await new BaleClient("tok", "https://bale.test").answerCallback("cb-9");
    expect(seen[0].callback_query_id).toBe("cb-9");
  });
});

describe("TelegramClient", () => {
  it("routes every request through the configured proxy dispatcher", async () => {
    undiciCalls.length = 0;
    const c = new TelegramClient("ttok", "https://tg.test", "http://arvan-zar:8080");
    await c.sendMessage("99", "سلام");
    expect(undiciCalls[0].url).toBe("https://tg.test/botttok/sendMessage");
    expect(undiciCalls[0].dispatcher).toBeInstanceOf(Object); // ProxyAgent attached
  });

  it("downloads files from the file endpoint", async () => {
    undiciCalls.length = 0;
    const c = new TelegramClient("ttok", "https://tg.test", "");
    expect((await c.downloadFile(await c.getFile("fid"))).toString()).toBe("image-bytes");
    expect(undiciCalls.some((x) => x.url.includes("/file/botttok/docs/x.jpg"))).toBe(true);
  });
});
