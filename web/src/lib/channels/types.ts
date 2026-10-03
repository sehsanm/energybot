// Channel-agnostic bot client surface. Adapters: bale.ts, telegram.ts.

export type Channel = "bale" | "telegram";

export interface InlineButton {
  text: string;
  callbackData?: string;
  url?: string;
  /** Mini-app launch button: Telegram renders a native web_app button, Bale a plain URL. */
  webAppUrl?: string;
}

export interface InlineKeyboard {
  inline: InlineButton[][];
}

export interface PlatformUserRef {
  externalId: string;
  displayName?: string | null;
  username?: string | null;
  payload?: Record<string, unknown>;
}

export interface BotClient {
  readonly channel: Channel;
  sendMessage(chatId: string, text: string, opts?: { keyboard?: InlineKeyboard }): Promise<number>;
  sendChatAction(chatId: string): Promise<void>;
  answerCallback(callbackQueryId: string): Promise<void>;
  getFile(fileId: string): Promise<string>;
  downloadFile(filePath: string): Promise<Buffer>;
  setMyCommands(commands: { command: string; description: string }[]): Promise<void>;
  /** Raw API call — used by the poller (getUpdates/deleteWebhook/getMe). */
  call(method: string, payload?: Record<string, unknown>): Promise<unknown>;
}

/** Map normalized keyboard to the platform payload shape. Shared by both adapters. */
export function keyboardToPayload(
  channel: Channel,
  kb: InlineKeyboard | undefined,
): Record<string, unknown> | undefined {
  if (!kb) return undefined;
  const rows = kb.inline.map((row) =>
    row.map((b) => {
      if (b.callbackData) return { text: b.text, callback_data: b.callbackData };
      if (b.webAppUrl) {
        return channel === "telegram"
          ? { text: b.text, web_app: { url: b.webAppUrl } }
          : { text: b.text, url: b.webAppUrl };
      }
      if (b.url) return { text: b.text, url: b.url };
      return { text: b.text, callback_data: b.text };
    }),
  );
  return { inline_keyboard: rows };
}
