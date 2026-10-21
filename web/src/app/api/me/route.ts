// GET /api/me — current user + fresh CSRF token.

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { currentUser } from "@/lib/auth/api";
import { signCsrf } from "@/lib/auth/sessions";
import { meGamificationView } from "@/lib/courses/apiViews";
import { isOnboarded, isOnboardingSkipped } from "@/lib/onboarding/complete";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauth" }, { status: 401 });
  const db = getDb();
  const row = db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).get();
  return Response.json({
    user: { id: user.id, displayName: user.displayName, language: user.language },
    csrf: signCsrf(user.sessionId),
    onboarded: isOnboarded(row),
    skipped: isOnboardingSkipped(row),
    gamification: meGamificationView(db, user.id),
  });
}
