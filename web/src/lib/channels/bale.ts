// Bale Bot API client — port of legacy bale_adapter/client.py (tapi.bale.ai).

import type { BotClient, InlineKeyboard } from "./types";
import { keyboardToPayload } from "./types";
import { env } from "@/lib/env";

export class BaleClient implements BotClient {
  readonly channel = "bale" as const;
  private readonly base: string;
  private readonly token: string;

  constructor(token: string, baseUrl: string) {
    this.token = token;
    this.base = baseUrl.replace(/\/$/, "");
  }

  static fromEnv(): BaleClient {
    return new BaleClient(env.baleToken(), env.baleApiBase());
  }

  private url(method: string): string {
    return `${this.base}/bot${this.token}/${method}`;
  }

  private fileUrl(filePath: string): string {
    return `${this.base}/file/bot${this.token}/${filePath}`;
  }

  async call(method: string, payload?: Record<string, unknown>): Promise<unknown> {
    const r = await fetch(this.url(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw new Error(`bale ${method} http ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = (await r.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!data.ok) throw new Error(`bale ${method} not ok: ${data.description ?? ""}`);
    return data.result;
  }

  async sendMessage(chatId: string, text: string, opts?: { keyboard?: InlineKeyboard }): Promise<number> {
    const result = (await this.call("sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: keyboardToPayload(this.channel, opts?.keyboard),
    })) as { message_id: number };
    return result.message_id;
  }

  async sendChatAction(chatId: string): Promise<void> {
    // Cosmetic — never let it break a turn (legacy behaviour).
    try {
      await this.call("sendChatAction", { chat_id: chatId, action: "typing" });
    } catch (e) {
      console.warn("[bale] chat action failed:", String(e));
    }
  }

  async answerCallback(callbackQueryId: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: callbackQueryId });
  }

  async getFile(fileId: string): Promise<string> {
    const result = (await this.call("getFile", { file_id: fileId })) as { file_path: string };
    return result.file_path;
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const r = await fetch(this.fileUrl(filePath), { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`bale download http ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }

  async setMyCommands(commands: { command: string; description: string }[]): Promise<void> {
    try {
      await this.call("setMyCommands", { commands });
    } catch (e) {
      console.warn("[bale] setMyCommands failed:", String(e));
    }
  }
}
