// POST /api/auth/miniapp {channel: 'telegram'|'bale', initData}
// Validates the host-signed initData (HMAC), find-or-creates the user via
// their platform identity, issues the web session.

import { env } from "@/lib/env";
import { getDb } from "@/lib/db";
import { resolveUser } from "@/lib/bot/identity";
import { validateInitData } from "@/lib/auth/initData";
import { createSession, signCsrf, USER_COOKIE, USER_SESSION_DAYS } from "@/lib/auth/sessions";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { channel?: string; initData?: string } | null;
  if (!body || (body.channel !== "telegram" && body.channel !== "bale") || !body.initData) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const channel = body.channel;
  const token = channel === "telegram" ? env.telegramToken() : env.baleToken();
  if (!token) return Response.json({ error: "channel not configured" }, { status: 503 });

  const result = validateInitData(body.initData, token);
  if (!result.ok) return Response.json({ error: result.error }, { status: 401 });

  const db = getDb();
  const { user } = resolveUser(channel, {
    externalId: String(result.data.user.id),
    displayName: result.data.user.first_name ?? null,
    username: result.data.user.username ?? null,
    payload: { language_code: (result.data.user as any).language_code ?? null },
  }, db);
  if (user.isBlocked) return Response.json({ error: "inactive" }, { status: 401 });

  const { cookieValue, sessionId } = createSession("user", { userId: user.id }, db);
  const secure = env.publicBaseUrl().startsWith("https://");
  const res = Response.json({
    ok: true,
    user: { id: user.id, displayName: user.displayName },
    csrf: signCsrf(sessionId),
  });
  // SameSite=None only works over https — required inside t.me/web.telegram.org iframes.
  res.headers.append(
    "Set-Cookie",
    `${USER_COOKIE}=${cookieValue}; Path=/; Max-Age=${USER_SESSION_DAYS * 86400}; HttpOnly; SameSite=${secure ? "None" : "Lax"}${secure ? "; Secure" : ""}`,
  );
  return res;
}
