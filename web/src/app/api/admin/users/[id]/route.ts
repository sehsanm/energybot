// GET /api/admin/users/:id — full detail: identities, profile, bills, recent messages.
// POST /api/admin/users/:id — {isBlocked?: boolean} toggles block.

import { desc, eq } from "drizzle-orm";
import { getDb, now, schema } from "@/lib/db";
import { badCsrf, csrfGuard, currentAdmin, unauth } from "@/lib/auth/api";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const admin = await currentAdmin();
  if (!admin) return unauth();
  const { id } = await ctx.params;
  const db = getDb();
  const user = db.select().from(schema.users).where(eq(schema.users.id, id)).get();
  if (!user) return Response.json({ error: "not found" }, { status: 404 });
  const identities = db.select().from(schema.userIdentities).where(eq(schema.userIdentities.userId, id)).all();
  const profile = db.select().from(schema.profiles).where(eq(schema.profiles.userId, id)).get();
  const bills = db
    .select()
    .from(schema.bills)
    .where(eq(schema.bills.userId, id))
    .orderBy(desc(schema.bills.createdAt))
    .limit(20)
    .all();
  const messages = db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.userId, id))
    .orderBy(desc(schema.messages.createdAt))
    .limit(100)
    .all();
  return Response.json({
    user: {
      id: user.id,
      displayName: user.displayName,
      isBlocked: user.isBlocked,
      createdAt: user.createdAt,
      lastSeenAt: user.lastSeenAt,
    },
    identities: identities.map((i) => ({
      channel: i.channel,
      externalId: i.externalId,
      username: i.username,
      lastSeenAt: i.lastSeenAt,
    })),
    profile: profile
      ? { household: JSON.parse(profile.household), behaviour: JSON.parse(profile.behaviour), goals: JSON.parse(profile.goals ?? "[]") }
      : null,
    bills: bills.map((b) => ({
      id: b.id,
      billId: b.billId,
      utilityType: b.utilityType,
      amount: b.amount,
      term: b.term,
      createdAt: b.createdAt,
      hasSuggestions: b.suggestions != null,
      suggestions: b.suggestions ? JSON.parse(b.suggestions) : null,
    })),
    messages: messages.map((m) => ({
      id: m.id,
      channel: m.channel,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const admin = await currentAdmin();
  if (!admin) return unauth();
  if (!csrfGuard(req, admin.sessionId)) return badCsrf();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as { isBlocked?: boolean } | null;
  if (!body || typeof body.isBlocked !== "boolean") {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const db = getDb();
  db.update(schema.users).set({ isBlocked: body.isBlocked }).where(eq(schema.users.id, id)).run();
  db.insert(schema.auditLog)
    .values({
      adminId: admin.id,
      action: body.isBlocked ? "user.block" : "user.unblock",
      entityType: "user",
      entityId: id,
      createdAt: now(),
    })
    .run();
  return Response.json({ ok: true });
}
