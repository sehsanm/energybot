// POST /api/admin/bills/:id/insights {send?: boolean} — regenerate insights,
// optionally deliver the rendered text to the user's bot channel.

import { eq } from "drizzle-orm";
import { getDb, now, schema } from "@/lib/db";
import { badCsrf, csrfGuard, currentAdmin, unauth } from "@/lib/auth/api";
import { priorBill } from "@/lib/billing/service";
import { generateSuggestions, renderSuggestions } from "@/lib/billing/suggestions";
import { deliverToUser } from "@/lib/channels/deliver";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const admin = await currentAdmin();
  if (!admin) return unauth();
  if (!csrfGuard(req, admin.sessionId)) return badCsrf();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { send?: boolean };

  const db = getDb();
  const bill = db.select().from(schema.bills).where(eq(schema.bills.id, id)).get();
  if (!bill) return Response.json({ error: "not found" }, { status: 404 });
  const profile = db.select().from(schema.profiles).where(eq(schema.profiles.userId, bill.userId)).get();
  const prev = priorBill(db, bill.userId, bill.billId, bill.createdAt);
  const payload = await generateSuggestions(
    { utilityType: bill.utilityType, amount: bill.amount, term: bill.term, details: JSON.parse(bill.details ?? "{}") },
    profile ? { household: JSON.parse(profile.household), behaviour: JSON.parse(profile.behaviour) } : null,
    prev ? { utilityType: prev.utilityType, amount: prev.amount, term: prev.term, details: JSON.parse(prev.details ?? "{}") } : null,
  );
  if (!payload) return Response.json({ error: "generation failed" }, { status: 502 });
  db.update(schema.bills).set({ suggestions: JSON.stringify(payload) }).where(eq(schema.bills.id, id)).run();

  let delivered: string[] = [];
  if (body.send) {
    delivered = await deliverToUser(bill.userId, renderSuggestions(payload));
  }
  db.insert(schema.auditLog).values({
    adminId: admin.id,
    action: body.send ? "bill.insights_regenerate_send" : "bill.insights_regenerate",
    entityType: "bill",
    entityId: id,
    meta: JSON.stringify({ model: payload.model, delivered }),
    createdAt: now(),
  }).run();
  return Response.json({ ok: true, suggestions: payload, delivered });
}
