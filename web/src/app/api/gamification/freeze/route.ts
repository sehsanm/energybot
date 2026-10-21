// POST /api/gamification/freeze — buy a streak freeze for 5 coins. The client
// sends nothing: eligibility (max one held freeze) and the coin balance are
// decided entirely by purchaseFreeze server-side, transactionally.

import { getDb } from "@/lib/db";
import { badCsrf, csrfGuard, currentUser, unauth } from "@/lib/auth/api";
import { purchaseFreeze } from "@/lib/gamification/awards";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const user = await currentUser();
  if (!user) return unauth();
  if (!csrfGuard(req, user.sessionId)) return badCsrf();

  const outcome = purchaseFreeze(getDb(), user.id, Date.now());
  if (!outcome.ok) return Response.json({ error: outcome.error }, { status: 400 });
  return Response.json({ freezes: outcome.freezes, coins: outcome.coins });
}
