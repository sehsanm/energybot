// POST /api/bills/:id/insights — (re)generate insights for a bill.

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { badCsrf, csrfGuard, currentUser, unauth } from "@/lib/auth/api";
import { priorBill } from "@/lib/billing/service";
import { generateSuggestions, targetsAsGoals } from "@/lib/billing/suggestions";
import { replaceGoalsForBill } from "@/lib/profile/goals";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await currentUser();
  if (!user) return unauth();
  if (!csrfGuard(req, user.sessionId)) return badCsrf();
  const { id } = await ctx.params;
  const db = getDb();
  const bill = db
    .select()
    .from(schema.bills)
    .where(eq(schema.bills.id, id))
    .get();
  if (!bill || bill.userId !== user.id) return Response.json({ error: "not found" }, { status: 404 });

  const profile = db.select().from(schema.profiles).where(eq(schema.profiles.userId, user.id)).get();
  const prev = priorBill(db, user.id, bill.billId, bill.createdAt);
  const payload = await generateSuggestions(
    { utilityType: bill.utilityType, amount: bill.amount, term: bill.term, details: JSON.parse(bill.details ?? "{}") },
    profile ? { household: JSON.parse(profile.household), behaviour: JSON.parse(profile.behaviour) } : null,
    prev ? { utilityType: prev.utilityType, amount: prev.amount, term: prev.term, details: JSON.parse(prev.details ?? "{}") } : null,
  );
  if (!payload) return Response.json({ error: "generation failed" }, { status: 502 });
  db.update(schema.bills).set({ suggestions: JSON.stringify(payload) }).where(eq(schema.bills.id, id)).run();
  replaceGoalsForBill(db, user.id, id, targetsAsGoals(payload.targets, id));
  return Response.json({ ok: true, suggestions: payload });
}
