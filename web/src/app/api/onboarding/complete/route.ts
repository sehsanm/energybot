// POST /api/onboarding/complete — mark the wizard done (idempotent).

import { getDb } from "@/lib/db";
import { badCsrf, csrfGuard, unauth, currentUser } from "@/lib/auth/api";
import { markOnboarded } from "@/lib/onboarding/complete";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return unauth();
  if (!csrfGuard(req, user.sessionId)) return badCsrf();
  const body = (await req.json().catch(() => ({}))) as { source?: unknown };
  const source = body.source === undefined ? "app" : body.source;
  if (source !== "app" && source !== "bot") {
    return Response.json({ error: "bad source" }, { status: 400 });
  }
  markOnboarded(getDb(), user.id, source);
  return Response.json({ ok: true, onboarded: true });
}
