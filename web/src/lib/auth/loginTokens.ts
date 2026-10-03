// One-time magic login tokens minted by the bot's /web command — port of
// legacy user_api/tokens.py (5-minute TTL, single use, sha256-stored).

import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, now, schema, type DB } from "@/lib/db";

export const LOGIN_TOKEN_TTL_MINUTES = 5;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export async function mintLoginToken(userId: string, db: DB = getDb()): Promise<string> {
  const raw = randomBytes(24).toString("base64url");
  db.insert(schema.loginTokens)
    .values({
      tokenHash: hashToken(raw),
      userId,
      expiresAt: now() + LOGIN_TOKEN_TTL_MINUTES * 60_000,
      createdAt: now(),
    })
    .run();
  return raw;
}

/** Redeem a token: single-use, expiry-checked. Returns the user id or null. */
export function redeemLoginToken(raw: string, db: DB = getDb()): string | null {
  const row = db
    .select()
    .from(schema.loginTokens)
    .where(eq(schema.loginTokens.tokenHash, hashToken(raw)))
    .get();
  if (!row) return null;
  if (row.usedAt !== null || row.expiresAt < now()) return null;
  db.update(schema.loginTokens).set({ usedAt: now() }).where(eq(schema.loginTokens.tokenHash, row.tokenHash)).run();
  return row.userId;
}
