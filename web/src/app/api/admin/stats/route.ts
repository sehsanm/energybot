// GET /api/admin/stats — dashboard numbers.

import { count, gte, sql } from "drizzle-orm";
import { getDb, now, schema } from "@/lib/db";
import { currentAdmin, unauth } from "@/lib/auth/api";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const admin = await currentAdmin();
  if (!admin) return unauth();
  const db = getDb();
  const dayAgo = now() - 86_400_000;
  const weekAgo = now() - 7 * 86_400_000;
  const usersTotal = db.select({ n: count() }).from(schema.users).get()?.n ?? 0;
  const usersActive = db.select({ n: count() }).from(schema.users).where(gte(schema.users.lastSeenAt, dayAgo)).get()?.n ?? 0;
  const billsTotal = db.select({ n: count() }).from(schema.bills).get()?.n ?? 0;
  const msgs7 = db.select({ n: count() }).from(schema.messages).where(gte(schema.messages.createdAt, weekAgo)).get()?.n ?? 0;
  const insightsCount = db
    .select({ n: count() })
    .from(schema.bills)
    .where(sql`${schema.bills.suggestions} is not null`)
    .get()?.n ?? 0;
  const byChannel = db
    .select({ channel: schema.userIdentities.channel, n: count() })
    .from(schema.userIdentities)
    .groupBy(schema.userIdentities.channel)
    .all();
  return Response.json({
    usersTotal,
    usersActive,
    billsTotal,
    insightsCount,
    messages7d: msgs7,
    byChannel,
  });
}
