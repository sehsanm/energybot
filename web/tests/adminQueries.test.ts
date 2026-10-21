import { describe, it, expect } from "vitest";
import { makeTestDb, now, schema } from "@/lib/db";
import { buildStats, listUsers, userGamification } from "@/lib/admin/queries";

const DAY = 86_400_000;

function seed() {
  const db = makeTestDb();
  const t = now();
  const uid = "11111111-1111-4111-8111-111111111111";
  db.insert(schema.users)
    .values({ id: uid, displayName: "سارا تستی", language: "fa", createdAt: t - 10 * DAY, lastSeenAt: t })
    .run();
  db.insert(schema.userIdentities)
    .values({
      id: "22222222-2222-4222-8222-222222222222",
      channel: "bale",
      externalId: "1001",
      userId: uid,
      username: "sara",
      createdAt: t,
    })
    .run();
  // messages: 3 today, 1 yesterday, 2 three days ago, none else
  for (const [offset, ch] of [[0, "bale"], [0, "web"], [0, "telegram"], [1, "bale"], [3, "bale"], [3, "web"]] as const) {
    db.insert(schema.messages)
      .values({ userId: uid, channel: ch, role: "user", content: "m", createdAt: t - offset * DAY })
      .run();
  }
  return { db, t, uid };
}

describe("buildStats", () => {
  it("returns 7 zero-filled days, oldest→newest, summing to messages7d", () => {
    const { db } = seed();
    const s = buildStats(db);
    expect(s.messagesByDay).toHaveLength(7);
    // oldest→newest ordering
    const days = s.messagesByDay.map((d) => d.date);
    expect([...days].sort()).toEqual(days);
    // every day present even when empty
    expect(s.messagesByDay.every((d) => typeof d.n === "number")).toBe(true);
    expect(s.messagesByDay.reduce((a, d) => a + d.n, 0)).toBe(s.messages7d);
    // the seeded counts land on today's bucket (3) — today is the last entry
    expect(s.messagesByDay[6].n).toBe(3);
  });
});

describe("listUsers", () => {
  it("includes per-user message counts alongside bill counts", () => {
    const { db, uid } = seed();
    const users = listUsers(db, "");
    const u = users.find((x) => x.id === uid)!;
    expect(u).toBeTruthy();
    expect(u.messageCount).toBe(6);
    expect(u.billCount).toBe(0);
    expect(u.channels).toEqual(["bale"]);
  });
});

// Two users: one with full gamification state, one with none (zero-state).
function seedGamification() {
  const db = makeTestDb();
  const t = now();
  const uid = "33333333-3333-4333-8333-333333333333";
  const zeroId = "44444444-4444-4444-8444-444444444444";
  db.insert(schema.users).values([{ id: uid, createdAt: t }, { id: zeroId, createdAt: t }]).run();

  // ledgers: xp 8 + 10 = 18, coins 1 + 3 = 4
  db.insert(schema.xpEvents)
    .values([
      { id: "xp-1", userId: uid, kind: "lesson", amount: 8, ref: "bill-literacy/l1", createdAt: t },
      { id: "xp-2", userId: uid, kind: "perfect_bonus", amount: 10, ref: "bill-literacy/l2", createdAt: t },
    ])
    .run();
  db.insert(schema.coinEvents)
    .values([
      { id: "coin-1", userId: uid, kind: "daily_lesson", amount: 1, ref: "r", createdAt: t },
      { id: "coin-2", userId: uid, kind: "course_complete", amount: 3, ref: "bill-literacy", createdAt: t },
    ])
    .run();
  db.insert(schema.streakState)
    .values({ userId: uid, current: 3, best: 7, lastActiveDate: "2026-10-21", freezes: 1, updatedAt: t })
    .run();
  // inserted out of canonical order — the summary must return BADGES order
  db.insert(schema.badgesEarned)
    .values([
      { id: "badge-1", userId: uid, badgeKey: "xp_100", createdAt: t },
      { id: "badge-2", userId: uid, badgeKey: "first_lesson", createdAt: t },
    ])
    .run();

  const completion = (id: string, lessonSlug: string, at: number, accuracy: number, xp: number) =>
    db
      .insert(schema.lessonCompletions)
      .values({
        id,
        userId: uid,
        courseSlug: "bill-literacy",
        lessonSlug,
        accuracy,
        firstTryAccuracy: accuracy,
        xp,
        createdAt: at,
      })
      .run();

  return { db, t, uid, zeroId, completion };
}

describe("userGamification", () => {
  it("aggregates ledgers, streak, badges (BADGES order) and recent completions newest-first", () => {
    const { db, t, uid, completion } = seedGamification();
    completion("lc-old", "older", t - 3000, 0.5, 5);
    completion("lc-new", "newest", t, 1, 10);
    completion("lc-mid", "middle", t - 1000, 0.75, 8);

    const g = userGamification(db, uid);
    expect(g.xp).toBe(18);
    expect(g.coins).toBe(4);
    expect(g.streak).toEqual({ current: 3, best: 7, freezes: 1 });
    expect(g.freezes).toBe(1);
    expect(g.lessonsCompleted).toBe(3);
    expect(g.badges).toEqual(["first_lesson", "xp_100"]);

    expect(g.recentCompletions).toEqual([
      { courseSlug: "bill-literacy", lessonSlug: "newest", accuracy: 1, firstTryAccuracy: 1, xp: 10, createdAt: t },
      { courseSlug: "bill-literacy", lessonSlug: "middle", accuracy: 0.75, firstTryAccuracy: 0.75, xp: 8, createdAt: t - 1000 },
      { courseSlug: "bill-literacy", lessonSlug: "older", accuracy: 0.5, firstTryAccuracy: 0.5, xp: 5, createdAt: t - 3000 },
    ]);
  });

  it("caps recentCompletions at the 10 newest", () => {
    const { db, t, uid, completion } = seedGamification();
    for (let i = 0; i < 12; i++) completion(`lc-${i}`, `lesson-${i}`, t - i, 1, 10);

    const g = userGamification(db, uid);
    expect(g.recentCompletions).toHaveLength(10);
    expect(g.recentCompletions[0].lessonSlug).toBe("lesson-0");
    expect(g.recentCompletions[9].lessonSlug).toBe("lesson-9"); // lesson-10/11 dropped
    expect(g.lessonsCompleted).toBe(12);
  });

  it("returns zeros and empty arrays for a user with no gamification rows", () => {
    const { db, zeroId } = seedGamification();
    const g = userGamification(db, zeroId);
    expect(g).toEqual({
      xp: 0,
      coins: 0,
      streak: { current: 0, best: 0, freezes: 0 },
      freezes: 0,
      badges: [],
      lessonsCompleted: 0,
      recentCompletions: [],
    });
  });
});
