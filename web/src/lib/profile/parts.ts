// Shared profile part-writes (shallow merge per top-level key), extracted from
// lib/bot/handler so non-bot surfaces (mini-app, admin) can reuse them.

import { eq } from "drizzle-orm";
import { now, schema, type DB } from "@/lib/db";

export function getProfileRow(db: DB, userId: string) {
  return db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).get();
}

export function updateProfileParts(
  db: DB,
  userId: string,
  parts: { household?: Record<string, unknown>; behaviour?: Record<string, unknown> },
): void {
  const row = getProfileRow(db, userId);
  const household = { ...JSON.parse(row?.household ?? "{}"), ...(parts.household ?? {}) };
  const behaviour = { ...JSON.parse(row?.behaviour ?? "{}"), ...(parts.behaviour ?? {}) };
  if (row) {
    db.update(schema.profiles)
      .set({ household: JSON.stringify(household), behaviour: JSON.stringify(behaviour), updatedAt: now() })
      .where(eq(schema.profiles.userId, userId))
      .run();
  } else {
    db.insert(schema.profiles)
      .values({
        userId,
        household: JSON.stringify(household),
        behaviour: JSON.stringify(behaviour),
        updatedAt: now(),
      })
      .run();
  }
}
