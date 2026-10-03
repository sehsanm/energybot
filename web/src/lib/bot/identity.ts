// find-or-create user + identity per (channel, externalId) — the identity model
// from the 2026-10-01 spec, adopted from day one in the rewrite.

import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb, now, schema, type DB } from "@/lib/db";
import type { Channel, PlatformUserRef } from "@/lib/channels/types";

export interface ResolvedUser {
  user: typeof schema.users.$inferSelect;
  identity: typeof schema.userIdentities.$inferSelect;
}

export function resolveUser(
  channel: Channel,
  ref: PlatformUserRef,
  db: DB = getDb(),
): ResolvedUser {
  const t = now();
  const existing = db
    .select()
    .from(schema.userIdentities)
    .where(eq(schema.userIdentities.externalId, ref.externalId))
    .all()
    .find((i) => i.channel === channel);

  if (existing) {
    // Refresh contact info + last-seen.
    db.update(schema.userIdentities)
      .set({
        username: ref.username ?? existing.username,
        payload: JSON.stringify(ref.payload ?? JSON.parse(existing.payload || "{}")),
        lastSeenAt: t,
      })
      .where(eq(schema.userIdentities.id, existing.id))
      .run();
    const user = db.select().from(schema.users).where(eq(schema.users.id, existing.userId)).get();
    if (user) {
      db.update(schema.users).set({ lastSeenAt: t }).where(eq(schema.users.id, user.id)).run();
      const identity = db
        .select()
        .from(schema.userIdentities)
        .where(eq(schema.userIdentities.id, existing.id))
        .get();
      return { user, identity: identity! };
    }
    // Dangling identity without a user (user row lost, e.g. manual delete):
    // re-point it at a fresh user instead of tripping the UNIQUE constraint below.
    const userId = randomUUID();
    db.insert(schema.users)
      .values({ id: userId, displayName: ref.displayName ?? null, createdAt: t, lastSeenAt: t })
      .run();
    db.insert(schema.profiles).values({ userId, updatedAt: t }).run();
    db.update(schema.userIdentities).set({ userId, lastSeenAt: t }).where(eq(schema.userIdentities.id, existing.id)).run();
    const recreated = db.select().from(schema.users).where(eq(schema.users.id, userId)).get()!;
    const identity = db
      .select()
      .from(schema.userIdentities)
      .where(eq(schema.userIdentities.id, existing.id))
      .get()!;
    return { user: recreated, identity };
  }

  const userId = randomUUID();
  db.insert(schema.users)
    .values({ id: userId, displayName: ref.displayName ?? null, createdAt: t, lastSeenAt: t })
    .run();
  db.insert(schema.profiles).values({ userId, updatedAt: t }).run();
  const identityId = randomUUID();
  db.insert(schema.userIdentities)
    .values({
      id: identityId,
      userId,
      channel,
      externalId: ref.externalId,
      username: ref.username ?? null,
      payload: JSON.stringify(ref.payload ?? {}),
      createdAt: t,
      lastSeenAt: t,
    })
    .run();
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get()!;
  const identity = db.select().from(schema.userIdentities).where(eq(schema.userIdentities.id, identityId)).get()!;
  return { user, identity };
}
