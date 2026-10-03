// Telegram Bot API client. ALL traffic routes through TELEGRAM_PROXY_URL
// (Iran network constraint — arvan-zar proxy), via an undici ProxyAgent.

import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";
import type { BotClient, InlineKeyboard } from "./types";
import { keyboardToPayload } from "./types";
import { env } from "@/lib/env";

export class TelegramClient implements BotClient {
  readonly channel = "telegram" as const;
  private readonly base: string;
  private readonly token: string;
  private readonly dispatcher: Dispatcher | undefined;

  constructor(token: string, baseUrl: string, proxyUrl: string) {
    this.token = token;
    this.base = baseUrl.replace(/\/$/, "");
    this.dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  }

  static fromEnv(): TelegramClient {
    return new TelegramClient(env.telegramToken(), env.telegramApiBase(), env.telegramProxyUrl());
  }

  private url(method: string): string {
    return `${this.base}/bot${this.token}/${method}`;
  }

  private fileUrl(filePath: string): string {
    return `${this.base}/file/bot${this.token}/${filePath}`;
  }

  private async fetch(url: string, init: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<Response> {
    // A hung proxy connection must not stall the strictly-sequential poller
    // for undici's default 300s (legacy used httpx.Timeout(30) everywhere).
    return undiciFetch(url, {
      ...init,
      dispatcher: this.dispatcher,
      signal: AbortSignal.timeout(timeoutMs),
    }) as unknown as Response;
  }

  async call(method: string, payload?: Record<string, unknown>): Promise<unknown> {
    // getUpdates long-polls for `timeout` seconds — the request timeout must
    // exceed it; everything else gets the standard 60s.
    const isPoll = method === "getUpdates" && typeof payload?.timeout === "number";
    const r = await this.fetch(
      this.url(method),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      },
      isPoll ? Number(payload!.timeout) * 1000 + 30_000 : 60_000,
    );
    if (!r.ok) throw new Error(`telegram ${method} http ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = (await r.json()) as { ok: boolean; result?: unknown; description?: string };
    if (!data.ok) throw new Error(`telegram ${method} not ok: ${data.description ?? ""}`);
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
    try {
      await this.call("sendChatAction", { chat_id: chatId, action: "typing" });
    } catch (e) {
      console.warn("[telegram] chat action failed:", String(e));
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
    const r = await this.fetch(this.fileUrl(filePath));
    if (!r.ok) throw new Error(`telegram download http ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }

  async setMyCommands(commands: { command: string; description: string }[]): Promise<void> {
    try {
      await this.call("setMyCommands", { commands });
    } catch (e) {
      console.warn("[telegram] setMyCommands failed:", String(e));
    }
  }
}
