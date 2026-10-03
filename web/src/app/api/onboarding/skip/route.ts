// POST /api/onboarding/skip — persist the wizard's «بعداً» (idempotent, no body).
// Mirrors /api/onboarding/complete: session + CSRF, lib write, no event.

import { getDb } from "@/lib/db";
import { badCsrf, csrfGuard, unauth, currentUser } from "@/lib/auth/api";
import { markOnboardingSkipped } from "@/lib/onboarding/complete";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return unauth();
  if (!csrfGuard(req, user.sessionId)) return badCsrf();
  markOnboardingSkipped(getDb(), user.id);
  return Response.json({ ok: true, skipped: true });
}
