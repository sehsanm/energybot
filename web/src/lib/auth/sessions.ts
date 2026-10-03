// Sessions for both user (mini app / magic link) and admin — port of legacy
// core/security.py + user_api/auth.py semantics (sha256-id cookies, CSRF HMAC).

import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb, now, schema, type DB } from "@/lib/db";
import { env } from "@/lib/env";

export const USER_COOKIE = "energybot_user";
export const ADMIN_COOKIE = "energybot_admin";
export const USER_SESSION_DAYS = 30;
export const ADMIN_SESSION_DAYS = 7;

export function sessionCookieValue(): string {
  return randomBytes(36).toString("base64url");
}

export function sessionIdFor(cookieValue: string): string {
  return createHash("sha256").update(cookieValue, "utf8").digest("hex");
}

export function signCsrf(sid: string): string {
  return createHmac("sha256", env.sessionSecret()).update(sid, "utf8").digest("hex");
}

export function createSession(
  kind: "user" | "admin",
  ref: { userId?: string; adminId?: string },
  db: DB = getDb(),
): { cookieValue: string; sessionId: string; expiresAt: number } {
  const cookieValue = sessionCookieValue();
  const sessionId = sessionIdFor(cookieValue);
  const days = kind === "user" ? USER_SESSION_DAYS : ADMIN_SESSION_DAYS;
  const expiresAt = now() + days * 86_400_000;
  db.insert(schema.sessions)
    .values({
      id: sessionId,
      kind,
      userId: ref.userId ?? null,
      adminId: ref.adminId ?? null,
      issuedAt: now(),
      expiresAt,
    })
    .run();
  return { cookieValue, sessionId, expiresAt };
}

export function getSession(
  kind: "user" | "admin",
  cookieValue: string | undefined | null,
  db: DB = getDb(),
): { sessionId: string; userId?: string; adminId?: string } | null {
  if (!cookieValue) return null;
  const sid = sessionIdFor(cookieValue);
  const row = db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.id, sid), eq(schema.sessions.kind, kind), gt(schema.sessions.expiresAt, now())))
    .get();
  if (!row) return null;
  return { sessionId: row.id, userId: row.userId ?? undefined, adminId: row.adminId ?? undefined };
}

export function deleteSession(cookieValue: string | undefined | null, db: DB = getDb()): void {
  if (!cookieValue) return;
  db.delete(schema.sessions).where(eq(schema.sessions.id, sessionIdFor(cookieValue))).run();
}

/** CSRF guard for mutating requests — double-submit header pattern. */
export function csrfOk(sessionId: string | undefined, header: string | null | undefined): boolean {
  if (!sessionId) return false;
  return !!header && header === signCsrf(sessionId);
}
