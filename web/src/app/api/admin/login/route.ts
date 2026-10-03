// POST /api/admin/login {email, password} — rate-limited (per IP + global caps).

import { env } from "@/lib/env";
import { createSession, signCsrf, ADMIN_COOKIE, ADMIN_SESSION_DAYS } from "@/lib/auth/sessions";
import { findAdminByEmail } from "@/lib/admin/bootstrap";
import { verifyPassword } from "@/lib/admin/password";
import { makeRateLimiter } from "@/lib/auth/rateLimit";

export const runtime = "nodejs";

// Module-level: one limiter per server process. XFF is spoofable when the app
// runs exposed directly, so the global cap is what actually bounds brute force.
const limiter = makeRateLimiter({ windowMs: 60_000, perKeyCap: 10, globalCap: 60 });

export async function POST(req: Request): Promise<Response> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (limiter.hit(ip)) return Response.json({ error: "too many attempts" }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { email?: string; password?: string } | null;
  if (!body?.email || !body?.password) return Response.json({ error: "bad request" }, { status: 400 });
  const admin = await findAdminByEmail(body.email);
  const ok = admin ? await verifyPassword(admin.passwordHash, body.password) : false;
  if (!ok) return Response.json({ error: "invalid credentials" }, { status: 401 });

  const { cookieValue, sessionId } = createSession("admin", { adminId: admin!.id });
  const res = Response.json({ ok: true, admin: { email: admin!.email }, csrf: signCsrf(sessionId) });
  const secure = env.publicBaseUrl().startsWith("https://") ? "; Secure" : "";
  res.headers.append(
    "Set-Cookie",
    `${ADMIN_COOKIE}=${cookieValue}; Path=/; Max-Age=${ADMIN_SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`,
  );
  return res;
}
