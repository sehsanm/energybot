// Gamification engine — the pure economy math (scoring, streak, XP, badges).
// No db, no clock: `today` and timestamps are always injected by callers
// (Task 5 wraps these in transactional writes).

import type { Exercise, Lesson } from "@/lib/courses/schema";
import { daysBetween } from "./tehran";

// --- scoring ---------------------------------------------------------------

export interface ScoredExercise {
  correct: boolean;
  firstTry: boolean;
}

export interface LessonScore {
  perExercise: Map<string, ScoredExercise>;
  /** fraction of ALL lesson exercises answered correctly (0–1) */
  accuracy: number;
  /** fraction of ALL lesson exercises correct on their FIRST presentation (0–1) */
  firstTryAccuracy: number;
}

function isCorrect(ex: Exercise, v: unknown): boolean {
  if (v === undefined) return false; // missing answer = incorrect
  switch (ex.kind) {
    case "mcq":
      return Number(v) === ex.correctIndex;
    case "truefalse":
      return v === ex.answer;
    case "numeric":
    case "scenario":
      return typeof v === "number" && Math.abs(v - ex.answer) <= ex.tolerance;
  }
}

/**
 * Score one submitted answer payload against a lesson. `answers` maps exercise
 * id → submitted value; ids not present in the lesson are ignored, exercises
 * without an entry in `answers` score as incorrect.
 *
 * `firstTryMap` (task 11 fix, optional): the player's report of which ids were
 * answered correctly on their FIRST presentation — a wrong-then-corrected
 * (re-queued) exercise is correct but not first-try. Bounded stakes: the map
 * can only ever REDUCE first-try credit (an id needs `correct` too), and an
 * absent map keeps the legacy single-attempt semantics where `firstTry`
 * coincides with `correct`, so direct API callers are unaffected. Either way
 * `firstTryAccuracy ≤ accuracy` is enforced here, server-side.
 */
export function scoreLesson(
  lesson: Lesson,
  answers: Record<string, unknown>,
  firstTryMap?: Record<string, true>,
): LessonScore {
  const perExercise = new Map<string, ScoredExercise>();
  let correctCount = 0;
  let firstTryCount = 0;
  for (const ex of lesson.exercises) {
    const correct = isCorrect(ex, answers[ex.id]);
    if (correct) correctCount += 1;
    const firstTry = correct && (firstTryMap ? firstTryMap[ex.id] === true : true);
    if (firstTry) firstTryCount += 1;
    perExercise.set(ex.id, { correct, firstTry });
  }
  const total = lesson.exercises.length;
  const accuracy = total === 0 ? 0 : correctCount / total;
  const firstTryAccuracy = total === 0 ? 0 : firstTryCount / total;
  return { perExercise, accuracy, firstTryAccuracy };
}

// --- streak ----------------------------------------------------------------

export interface StreakState {
  current: number;
  best: number;
  lastActiveDate: string | null; // YYYY-MM-DD (Asia/Tehran day), null = never active
  freezes: number;
}

export interface AdvancedStreak {
  state: StreakState;
  changed: boolean;
  freezeConsumed: boolean;
}

/**
 * Advance a streak for activity on `today` (a YYYY-MM-DD Tehran day):
 * - never active → streak 1
 * - gap 1 day → streak + 1
 * - gap 2 days → freeze available ? streak + 1 AND freezes − 1 : reset to 0
 * - gap ≥ 3 days → reset to 0 (a freeze does NOT cover two missed days)
 * - same day → unchanged (`changed: false`)
 * `best` ratchets up whenever current exceeds it. On a reset the activity is
 * still recorded (lastActiveDate moves), so the next consecutive day builds
 * from 0 to 1.
 */
export function advanceStreak(state: StreakState, today: string): AdvancedStreak {
  if (state.lastActiveDate === null) {
    const current = 1;
    return {
      state: { current, best: Math.max(state.best, current), lastActiveDate: today, freezes: state.freezes },
      changed: true,
      freezeConsumed: false,
    };
  }

  const gap = daysBetween(state.lastActiveDate, today);
  if (gap === 0) return { state: { ...state }, changed: false, freezeConsumed: false };
  if (gap === 1) {
    const current = state.current + 1;
    return {
      state: { current, best: Math.max(state.best, current), lastActiveDate: today, freezes: state.freezes },
      changed: true,
      freezeConsumed: false,
    };
  }
  if (gap === 2 && state.freezes > 0) {
    const current = state.current + 1;
    return {
      state: { current, best: Math.max(state.best, current), lastActiveDate: today, freezes: state.freezes - 1 },
      changed: true,
      freezeConsumed: true,
    };
  }
  // gap 2 without a freeze, or gap ≥ 3 (freeze never covers two missed days)
  return { state: { current: 0, best: state.best, lastActiveDate: today, freezes: state.freezes }, changed: true, freezeConsumed: false };
}

// --- xp --------------------------------------------------------------------

export interface LessonXp {
  xp: number;
  perfectBonus: number;
}

/** Lesson XP: round(xpBase × firstTryAccuracy), plus a flat 5 for a perfect lesson. */
export function computeLessonXp(xpBase: number, firstTryAccuracy: number): LessonXp {
  return {
    xp: Math.round(xpBase * firstTryAccuracy),
    perfectBonus: firstTryAccuracy === 1 ? 5 : 0,
  };
}

// --- badges ----------------------------------------------------------------

export interface BadgeInfo {
  title: string;
  description: string;
}

/** The 8 stable badge keys with Persian copy, in award order. */
export const BADGES: Record<string, BadgeInfo> = {
  first_lesson: { title: "اولین قدم", description: "اولین درس دوره را کامل کردی." },
  first_perfect: { title: "بی‌نقص", description: "اولین درسی را بدون حتی یک غلط به پایان رساندی." },
  streak_3: { title: "سه روز پیوسته", description: "سه روز پشت‌سرهم سر درس‌ها حاضر شدی." },
  streak_7: { title: "یک هفته پیوسته", description: "هفت روز پشت‌سرهم یادگیری را رها نکردی." },
  course_complete_1: { title: "فارغ‌التحصیل", description: "اولین دوره‌ی آموزشی را کامل کردی." },
  five_perfect: { title: "پنج درس بی‌نقص", description: "پنج درس را بدون حتی یک غلط تمام کردی." },
  xp_100: { title: "۱۰۰ امتیاز", description: "مجموع امتیازهایت به ۱۰۰ رسید." },
  comeback: { title: "بازگشت", description: "بعد از قطع شدن زنجیره‌ی روزها، به یادگیری برگشتی." },
};

export interface BadgeSnapshot {
  totalXp: number;
  completions: { firstTryAccuracy: number }[];
  perfectCount: number;
  streakCurrent: number;
  streakBest: number;
  coursesCompleted: number;
  /** true when this completion happens right after a streak reset (caller-computed) */
  comeback: boolean;
}

/**
 * All badge keys whose threshold the snapshot meets, in BADGES order, each at
 * most once. Pure threshold check — "newly earned" is the caller diffing this
 * list against the user's existing badges_earned rows.
 */
export function evaluateBadges(s: BadgeSnapshot): string[] {
  const earned: string[] = [];
  if (s.completions.length >= 1) earned.push("first_lesson");
  if (s.perfectCount >= 1) earned.push("first_perfect");
  if (s.streakCurrent >= 3) earned.push("streak_3");
  if (s.streakCurrent >= 7) earned.push("streak_7");
  if (s.coursesCompleted >= 1) earned.push("course_complete_1");
  if (s.perfectCount >= 5) earned.push("five_perfect");
  if (s.totalXp >= 100) earned.push("xp_100");
  if (s.comeback) earned.push("comeback");
  return earned;
}
