// Admin aggregation queries (extracted from routes for direct testability).

import { count, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, now, schema, type DB } from "@/lib/db";

const DAY = 86_400_000;

function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface StatsResult {
  usersTotal: number;
  usersActive: number;
  billsTotal: number;
  insightsCount: number;
  /** Sum over the 7 calendar days in messagesByDay (single source). */
  messages7d: number;
  messagesByDay: { date: string; n: number }[];
  byChannel: { channel: string; n: number }[];
}

export function buildStats(db: DB = getDb()): StatsResult {
  const t = now();
  const dayAgo = t - DAY;
  const usersTotal = db.select({ n: count() }).from(schema.users).get()?.n ?? 0;
  const usersActive = db.select({ n: count() }).from(schema.users).where(gte(schema.users.lastSeenAt, dayAgo)).get()?.n ?? 0;
  const billsTotal = db.select({ n: count() }).from(schema.bills).get()?.n ?? 0;
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

  // Last 7 calendar days (oldest→newest), zero-filled.
  const days: { date: string; n: number }[] = [];
  for (let i = 6; i >= 0; i--) days.push({ date: dayKey(t - i * DAY), n: 0 });
  const buckets = new Map(days.map((d) => [d.date, d]));
  const windowStart = t - 7 * DAY;
  for (const row of db
    .select({ createdAt: schema.messages.createdAt })
    .from(schema.messages)
    .where(gte(schema.messages.createdAt, windowStart))
    .all()) {
    const b = buckets.get(dayKey(row.createdAt));
    if (b) b.n += 1;
  }

  return {
    usersTotal,
    usersActive,
    billsTotal,
    insightsCount,
    messages7d: days.reduce((a, d) => a + d.n, 0),
    messagesByDay: days,
    byChannel,
  };
}

export interface AdminUserRow {
  id: string;
  displayName: string | null;
  isBlocked: boolean;
  createdAt: number;
  lastSeenAt: number | null;
  channels: string[];
  usernames: (string | null)[];
  billCount: number;
  messageCount: number;
}

export function listUsers(db: DB = getDb(), query: string): AdminUserRow[] {
  const users = db.select().from(schema.users).orderBy(desc(schema.users.createdAt)).limit(200).all();
  const identities = db.select().from(schema.userIdentities).all();
  const billCounts = new Map<string, number>();
  for (const row of db.select({ userId: schema.bills.userId, n: count() }).from(schema.bills).groupBy(schema.bills.userId).all()) {
    billCounts.set(row.userId, Number(row.n));
  }
  const msgCounts = new Map<string, number>();
  for (const row of db
    .select({ userId: schema.messages.userId, n: count() })
    .from(schema.messages)
    .groupBy(schema.messages.userId)
    .all()) {
    msgCounts.set(row.userId, Number(row.n));
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
      messageCount: msgCounts.get(u.id) ?? 0,
    };
  });
  if (query) {
    const q = query.toLowerCase();
    out = out.filter(
      (u) => (u.displayName ?? "").toLowerCase().includes(q) || u.usernames.some((n) => n!.toLowerCase().includes(q)),
    );
  }
  return out;
}

// Kept for callers that need a single user's existence check.
export function userExists(db: DB, id: string): boolean {
  return db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, id)).get() != null;
}
