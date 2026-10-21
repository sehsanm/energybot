// Transactional award path (Task 5): awardLessonCompletion / purchaseFreeze /
// gamificationSummary over a real migrated in-memory sqlite db (FKs enforced —
// every case seeds a users row). Uses the pilot course's real lessons for the
// happy paths; `now` is always injected so Tehran-day boundaries are pinned.

import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTestDb, schema } from "@/lib/db";
import { getCourses } from "@/lib/courses/catalog";
import { emitAppEvent, subscribeAppEvent } from "@/lib/events";
import {
  awardLessonCompletion,
  gamificationSummary,
  purchaseFreeze,
  type AwardOutcome,
} from "@/lib/gamification/awards";

type DB = ReturnType<typeof makeTestDb>;

const course = getCourses()[0]; // bill-literacy — 6 lessons, xpBase 10
const T0 = Date.UTC(2026, 9, 21, 12, 0); // 2026-10-21 15:30 Tehran → day 2026-10-21
// The Tehran midnight pair: fixed UTC+3:30, so 20:30 UTC is the day boundary.
const BEFORE_MIDNIGHT = Date.UTC(2026, 9, 20, 20, 29); // Tehran 2026-10-20 23:59
const AFTER_MIDNIGHT = Date.UTC(2026, 9, 20, 20, 31); // Tehran 2026-10-21 00:01

function seedUser(db: DB, id = "u1") {
  db.insert(schema.users).values({ id, createdAt: T0 }).run();
}

/** The perfect answer for every exercise of pilot lesson `i`. */
function correctAnswers(i: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const ex of course.lessons[i].exercises) {
    if (ex.kind === "mcq") out[ex.id] = ex.correctIndex;
    else if (ex.kind === "truefalse") out[ex.id] = ex.answer;
    else out[ex.id] = ex.answer;
  }
  return out;
}

/** Perfect answers minus one exercise id (missing answer scores incorrect). */
function answersMissing(i: number, exerciseId: string): Record<string, unknown> {
  const out = correctAnswers(i);
  delete out[exerciseId];
  return out;
}

function unwrap(r: AwardOutcome) {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.result;
}

function seedStreak(db: DB, userId: string, v: { current: number; best: number; lastActiveDate: string; freezes: number }) {
  db.insert(schema.streakState)
    .values({ userId, current: v.current, best: v.best, lastActiveDate: v.lastActiveDate, freezes: v.freezes, updatedAt: T0 })
    .run();
}

function seedCoins(db: DB, userId: string, n: number) {
  for (let i = 0; i < n; i++) {
    db.insert(schema.coinEvents)
      .values({ id: `seed-coin-${i}`, userId, kind: "daily_lesson", amount: 1, ref: "seed", createdAt: T0 })
      .run();
  }
}

describe("awardLessonCompletion — happy path", () => {
  it("first completion (5/6 correct): completion row + xp ledger + daily coin + streak 1 + first_lesson, exact math", () => {
    const db = makeTestDb();
    seedUser(db);
    const lesson = course.lessons[0];
    // lesson 0 has 6 exercises; xp = round(10 × 5/6) = 8, no perfect bonus.
    const r = awardLessonCompletion(db, "u1", course.slug, lesson.slug, answersMissing(0, "e6"), T0);
    expect(r).toEqual({
      ok: true,
      result: {
        accuracy: 5 / 6,
        firstTryAccuracy: 5 / 6,
        xpAwarded: 8,
        coinsAwarded: 1,
        newBadges: ["first_lesson"],
        streak: { current: 1, best: 1, freezes: 0 },
      },
    });

    const completions = db.select().from(schema.lessonCompletions).all();
    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      userId: "u1",
      courseSlug: course.slug,
      lessonSlug: lesson.slug,
      accuracy: 5 / 6,
      firstTryAccuracy: 5 / 6,
      xp: 8,
      createdAt: T0,
    });

    const xp = db.select().from(schema.xpEvents).all();
    expect(xp).toHaveLength(1);
    expect(xp[0]).toMatchObject({ userId: "u1", kind: "lesson", amount: 8, ref: `${course.slug}/${lesson.slug}`, createdAt: T0 });

    const coins = db.select().from(schema.coinEvents).all();
    expect(coins).toHaveLength(1);
    expect(coins[0]).toMatchObject({ kind: "daily_lesson", amount: 1, ref: `${course.slug}/${lesson.slug}` });

    const streak = db.select().from(schema.streakState).all();
    expect(streak).toHaveLength(1);
    expect(streak[0]).toMatchObject({ userId: "u1", current: 1, best: 1, lastActiveDate: "2026-10-21", freezes: 0 });

    expect(db.select().from(schema.badgesEarned).all().map((b) => b.badgeKey)).toEqual(["first_lesson"]);
  });

  it("perfect first completion: +5 perfect_bonus xp event and first_perfect badge", () => {
    const db = makeTestDb();
    seedUser(db);
    const lesson = course.lessons[0];
    const r = unwrap(awardLessonCompletion(db, "u1", course.slug, lesson.slug, correctAnswers(0), T0));
    expect(r.accuracy).toBe(1);
    expect(r.xpAwarded).toBe(15); // 10 + 5 bonus
    expect(r.newBadges).toEqual(["first_lesson", "first_perfect"]);
    const xp = db.select().from(schema.xpEvents).all();
    expect(xp.map((x) => [x.kind, x.amount])).toEqual([["lesson", 10], ["perfect_bonus", 5]]);
    expect(db.select().from(schema.lessonCompletions).all()[0]).toMatchObject({ accuracy: 1, xp: 15 });
  });

  it("unknown course or lesson → not_found, nothing written", () => {
    const db = makeTestDb();
    seedUser(db);
    expect(awardLessonCompletion(db, "u1", "no-such-course", course.lessons[0].slug, {}, T0)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(awardLessonCompletion(db, "u1", course.slug, "no-such-lesson", {}, T0)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(db.select().from(schema.lessonCompletions).all()).toHaveLength(0);
    expect(db.select().from(schema.xpEvents).all()).toHaveLength(0);
  });
});

describe("replay never re-awards", () => {
  it("second call on the same lesson: only a completion row (xp 0, better accuracy); ledgers/streak/badges untouched", () => {
    const db = makeTestDb();
    seedUser(db);
    const lesson = course.lessons[0];
    unwrap(awardLessonCompletion(db, "u1", course.slug, lesson.slug, answersMissing(0, "e6"), T0)); // 5/6, xp 8
    const second = awardLessonCompletion(db, "u1", course.slug, lesson.slug, correctAnswers(0), T0 + 60_000);
    expect(second).toEqual({
      ok: true,
      result: {
        accuracy: 1,
        firstTryAccuracy: 1,
        xpAwarded: 0,
        coinsAwarded: 0,
        newBadges: [],
        streak: { current: 1, best: 1, freezes: 0 },
      },
    });

    // No new ledger rows, no new badges, streak row still exactly one and unchanged.
    expect(db.select().from(schema.xpEvents).all()).toHaveLength(1);
    expect(db.select().from(schema.coinEvents).all()).toHaveLength(1);
    expect(db.select().from(schema.badgesEarned).all().map((b) => b.badgeKey)).toEqual(["first_lesson"]);
    expect(db.select().from(schema.streakState).all()).toHaveLength(1);
    expect(db.select().from(schema.streakState).get()).toMatchObject({ current: 1, best: 1, freezes: 0 });

    // The replay IS recorded, with the improved accuracy and xp 0.
    const rows = db.select().from(schema.lessonCompletions).all();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ accuracy: 1, firstTryAccuracy: 1, xp: 0, createdAt: T0 + 60_000 });

    const s = gamificationSummary(db, "u1");
    expect(s.xp).toBe(8);
    expect(s.coins).toBe(1);
    expect(s.lessonsCompleted).toBe(1); // distinct lessons, not rows
  });
});

describe("first-of-day coin across the Tehran midnight boundary", () => {
  it("20:29 UTC (day D) and 20:31 UTC (day D+1) each earn the daily coin; a third call the same day does not", () => {
    const db = makeTestDb();
    seedUser(db);

    const r1 = unwrap(awardLessonCompletion(db, "u1", course.slug, course.lessons[0].slug, correctAnswers(0), BEFORE_MIDNIGHT));
    expect(r1.coinsAwarded).toBe(1);
    expect(r1.streak).toEqual({ current: 1, best: 1, freezes: 0 });

    // 2 minutes later in real time, but already the next Tehran day.
    const r2 = unwrap(awardLessonCompletion(db, "u1", course.slug, course.lessons[1].slug, correctAnswers(1), AFTER_MIDNIGHT));
    expect(r2.coinsAwarded).toBe(1);
    expect(r2.streak).toEqual({ current: 2, best: 2, freezes: 0 });

    // Same Tehran day as r2 → no coin, streak unchanged (gap 0).
    const r3 = unwrap(awardLessonCompletion(db, "u1", course.slug, course.lessons[2].slug, correctAnswers(2), AFTER_MIDNIGHT + 5 * 60_000));
    expect(r3.coinsAwarded).toBe(0);
    expect(r3.streak).toEqual({ current: 2, best: 2, freezes: 0 });

    const coins = db.select().from(schema.coinEvents).all();
    expect(coins).toHaveLength(2);
    expect(coins.every((c) => c.kind === "daily_lesson" && c.amount === 1)).toBe(true);
    expect(db.select().from(schema.streakState).get()).toMatchObject({ current: 2, best: 2, lastActiveDate: "2026-10-21" });
  });
});

describe("course completion bonus", () => {
  it("fires exactly once, on the 6th distinct lesson (all perfect, same day)", () => {
    const db = makeTestDb();
    seedUser(db);
    expect(course.lessons).toHaveLength(6);

    const results = course.lessons.map((l, i) =>
      unwrap(awardLessonCompletion(db, "u1", course.slug, l.slug, correctAnswers(i), T0)),
    );

    // Badge earn order across the run: L1 first_lesson+first_perfect, L5 five_perfect,
    // L6 course_complete_1 + xp_100 (5×15 + 15 + 25 = 115 ≥ 100).
    expect(results.map((r) => r.newBadges)).toEqual([
      ["first_lesson", "first_perfect"],
      [],
      [],
      [],
      ["five_perfect"],
      ["course_complete_1", "xp_100"],
    ]);

    // 6th call: lesson xp 15 + course 25 = 40 xp; no daily coin (same day) + 3 course coins.
    expect(results[5]).toEqual({
      accuracy: 1,
      firstTryAccuracy: 1,
      xpAwarded: 40,
      coinsAwarded: 3,
      newBadges: ["course_complete_1", "xp_100"],
      streak: { current: 1, best: 1, freezes: 0 },
    });

    // Exactly one course_complete pair in each ledger.
    const xp = db.select().from(schema.xpEvents).all();
    const courseXp = xp.filter((x) => x.kind === "course_complete");
    expect(courseXp).toHaveLength(1);
    expect(courseXp[0]).toMatchObject({ amount: 25, ref: course.slug });
    const coins = db.select().from(schema.coinEvents).all();
    const courseCoins = coins.filter((c) => c.kind === "course_complete");
    expect(courseCoins).toHaveLength(1);
    expect(courseCoins[0]).toMatchObject({ amount: 3, ref: course.slug });

    // A replay after course completion adds nothing (bonus must not fire twice).
    const replay = unwrap(
      awardLessonCompletion(db, "u1", course.slug, course.lessons[0].slug, correctAnswers(0), T0 + 1000),
    );
    expect(replay.xpAwarded).toBe(0);
    expect(replay.coinsAwarded).toBe(0);
    expect(replay.newBadges).toEqual([]);
    expect(db.select().from(schema.xpEvents).all().filter((x) => x.kind === "course_complete")).toHaveLength(1);

    const s = gamificationSummary(db, "u1");
    expect(s).toEqual({
      xp: 115, // 6 × (10 + 5) + 25
      coins: 4, // 1 daily + 3 course
      streak: { current: 1, best: 1, freezes: 0 },
      freezes: 0,
      badges: ["first_lesson", "first_perfect", "course_complete_1", "five_perfect", "xp_100"], // BADGES order
      lessonsCompleted: 6,
    });
  });
});

describe("comeback wiring", () => {
  it("an award after a long gap resets the streak and earns comeback", () => {
    const db = makeTestDb();
    seedUser(db);
    seedStreak(db, "u1", { current: 5, best: 5, lastActiveDate: "2026-10-10", freezes: 0 });
    const r = unwrap(awardLessonCompletion(db, "u1", course.slug, course.lessons[0].slug, correctAnswers(0), T0));
    expect(r.streak).toEqual({ current: 0, best: 5, freezes: 0 });
    expect(r.newBadges).toContain("comeback");
  });
});

describe("purchaseFreeze", () => {
  it("max_freezes when a freeze is already held — checked before the coin balance", () => {
    const db = makeTestDb();
    seedUser(db);
    seedCoins(db, "u1", 5);
    seedStreak(db, "u1", { current: 2, best: 2, lastActiveDate: "2026-10-20", freezes: 1 });
    expect(purchaseFreeze(db, "u1", T0)).toEqual({ ok: false, error: "max_freezes" });
    expect(db.select().from(schema.coinEvents).all()).toHaveLength(5); // nothing written
  });

  it("insufficient_coins below 5 (4 coins, no freeze held)", () => {
    const db = makeTestDb();
    seedUser(db);
    seedCoins(db, "u1", 4);
    seedStreak(db, "u1", { current: 2, best: 2, lastActiveDate: "2026-10-20", freezes: 0 });
    expect(purchaseFreeze(db, "u1", T0)).toEqual({ ok: false, error: "insufficient_coins" });
    expect(db.select().from(schema.coinEvents).all()).toHaveLength(4);
  });

  it("success at exactly 5 coins: −5 ledger row, freezes 0 → 1, balances returned", () => {
    const db = makeTestDb();
    seedUser(db);
    seedCoins(db, "u1", 5);
    seedStreak(db, "u1", { current: 3, best: 4, lastActiveDate: "2026-10-20", freezes: 0 });
    expect(purchaseFreeze(db, "u1", T0)).toEqual({ ok: true, freezes: 1, coins: 0 });
    const coins = db.select().from(schema.coinEvents).all();
    expect(coins).toHaveLength(6);
    const purchase = coins.find((c) => c.kind === "freeze_purchase")!;
    expect(purchase).toMatchObject({ amount: -5, createdAt: T0 });
    expect(gamificationSummary(db, "u1").coins).toBe(0);
    expect(db.select().from(schema.streakState).get()).toMatchObject({ current: 3, best: 4, freezes: 1 });
  });

  it("success with 7 coins leaves 2; a second purchase then hits max_freezes", () => {
    const db = makeTestDb();
    seedUser(db);
    seedCoins(db, "u1", 7);
    seedStreak(db, "u1", { current: 1, best: 1, lastActiveDate: "2026-10-21", freezes: 0 });
    expect(purchaseFreeze(db, "u1", T0)).toEqual({ ok: true, freezes: 1, coins: 2 });
    expect(purchaseFreeze(db, "u1", T0)).toEqual({ ok: false, error: "max_freezes" });
    expect(gamificationSummary(db, "u1")).toMatchObject({ coins: 2, freezes: 1, streak: { current: 1, best: 1, freezes: 1 } });
  });

  it("works before any lesson (no streak row yet): creates never-active state; the first lesson still starts a streak", () => {
    const db = makeTestDb();
    seedUser(db);
    seedCoins(db, "u1", 5);
    expect(purchaseFreeze(db, "u1", T0)).toEqual({ ok: true, freezes: 1, coins: 0 });
    expect(db.select().from(schema.streakState).get()).toMatchObject({ current: 0, best: 0, freezes: 1 });
    const r = unwrap(awardLessonCompletion(db, "u1", course.slug, course.lessons[0].slug, correctAnswers(0), T0 + 60_000));
    expect(r.streak).toEqual({ current: 1, best: 1, freezes: 1 });
  });
});

describe("gamificationSummary", () => {
  it("fresh user: all zeros, no badges", () => {
    const db = makeTestDb();
    seedUser(db);
    expect(gamificationSummary(db, "u1")).toEqual({
      xp: 0,
      coins: 0,
      streak: { current: 0, best: 0, freezes: 0 },
      freezes: 0,
      badges: [],
      lessonsCompleted: 0,
    });
  });
});

describe("events — awards emit after commit", () => {
  const unsubs: Array<() => void> = [];
  afterEach(() => {
    for (const u of unsubs.splice(0)) u();
  });

  /** Subscribe one collector to each named event (auto-unsubscribed). */
  function collect(...names: string[]) {
    const got: Array<{ name: string; payload: Record<string, unknown> }> = [];
    for (const name of names) {
      unsubs.push(subscribeAppEvent(name, (payload) => got.push({ name, payload })));
    }
    return got;
  }

  it("a subscriber receives lesson_completed with the award payload on a first completion — after the row is committed", () => {
    const db = makeTestDb();
    seedUser(db);
    const lesson = course.lessons[0];
    const got = collect("lesson_completed");
    let rowsAtEmit = -1;
    unsubs.push(
      subscribeAppEvent("lesson_completed", () => {
        rowsAtEmit = db.select().from(schema.lessonCompletions).all().length;
      }),
    );

    unwrap(awardLessonCompletion(db, "u1", course.slug, lesson.slug, answersMissing(0, "e6"), T0));

    expect(got).toEqual([
      {
        name: "lesson_completed",
        payload: {
          userId: "u1",
          courseSlug: course.slug,
          lessonSlug: lesson.slug,
          accuracy: 5 / 6,
          firstTryAccuracy: 5 / 6,
          xpAwarded: 8,
          coinsAwarded: 1,
        },
      },
    ]);
    expect(rowsAtEmit).toBe(1); // emitted AFTER the transaction committed
  });

  it("a first completion also emits badge_earned + streak_updated; the course bonus adds course_completed", () => {
    const db = makeTestDb();
    seedUser(db);
    const got = collect("lesson_completed", "badge_earned", "streak_updated", "course_completed");

    unwrap(awardLessonCompletion(db, "u1", course.slug, course.lessons[0].slug, correctAnswers(0), T0));
    // A perfect lesson earns first_lesson AND first_perfect.
    expect(got.map((e) => e.name)).toEqual(["lesson_completed", "badge_earned", "badge_earned", "streak_updated"]);
    expect(got[1].payload).toEqual({ userId: "u1", badgeKey: "first_lesson" });
    expect(got[2].payload).toEqual({ userId: "u1", badgeKey: "first_perfect" });
    expect(got[3].payload).toEqual({ userId: "u1", current: 1, best: 1, freezeConsumed: false });

    // 6th and last lesson, same Tehran day: bonus fires, streak does NOT advance (gap 0).
    got.length = 0;
    for (let i = 1; i < course.lessons.length; i++) {
      unwrap(awardLessonCompletion(db, "u1", course.slug, course.lessons[i].slug, correctAnswers(i), T0));
    }
    const last = got.slice(-4);
    expect(last.map((e) => e.name)).toEqual(["lesson_completed", "course_completed", "badge_earned", "badge_earned"]);
    expect(last[1].payload).toEqual({ userId: "u1", courseSlug: course.slug });
    expect(last[2].payload).toEqual({ userId: "u1", badgeKey: "course_complete_1" });
    expect(last[3].payload).toEqual({ userId: "u1", badgeKey: "xp_100" });
  });

  it("a replay emits ONLY lesson_completed — no award-like events without awards", () => {
    const db = makeTestDb();
    seedUser(db);
    const lesson = course.lessons[0];
    const got = collect("lesson_completed", "badge_earned", "streak_updated", "course_completed");

    unwrap(awardLessonCompletion(db, "u1", course.slug, lesson.slug, answersMissing(0, "e6"), T0));
    expect(got.map((e) => e.name)).toEqual(["lesson_completed", "badge_earned", "streak_updated"]);

    got.length = 0;
    unwrap(awardLessonCompletion(db, "u1", course.slug, lesson.slug, correctAnswers(0), T0 + 60_000));
    expect(got).toEqual([
      {
        name: "lesson_completed",
        payload: {
          userId: "u1",
          courseSlug: course.slug,
          lessonSlug: lesson.slug,
          accuracy: 1,
          firstTryAccuracy: 1,
          xpAwarded: 0,
          coinsAwarded: 0,
        },
      },
    ]);
  });

  it("unsubscribe stops delivery", () => {
    const got: unknown[] = [];
    const unsub = subscribeAppEvent("lesson_completed", (p) => got.push(p));
    unsub();
    unsub(); // idempotent
    emitAppEvent("lesson_completed", { userId: "u1" });
    expect(got).toEqual([]);
  });

  it("the console log still fires alongside subscribers", () => {
    const calls: unknown[][] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => calls.push(a));
    unsubs.push(subscribeAppEvent("lesson_completed", () => {}));
    try {
      emitAppEvent("lesson_completed", { userId: "u1" });
    } finally {
      spy.mockRestore();
    }
    expect(calls.some((a) => String(a[0]).includes("lesson_completed"))).toBe(true);
  });

  it("a throwing subscriber does not break the emitter or later subscribers", () => {
    const got: unknown[] = [];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    unsubs.push(
      subscribeAppEvent("lesson_completed", () => {
        throw new Error("boom");
      }),
    );
    unsubs.push(subscribeAppEvent("lesson_completed", (p) => got.push(p)));
    try {
      expect(() => emitAppEvent("lesson_completed", { userId: "u1" })).not.toThrow();
    } finally {
      err.mockRestore();
    }
    expect(got).toEqual([{ userId: "u1" }]);
  });
});
