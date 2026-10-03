// Profile goal bookkeeping for bill-suggestion targets. Replace-per-bill
// semantics (port of legacy replace_bill_goals) so regenerating insights for a
// bill never duplicates its goals.

import { eq } from "drizzle-orm";
import { now, schema, type DB } from "@/lib/db";

export function replaceGoalsForBill(
  db: DB,
  userId: string,
  billRowId: string,
  goals: Record<string, unknown>[],
): void {
  const row = db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).get();
  const existing: Record<string, unknown>[] = row ? JSON.parse(row.goals ?? "[]") : [];
  const kept = existing.filter(
    (g) => !(g.source === "bill_suggestion" && g.billId === billRowId),
  );
  const merged = [...kept, ...goals];
  if (row) {
    db.update(schema.profiles)
      .set({ goals: JSON.stringify(merged), updatedAt: now() })
      .where(eq(schema.profiles.userId, userId))
      .run();
  } else {
    db.insert(schema.profiles)
      .values({ userId, goals: JSON.stringify(merged), updatedAt: now() })
      .run();
  }
}
