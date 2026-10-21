// Transactional gamification writes — the award path. Every state change for
// one lesson completion (completion row, xp/coin ledgers, streak, course
// bonus, badges) happens inside a single better-sqlite3 transaction; the pure
// math lives in ./engine and the Tehran-day logic in ./tehran. Outbox/event
// emission (lesson_completed, badge_earned, …) is Task 6 — the emit points are
// marked at the end of each transaction.

import { randomUUID } from "node:crypto";
import { and, eq, gte, lt, sum } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { getCourse, getLesson } from "@/lib/courses/catalog";
import { BADGES, advanceStreak, computeLessonXp, evaluateBadges, scoreLesson, type StreakState } from "./engine";
import { tehranDate } from "./tehran";

/** The transaction handle `db.transaction` hands its callback. */
type TxCallback = Parameters<DB["transaction"]>[0];
type Tx = Parameters<TxCallback>[0];

export interface StreakSnapshot {
  current: number;
  best: number;
  freezes: number;
}

export interface AwardResult {
  accuracy: number;
  firstTryAccuracy: number;
  /** total xp this call awarded: lesson xp (+ perfect bonus) (+ course bonus) */
  xpAwarded: number;
  /** total coins this call awarded: daily coin (+ course bonus) */
  coinsAwarded: number;
  newBadges: string[];
  streak: StreakSnapshot;
}

export type AwardOutcome = { ok: true; result: AwardResult } | { ok: false; error: "not_found" };

export type FreezeOutcome =
  | { ok: true; freezes: number; coins: number }
  | { ok: false; error: "max_freezes" | "insufficient_coins" };

export interface GamificationSummary {
  xp: number;
  coins: number;
  streak: StreakSnapshot;
  /** mirror of `streak.freezes` (the task brief spells it top-level too) */
  freezes: number;
  badges: string[];
  lessonsCompleted: number;
}

export const FREEZE_COST = 5;
const COURSE_COMPLETE_XP = 25;
const COURSE_COMPLETE_COINS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
// Asia/Tehran is a fixed UTC+3:30 (no DST since 2022), so Tehran midnight for
// Gregorian day D is D 00:00 − 3.5h in UTC.
const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;

/** UTC epoch window [start, end) covering the Tehran calendar day `day`. */
function tehranDayWindow(day: string): { start: number; end: number } {
  const [y, m, d] = day.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d) - TEHRAN_OFFSET_MS;
  return { start, end: start + DAY_MS };
}

const lessonRef = (courseSlug: string, lessonSlug: string) => `${courseSlug}/${lessonSlug}`;

// --- streak row helpers ------------------------------------------------------

/** Load the user's streak state; a missing row means never active. */
function loadStreak(tx: Tx, userId: string): StreakState {
  const row = tx.select().from(schema.streakState).where(eq(schema.streakState.userId, userId)).get();
  if (!row) return { current: 0, best: 0, lastActiveDate: null, freezes: 0 };
  return {
    current: row.current,
    best: row.best,
    // "" is the notNull sentinel for "never active" (a freeze bought before
    // any lesson) — the engine speaks null.
    lastActiveDate: row.lastActiveDate === "" ? null : row.lastActiveDate,
    freezes: row.freezes,
  };
}

/** Upsert the user's single streak_state row. */
function saveStreak(tx: Tx, userId: string, state: StreakState, updatedAt: number): void {
  tx.insert(schema.streakState)
    .values({
      userId,
      current: state.current,
      best: state.best,
      lastActiveDate: state.lastActiveDate ?? "",
      freezes: state.freezes,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: schema.streakState.userId,
      set: {
        current: state.current,
        best: state.best,
        lastActiveDate: state.lastActiveDate ?? "",
        freezes: state.freezes,
        updatedAt,
      },
    })
    .run();
}

// --- ledger reads ------------------------------------------------------------

function sumXp(tx: Tx, userId: string): number {
  const v = tx
    .select({ v: sum(schema.xpEvents.amount) })
    .from(schema.xpEvents)
    .where(eq(schema.xpEvents.userId, userId))
    .get()?.v;
  return Number(v ?? 0);
}

function sumCoins(tx: Tx, userId: string): number {
  const v = tx
    .select({ v: sum(schema.coinEvents.amount) })
    .from(schema.coinEvents)
    .where(eq(schema.coinEvents.userId, userId))
    .get()?.v;
  return Number(v ?? 0);
}

/** Distinct course slugs that already have a course_complete xp marker. */
function completedCourses(tx: Tx, userId: string): string[] {
  return tx
    .select({ ref: schema.xpEvents.ref })
    .from(schema.xpEvents)
    .where(and(eq(schema.xpEvents.userId, userId), eq(schema.xpEvents.kind, "course_complete")))
    .groupBy(schema.xpEvents.ref)
    .all()
    .map((r) => r.ref);
}

// --- award -------------------------------------------------------------------

/**
 * Record a lesson completion and award everything it earns, all-or-nothing.
 * The completion row is ALWAYS written (replays may improve the recorded
 * accuracy); ledgers/streak/course/badges change only on the user's FIRST
 * completion of that lesson. `now` is epoch ms and decides the Tehran day.
 */
export function awardLessonCompletion(
  db: DB,
  userId: string,
  courseSlug: string,
  lessonSlug: string,
  answers: Record<string, unknown>,
  now: number,
): AwardOutcome {
  const course = getCourse(courseSlug);
  const lesson = course ? getLesson(course, lessonSlug) : undefined;
  if (!course || !lesson) return { ok: false, error: "not_found" };

  return db.transaction((tx) => {
    const score = scoreLesson(lesson, answers);
    const today = tehranDate(now);

    const prior = tx
      .select({ id: schema.lessonCompletions.id })
      .from(schema.lessonCompletions)
      .where(
        and(
          eq(schema.lessonCompletions.userId, userId),
          eq(schema.lessonCompletions.courseSlug, courseSlug),
          eq(schema.lessonCompletions.lessonSlug, lessonSlug),
        ),
      )
      .limit(1)
      .get();

    // --- replay: record the attempt, touch nothing else --------------------
    if (prior) {
      tx.insert(schema.lessonCompletions)
        .values({
          id: randomUUID(),
          userId,
          courseSlug,
          lessonSlug,
          accuracy: score.accuracy,
          firstTryAccuracy: score.firstTryAccuracy,
          xp: 0,
          createdAt: now,
        })
        .run();
      const s = loadStreak(tx, userId);
      return {
        ok: true,
        result: {
          accuracy: score.accuracy,
          firstTryAccuracy: score.firstTryAccuracy,
          xpAwarded: 0,
          coinsAwarded: 0,
          newBadges: [],
          streak: { current: s.current, best: s.best, freezes: s.freezes },
        },
      };
    }

    // --- first completion of this lesson: the full award ---------------------
    // Daily coin: checked BEFORE inserting this row (the row being inserted
    // must not count as "already completed something today").
    const { start, end } = tehranDayWindow(today);
    const priorToday = tx
      .select({ id: schema.lessonCompletions.id })
      .from(schema.lessonCompletions)
      .where(
        and(
          eq(schema.lessonCompletions.userId, userId),
          gte(schema.lessonCompletions.createdAt, start),
          lt(schema.lessonCompletions.createdAt, end),
        ),
      )
      .limit(1)
      .get();

    const { xp, perfectBonus } = computeLessonXp(lesson.xpBase, score.firstTryAccuracy);
    const ref = lessonRef(courseSlug, lessonSlug);

    tx.insert(schema.lessonCompletions)
      .values({
        id: randomUUID(),
        userId,
        courseSlug,
        lessonSlug,
        accuracy: score.accuracy,
        firstTryAccuracy: score.firstTryAccuracy,
        xp: xp + perfectBonus,
        createdAt: now,
      })
      .run();

    tx.insert(schema.xpEvents)
      .values({ id: randomUUID(), userId, kind: "lesson", amount: xp, ref, createdAt: now })
      .run();
    if (perfectBonus > 0) {
      tx.insert(schema.xpEvents)
        .values({ id: randomUUID(), userId, kind: "perfect_bonus", amount: perfectBonus, ref, createdAt: now })
        .run();
    }

    let coinsAwarded = 0;
    if (!priorToday) {
      tx.insert(schema.coinEvents)
        .values({ id: randomUUID(), userId, kind: "daily_lesson", amount: 1, ref, createdAt: now })
        .run();
      coinsAwarded += 1;
    }

    // Streak: comeback = the streak was alive before this award and the
    // advance resets it to 0 (gap ≥ 3 days, or 2 days without a freeze).
    const pre = loadStreak(tx, userId);
    const advanced = advanceStreak(pre, today);
    const comeback = pre.current > 0 && advanced.state.current === 0;
    saveStreak(tx, userId, advanced.state, now);

    // Course completion: every lesson of the course has ≥1 completion AND this
    // course has no course_complete xp marker yet (once per course).
    const doneLessons = tx
      .select({ lessonSlug: schema.lessonCompletions.lessonSlug })
      .from(schema.lessonCompletions)
      .where(and(eq(schema.lessonCompletions.userId, userId), eq(schema.lessonCompletions.courseSlug, courseSlug)))
      .groupBy(schema.lessonCompletions.lessonSlug)
      .all();
    const markedCourses = completedCourses(tx, userId);
    let courseXp = 0;
    if (doneLessons.length === course.lessons.length && !markedCourses.includes(courseSlug)) {
      tx.insert(schema.xpEvents)
        .values({ id: randomUUID(), userId, kind: "course_complete", amount: COURSE_COMPLETE_XP, ref: courseSlug, createdAt: now })
        .run();
      tx.insert(schema.coinEvents)
        .values({ id: randomUUID(), userId, kind: "course_complete", amount: COURSE_COMPLETE_COINS, ref: courseSlug, createdAt: now })
        .run();
      courseXp = COURSE_COMPLETE_XP;
      coinsAwarded += COURSE_COMPLETE_COINS;
      markedCourses.push(courseSlug);
    }

    // Badges over the post-award snapshot; insert only the missing keys.
    const completions = tx
      .select({ firstTryAccuracy: schema.lessonCompletions.firstTryAccuracy })
      .from(schema.lessonCompletions)
      .where(eq(schema.lessonCompletions.userId, userId))
      .all();
    const earned = evaluateBadges({
      totalXp: sumXp(tx, userId),
      completions,
      perfectCount: completions.filter((c) => c.firstTryAccuracy === 1).length,
      streakCurrent: advanced.state.current,
      streakBest: advanced.state.best,
      coursesCompleted: markedCourses.length,
      comeback,
    });
    const existing = new Set(
      tx
        .select({ badgeKey: schema.badgesEarned.badgeKey })
        .from(schema.badgesEarned)
        .where(eq(schema.badgesEarned.userId, userId))
        .all()
        .map((r) => r.badgeKey),
    );
    const newBadges = earned.filter((key) => !existing.has(key));
    for (const badgeKey of newBadges) {
      tx.insert(schema.badgesEarned).values({ id: randomUUID(), userId, badgeKey, createdAt: now }).run();
    }

    // Task 6 emit points (no events yet): lesson_completed, badge_earned,
    // course_completed — everything above commits atomically with these results.

    return {
      ok: true,
      result: {
        accuracy: score.accuracy,
        firstTryAccuracy: score.firstTryAccuracy,
        xpAwarded: xp + perfectBonus + courseXp,
        coinsAwarded,
        newBadges,
        streak: {
          current: advanced.state.current,
          best: advanced.state.best,
          freezes: advanced.state.freezes,
        },
      },
    };
  });
}

// --- freeze purchase ---------------------------------------------------------

/**
 * Buy a streak freeze for 5 coins. `max_freezes` is checked first (at most one
 * held freeze), then the coin balance; on success a −5 `freeze_purchase` coin
 * event is appended and streak_state.freezes is incremented.
 */
export function purchaseFreeze(db: DB, userId: string, now: number): FreezeOutcome {
  return db.transaction((tx) => {
    const state = loadStreak(tx, userId);
    if (state.freezes >= 1) return { ok: false, error: "max_freezes" };
    const coins = sumCoins(tx, userId);
    if (coins < FREEZE_COST) return { ok: false, error: "insufficient_coins" };

    tx.insert(schema.coinEvents)
      .values({
        id: randomUUID(),
        userId,
        kind: "freeze_purchase",
        amount: -FREEZE_COST,
        ref: tehranDate(now),
        createdAt: now,
      })
      .run();
    saveStreak(tx, userId, { ...state, freezes: state.freezes + 1 }, now);

    // Task 6 emit point (no events yet): freeze_purchased.

    return { ok: true, freezes: state.freezes + 1, coins: coins - FREEZE_COST };
  });
}

// --- summary -----------------------------------------------------------------

/** The user's whole gamification state, from ledger aggregates. */
export function gamificationSummary(db: DB, userId: string): GamificationSummary {
  return db.transaction((tx) => {
    const streak = loadStreak(tx, userId);
    const earnedKeys = new Set(
      tx
        .select({ badgeKey: schema.badgesEarned.badgeKey })
        .from(schema.badgesEarned)
        .where(eq(schema.badgesEarned.userId, userId))
        .all()
        .map((r) => r.badgeKey),
    );
    // Canonical BADGES order (SQLite may return rows in index order instead).
    const badges = Object.keys(BADGES).filter((key) => earnedKeys.has(key));
    const lessonsCompleted = tx
      .select({
        courseSlug: schema.lessonCompletions.courseSlug,
        lessonSlug: schema.lessonCompletions.lessonSlug,
      })
      .from(schema.lessonCompletions)
      .where(eq(schema.lessonCompletions.userId, userId))
      .groupBy(schema.lessonCompletions.courseSlug, schema.lessonCompletions.lessonSlug)
      .all().length;

    return {
      xp: sumXp(tx, userId),
      coins: sumCoins(tx, userId),
      streak: { current: streak.current, best: streak.best, freezes: streak.freezes },
      freezes: streak.freezes,
      badges,
      lessonsCompleted,
    };
  });
}
