// POST /api/admin/login {email, password} — rate-limited (per IP, in-memory).

import { createSession, signCsrf, ADMIN_COOKIE, ADMIN_SESSION_DAYS } from "@/lib/auth/sessions";
import { findAdminByEmail } from "@/lib/admin/bootstrap";
import { verifyPassword } from "@/lib/admin/password";

export const runtime = "nodejs";

const hits = new Map<string, number[]>();
const WINDOW = 60_000;
const CAP = 10;

export async function POST(req: Request): Promise<Response> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const nowTs = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => nowTs - t < WINDOW);
  if (recent.length >= CAP) return Response.json({ error: "too many attempts" }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { email?: string; password?: string } | null;
  if (!body?.email || !body?.password) return Response.json({ error: "bad request" }, { status: 400 });
  const admin = await findAdminByEmail(body.email);
  const ok = admin ? await verifyPassword(admin.passwordHash, body.password) : false;
  if (!ok) {
    recent.push(nowTs);
    hits.set(ip, recent);
    return Response.json({ error: "invalid credentials" }, { status: 401 });
  }
  const { cookieValue, sessionId } = createSession("admin", { adminId: admin!.id });
  const res = Response.json({ ok: true, admin: { email: admin!.email }, csrf: signCsrf(sessionId) });
  res.headers.append(
    "Set-Cookie",
    `${ADMIN_COOKIE}=${cookieValue}; Path=/; Max-Age=${ADMIN_SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax`,
  );
  return res;
}
