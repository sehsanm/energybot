// Deliver an outbound message to a user over their channel — the thin
// predecessor of the full DeliveryService (fans out to every identity).

import { eq } from "drizzle-orm";
import { getDb, now, schema, type DB } from "@/lib/db";
import { env } from "@/lib/env";
import type { BotClient } from "./types";

export async function botClientFor(channel: string): Promise<BotClient | null> {
  if (channel === "bale" && env.baleEnabled() && env.baleToken()) {
    const { BaleClient } = await import("./bale");
    return BaleClient.fromEnv();
  }
  if (channel === "telegram" && env.telegramEnabled() && env.telegramToken()) {
    const { TelegramClient } = await import("./telegram");
    return TelegramClient.fromEnv();
  }
  return null;
}

/** Send to every enabled identity of the user; returns channels delivered to. */
export async function deliverToUser(
  userId: string,
  text: string,
  db: DB = getDb(),
): Promise<string[]> {
  const identities = db.select().from(schema.userIdentities).where(eq(schema.userIdentities.userId, userId)).all();
  const delivered: string[] = [];
  for (const identity of identities) {
    const client = await botClientFor(identity.channel);
    if (!client) continue;
    try {
      await client.sendMessage(identity.externalId, text);
      delivered.push(identity.channel);
    } catch (e) {
      console.error(`[deliver] ${identity.channel} send failed:`, e);
    }
  }
  if (delivered.length) {
    db.insert(schema.messages)
      .values({ userId, channel: delivered[0], role: "admin", content: text.slice(0, 4000), createdAt: now() })
      .run();
  }
  return delivered;
}
