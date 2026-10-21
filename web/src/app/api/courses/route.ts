// GET /api/courses — the course catalog with the caller's progress. Authed:
// per-lesson state/bestAccuracy + `me` gamification stats; anonymous: the
// catalog only (shape decisions live in lib/courses/apiViews).

import { currentUser } from "@/lib/auth/api";
import { coursesCatalogView } from "@/lib/courses/apiViews";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await currentUser();
  return Response.json(coursesCatalogView(getDb(), user?.id ?? null));
}
