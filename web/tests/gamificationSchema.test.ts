// Gamification user-state tables (migration 0004): insert/select roundtrips
// for the five tables plus the UNIQUE(user_id, badge_key) badge guard.

import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, now, schema } from "@/lib/db";

const T = now();

describe("gamification user-state tables", () => {
  it("stores and returns a lesson completion", () => {
    const db = makeTestDb();
    db.insert(schema.lessonCompletions)
      .values({
        id: "lc1",
        userId: "u1",
        courseSlug: "bills-101",
        lessonSlug: "01-bill-anatomy",
        accuracy: 0.75,
        firstTryAccuracy: 0.5,
        xp: 40,
        createdAt: T,
      })
      .run();
    const row = db.select().from(schema.lessonCompletions).where(eq(schema.lessonCompletions.id, "lc1")).get()!;
    expect(row).toMatchObject({
      userId: "u1",
      courseSlug: "bills-101",
      lessonSlug: "01-bill-anatomy",
      accuracy: 0.75,
      firstTryAccuracy: 0.5,
      xp: 40,
      createdAt: T,
    });
  });

  it("stores and returns xp and coin ledger events", () => {
    const db = makeTestDb();
    db.insert(schema.xpEvents)
      .values({ id: "x1", userId: "u1", kind: "lesson", amount: 40, ref: "bills-101/01-bill-anatomy", createdAt: T })
      .run();
    db.insert(schema.coinEvents)
      .values({ id: "c1", userId: "u1", kind: "daily_lesson", amount: 5, ref: "bills-101/01-bill-anatomy", createdAt: T })
      .run();
    const xp = db.select().from(schema.xpEvents).where(eq(schema.xpEvents.id, "x1")).get()!;
    const coin = db.select().from(schema.coinEvents).where(eq(schema.coinEvents.id, "c1")).get()!;
    expect(xp).toMatchObject({ kind: "lesson", amount: 40, ref: "bills-101/01-bill-anatomy" });
    expect(coin).toMatchObject({ kind: "daily_lesson", amount: 5, ref: "bills-101/01-bill-anatomy" });
  });

  it("stores and returns streak state keyed by user", () => {
    const db = makeTestDb();
    db.insert(schema.streakState)
      .values({ userId: "u1", current: 3, best: 7, lastActiveDate: "1404-07-29", freezes: 0, updatedAt: T })
      .run();
    const row = db.select().from(schema.streakState).where(eq(schema.streakState.userId, "u1")).get()!;
    expect(row).toMatchObject({ current: 3, best: 7, lastActiveDate: "1404-07-29", freezes: 0, updatedAt: T });
  });

  it("rejects a duplicate (user_id, badge_key) badge", () => {
    const db = makeTestDb();
    const badge = { userId: "u1", badgeKey: "first_lesson", createdAt: T };
    db.insert(schema.badgesEarned).values({ id: "b1", ...badge }).run();
    expect(() => db.insert(schema.badgesEarned).values({ id: "b2", ...badge }).run()).toThrow();
  });
});
