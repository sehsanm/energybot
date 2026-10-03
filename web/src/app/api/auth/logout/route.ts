// POST /api/auth/logout — works for both user and admin sessions.
// CSRF-guarded like every other mutation (a cross-site form must not be able
// to force-logout a signed-in user/admin).

import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { ADMIN_COOKIE, USER_COOKIE, csrfOk, deleteSession, getSession } from "@/lib/auth/sessions";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const jar = await cookies();
  const db = getDb();
  const userSid = getSession("user", jar.get(USER_COOKIE)?.value, db)?.sessionId;
  const adminSid = getSession("admin", jar.get(ADMIN_COOKIE)?.value, db)?.sessionId;
  const sid = userSid ?? adminSid;
  if (sid && !csrfOk(sid, req.headers.get("x-csrf"))) {
    return Response.json({ error: "bad csrf" }, { status: 403 });
  }
  deleteSession(jar.get(USER_COOKIE)?.value, db);
  deleteSession(jar.get(ADMIN_COOKIE)?.value, db);
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${USER_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  res.headers.append("Set-Cookie", `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  return res;
}
