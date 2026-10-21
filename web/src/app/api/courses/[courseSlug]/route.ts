// GET /api/courses/:courseSlug — the course detail the lesson player boots
// from: full lesson definitions + the caller's state + per-item audio flags,
// one request. Session-gated (playing is an authed flow); the shape lives in
// lib/courses/apiViews so it stays testable against a plain test db.

import { getDb } from "@/lib/db";
import { currentUser, unauth } from "@/lib/auth/api";
import { courseDetailView } from "@/lib/courses/apiViews";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ courseSlug: string }> },
): Promise<Response> {
  const user = await currentUser();
  if (!user) return unauth();
  const { courseSlug } = await ctx.params;
  const view = courseDetailView(getDb(), user.id, courseSlug);
  if (!view) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(view);
}
