// GET/PUT /api/profile — household basics that feed bill insights.

import { getDb } from "@/lib/db";
import { badCsrf, csrfGuard, unauth, currentUser } from "@/lib/auth/api";
import { applyProfileUpdate, readProfile } from "@/lib/profile/apiUpdate";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return unauth();
  // household + goals (ProfileScreen) and behaviour (wizard resume, spec §6).
  return Response.json(readProfile(getDb(), user.id));
}

export async function PUT(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return unauth();
  if (!csrfGuard(req, user.sessionId)) return badCsrf();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "bad request" }, { status: 400 });

  const { household, behaviour } = applyProfileUpdate(getDb(), user.id, body);
  return Response.json({ ok: true, household, behaviour });
}
