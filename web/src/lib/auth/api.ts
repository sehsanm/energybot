// Server helpers for route handlers: session extraction + CSRF guard.

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb, schema, type DB } from "@/lib/db";
import { ADMIN_COOKIE, USER_COOKIE, csrfOk, getSession } from "./sessions";

export interface ApiUser {
  id: string;
  displayName: string | null;
  language: string;
  sessionId: string;
}

export async function currentUser(db: DB = getDb()): Promise<ApiUser | null> {
  const jar = await cookies();
  const s = getSession("user", jar.get(USER_COOKIE)?.value, db);
  if (!s?.userId) return null;
  const u = db.select().from(schema.users).where(eq(schema.users.id, s.userId)).get();
  if (!u || u.isBlocked) return null;
  return { id: u.id, displayName: u.displayName, language: u.language, sessionId: s.sessionId };
}

export interface ApiAdmin {
  id: string;
  email: string;
  sessionId: string;
}

export async function currentAdmin(db: DB = getDb()): Promise<ApiAdmin | null> {
  const jar = await cookies();
  const s = getSession("admin", jar.get(ADMIN_COOKIE)?.value, db);
  if (!s?.adminId) return null;
  const a = db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, s.adminId)).get();
  if (!a) return null;
  return { id: a.id, email: a.email, sessionId: s.sessionId };
}

/** Mutating requests must carry the double-submit CSRF header. */
export function csrfGuard(req: Request, sessionId: string): boolean {
  return csrfOk(sessionId, req.headers.get("x-csrf"));
}

export function unauth(): Response {
  return Response.json({ error: "unauth" }, { status: 401 });
}

export function badCsrf(): Response {
  return Response.json({ error: "bad csrf" }, { status: 403 });
}
