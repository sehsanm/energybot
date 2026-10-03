import { describe, expect, it } from "vitest";
import { makeTestDb } from "@/lib/db";
import { Poller } from "@/lib/channels/poller";
import type { BotClient } from "@/lib/channels/types";

class FakeBot implements BotClient {
  readonly channel = "bale" as const;
  calls: { method: string; payload?: Record<string, unknown> }[] = [];
  queue: Record<string, any>[][] = [];
  failMethods = new Set<string>();
  private poller: Poller | null = null;

  bind(p: Poller): void {
    this.poller = p;
  }

  async call(method: string, payload?: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method, payload });
    if (this.failMethods.has(method)) throw new Error(`${method} failed`);
    if (method === "getUpdates") {
      if (this.queue.length) return this.queue.shift()!;
      // Queue drained: stop the loop so run() returns in tests.
      this.poller?.stop();
      return [];
    }
    return {};
  }
  async sendMessage(): Promise<number> {
    return 1;
  }
  async sendChatAction(): Promise<void> {}
  async answerCallback(): Promise<void> {}
  async getFile(): Promise<string> {
    return "f";
  }
  async downloadFile(): Promise<Buffer> {
    return Buffer.alloc(0);
  }
  async setMyCommands(): Promise<void> {}
}

function msg(updateId: number, text: string): Record<string, any> {
  return { update_id: updateId, message: { from: { id: 7 }, chat: { id: 7 }, text } };
}

async function drain(bot: FakeBot, db = makeTestDb(), seen: unknown[] = []): Promise<void> {
  const poller = new Poller(
    bot,
    0,
    async (u) => {
      seen.push(u);
    },
    db,
  );
  bot.bind(poller);
  await poller.run();
}

describe("Poller", () => {
  it("deletes the webhook first, processes updates in order, advances the offset", async () => {
    const bot = new FakeBot();
    bot.queue = [[msg(10, "a"), msg(11, "b")], [msg(12, "c")]];
    const seen: unknown[] = [];
    await drain(bot, undefined, seen);

    expect(bot.calls[0].method).toBe("deleteWebhook");
    expect(seen.map((u) => (u as any).update_id)).toEqual([10, 11, 12]);
    const getUpdates = bot.calls.filter((c) => c.method === "getUpdates");
    expect(getUpdates[1].payload?.offset).toBe(12); // last of batch [10,11] + 1
    expect(getUpdates[2].payload?.offset).toBe(13);
  });

  it("skips updates already processed (dedup persists across poller restarts)", async () => {
    const db = makeTestDb();
    const first = new FakeBot();
    first.queue = [[msg(10, "a")]];
    await drain(first, db);

    const second = new FakeBot();
    second.queue = [[msg(10, "a"), msg(11, "b")]]; // 10 redelivered
    const seen: unknown[] = [];
    await drain(second, db, seen);
    expect(seen.map((u) => (u as any).update_id)).toEqual([11]); // only the new one
  });

  it("survives a throwing handler and keeps consuming", async () => {
    const bot = new FakeBot();
    bot.queue = [[msg(10, "boom"), msg(11, "ok")]];
    const seen: unknown[] = [];
    const db = makeTestDb();
    const poller = new Poller(
      bot,
      0,
      async (u) => {
        if ((u as any).update_id === 10) throw new Error("poison update");
        seen.push(u);
      },
      db,
    );
    bot.bind(poller);
    await poller.run();
    expect(seen.map((u) => (u as any).update_id)).toEqual([11]);
  });

  it("swallows deleteWebhook failures and still polls", async () => {
    const bot = new FakeBot();
    bot.failMethods.add("deleteWebhook");
    bot.queue = [[msg(1, "x")]];
    const seen: unknown[] = [];
    await drain(bot, undefined, seen);
    expect(bot.calls[0].method).toBe("deleteWebhook");
    expect(seen).toHaveLength(1);
  });
});
