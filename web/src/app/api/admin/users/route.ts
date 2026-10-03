// GET /api/admin/users?query= — user list with channels + counts.

import { count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { currentAdmin, unauth } from "@/lib/auth/api";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const admin = await currentAdmin();
  if (!admin) return unauth();
  const url = new URL(req.url);
  const query = url.searchParams.get("query")?.trim() ?? "";
  const db = getDb();

  const users = db.select().from(schema.users).orderBy(desc(schema.users.createdAt)).limit(200).all();
  const identities = db.select().from(schema.userIdentities).all();
  const billCounts = new Map<string, number>();
  for (const row of db.select({ userId: schema.bills.userId, n: count() }).from(schema.bills).groupBy(schema.bills.userId).all()) {
    billCounts.set(row.userId, Number(row.n));
  }

  let out = users.map((u) => {
    const ids = identities.filter((i) => i.userId === u.id);
    return {
      id: u.id,
      displayName: u.displayName,
      isBlocked: u.isBlocked,
      createdAt: u.createdAt,
      lastSeenAt: u.lastSeenAt,
      channels: ids.map((i) => i.channel),
      usernames: ids.map((i) => i.username).filter(Boolean),
      billCount: billCounts.get(u.id) ?? 0,
    };
  });
  if (query) {
    const q = query.toLowerCase();
    out = out.filter(
      (u) => (u.displayName ?? "").toLowerCase().includes(q) || u.usernames.some((n) => n!.toLowerCase().includes(q)),
    );
  }
  return Response.json({ users: out });
}
