// POST /api/auth/logout — works for both user and admin sessions.

import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { ADMIN_COOKIE, USER_COOKIE, deleteSession } from "@/lib/auth/sessions";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const jar = await cookies();
  const db = getDb();
  deleteSession(jar.get(USER_COOKIE)?.value, db);
  deleteSession(jar.get(ADMIN_COOKIE)?.value, db);
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${USER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  res.headers.append("Set-Cookie", `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  return res;
}
