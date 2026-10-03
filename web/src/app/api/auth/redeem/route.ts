// POST /api/auth/redeem {t: '<magic token from the bot's /web>'}

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { redeemLoginToken } from "@/lib/auth/loginTokens";
import { createSession, signCsrf, USER_COOKIE, USER_SESSION_DAYS } from "@/lib/auth/sessions";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { t?: string } | null;
  if (!body?.t) return Response.json({ error: "bad request" }, { status: 400 });
  const db = getDb();
  const userId = redeemLoginToken(body.t, db);
  if (!userId) return Response.json({ error: "invalid token" }, { status: 401 });
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user || user.isBlocked) return Response.json({ error: "inactive" }, { status: 401 });
  const { cookieValue, sessionId } = createSession("user", { userId }, db);
  const res = Response.json({
    ok: true,
    user: { id: user.id, displayName: user.displayName },
    csrf: signCsrf(sessionId),
  });
  const secure = env.publicBaseUrl().startsWith("https://") ? "; Secure" : "";
  res.headers.append(
    "Set-Cookie",
    `${USER_COOKIE}=${cookieValue}; Path=/; Max-Age=${USER_SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`,
  );
  return res;
}
