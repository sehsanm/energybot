// Gamification engine (pure functions — no db, no clock reads; `today`/ts are
// injected): scoreLesson per-kind correctness + tolerance edges, advanceStreak
// day-gap rules (freeze covers one missed day only), computeLessonXp rounding,
// and evaluateBadges thresholds for all 8 badge keys.

import { describe, expect, it } from "vitest";
import type { Lesson } from "@/lib/courses/schema";
import { daysBetween, tehranDate } from "@/lib/gamification/tehran";
import { BADGES, advanceStreak, computeLessonXp, evaluateBadges, scoreLesson } from "@/lib/gamification/engine";

// One exercise of each kind (ids stable across tests). Tolerances chosen so
// the ±edge cases below differ from the answer by exactly ±tolerance.
const lesson: Lesson = {
  slug: "test-lesson",
  title: "درس آزمایشی",
  articleSlug: "bills/test",
  intro: { text: "مقدمه" },
  xpBase: 10,
  exercises: [
    { kind: "mcq", id: "e1", prompt: "؟", options: ["a", "b", "c", "d"], correctIndex: 2, explanation: "" },
    { kind: "truefalse", id: "e2", prompt: "؟", answer: true, explanation: "" },
    { kind: "numeric", id: "e3", prompt: "؟", unit: "kWh", answer: 100, tolerance: 5, explanation: "" },
    { kind: "scenario", id: "e4", prompt: "؟", inputs: "", unit: "ریال", answer: 37.5, tolerance: 0.25, explanation: "" },
    { kind: "mcq", id: "e5", prompt: "؟", options: ["a", "b", "c", "d"], correctIndex: 0, explanation: "" },
  ],
};

describe("tehranDate / daysBetween", () => {
  it("maps a UTC timestamp to the Asia/Tehran calendar day (UTC+3:30)", () => {
    // 2026-10-20 20:30 UTC == 2026-10-21 00:00 Tehran — the day boundary.
    expect(tehranDate(Date.UTC(2026, 9, 20, 20, 30))).toBe("2026-10-21");
    expect(tehranDate(Date.UTC(2026, 9, 20, 20, 29))).toBe("2026-10-20");
    expect(tehranDate(Date.UTC(2026, 9, 21, 12, 0))).toBe("2026-10-21");
  });

  it("daysBetween counts calendar days (b − a), across month and year bounds", () => {
    expect(daysBetween("2026-10-20", "2026-10-20")).toBe(0);
    expect(daysBetween("2026-10-20", "2026-10-21")).toBe(1);
    expect(daysBetween("2026-10-19", "2026-10-21")).toBe(2);
    expect(daysBetween("2026-09-30", "2026-10-01")).toBe(1);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-01-01", "2026-12-31")).toBe(364);
  });
});

describe("scoreLesson", () => {
  it("mcq: correct iff Number(v) === correctIndex (number or numeric string)", () => {
    const r1 = scoreLesson(lesson, { e1: 2 });
    expect(r1.perExercise.get("e1")).toEqual({ correct: true, firstTry: true });
    const r2 = scoreLesson(lesson, { e1: "2" });
    expect(r2.perExercise.get("e1")?.correct).toBe(true);
    const r3 = scoreLesson(lesson, { e1: 1 });
    expect(r3.perExercise.get("e1")?.correct).toBe(false);
  });

  it("truefalse: correct iff v === answer (strict boolean)", () => {
    expect(scoreLesson(lesson, { e2: true }).perExercise.get("e2")?.correct).toBe(true);
    expect(scoreLesson(lesson, { e2: false }).perExercise.get("e2")?.correct).toBe(false);
    expect(scoreLesson(lesson, { e2: "true" }).perExercise.get("e2")?.correct).toBe(false);
    expect(scoreLesson(lesson, { e2: 1 }).perExercise.get("e2")?.correct).toBe(false);
  });

  it("numeric: |v − answer| ≤ tolerance, inclusive at both edges", () => {
    expect(scoreLesson(lesson, { e3: 100 }).perExercise.get("e3")?.correct).toBe(true);
    expect(scoreLesson(lesson, { e3: 95 }).perExercise.get("e3")?.correct).toBe(true);
    expect(scoreLesson(lesson, { e3: 105 }).perExercise.get("e3")?.correct).toBe(true);
    expect(scoreLesson(lesson, { e3: 94.99 }).perExercise.get("e3")?.correct).toBe(false);
    expect(scoreLesson(lesson, { e3: 105.01 }).perExercise.get("e3")?.correct).toBe(false);
    // non-number values are never correct for numeric/scenario
    expect(scoreLesson(lesson, { e3: "100" }).perExercise.get("e3")?.correct).toBe(false);
  });

  it("scenario: same tolerance rule as numeric", () => {
    expect(scoreLesson(lesson, { e4: 37.7 }).perExercise.get("e4")?.correct).toBe(true); // 0.20 ≤ 0.25
    expect(scoreLesson(lesson, { e4: 37.25 }).perExercise.get("e4")?.correct).toBe(true); // 0.25 ≤ 0.25
    expect(scoreLesson(lesson, { e4: 37.76 }).perExercise.get("e4")?.correct).toBe(false); // 0.26 > 0.25
  });

  it("missing answer counts as incorrect; accuracy is over ALL exercises", () => {
    const r = scoreLesson(lesson, { e1: 2, e2: true, e3: 100 }); // e4, e5 missing
    expect(r.perExercise.get("e4")).toEqual({ correct: false, firstTry: false });
    expect(r.perExercise.get("e5")?.correct).toBe(false);
    expect(r.perExercise.size).toBe(5);
    expect(r.accuracy).toBe(3 / 5);
    expect(r.firstTryAccuracy).toBe(3 / 5);
  });

  it("unknown answer ids in the payload are ignored", () => {
    const withJunk = scoreLesson(lesson, { e1: 2, e2: true, e3: 100, e4: 37.5, e5: 0, e99: 42, junk: "x" });
    const clean = scoreLesson(lesson, { e1: 2, e2: true, e3: 100, e4: 37.5, e5: 0 });
    expect(withJunk.accuracy).toBe(1);
    expect(withJunk.firstTryAccuracy).toBe(1);
    expect(withJunk.perExercise.size).toBe(5);
    expect(withJunk.accuracy).toBe(clean.accuracy);
  });

  it("firstTry map present: a corrected retry is correct but NOT first-try — firstTryAccuracy ≤ accuracy", () => {
    const full = { e1: 2, e2: true, e3: 100, e4: 37.5, e5: 0 }; // all correct…
    // …but the map says e1 was a MISS first (re-queued, corrected on retry)
    const r = scoreLesson(lesson, full, { e2: true, e3: true, e4: true, e5: true });
    expect(r.accuracy).toBe(1);
    expect(r.firstTryAccuracy).toBe(4 / 5);
    expect(r.perExercise.get("e1")).toEqual({ correct: true, firstTry: false });
    expect(r.perExercise.get("e2")).toEqual({ correct: true, firstTry: true });
  });

  it("firstTry map cannot GRANT first-try credit to a wrong answer", () => {
    const r = scoreLesson(lesson, { e1: 0 }, { e1: true }); // e1 actually wrong
    expect(r.perExercise.get("e1")).toEqual({ correct: false, firstTry: false });
    expect(r.firstTryAccuracy).toBe(0);
  });

  it("firstTry map absent: legacy semantics — firstTry coincides with correct (direct API callers unaffected)", () => {
    const full = { e1: 2, e2: true, e3: 100, e4: 37.5, e5: 0 };
    const r = scoreLesson(lesson, full);
    expect(r.firstTryAccuracy).toBe(1);
    for (const ex of lesson.exercises) expect(r.perExercise.get(ex.id)?.firstTry).toBe(true);
  });

  it("all-wrong answers give accuracy 0; all-correct give 1", () => {
    expect(scoreLesson(lesson, {}).accuracy).toBe(0);
    const full = { e1: 2, e2: true, e3: 96, e4: 37.5, e5: 0 };
    expect(scoreLesson(lesson, full).accuracy).toBe(1);
  });
});

describe("advanceStreak", () => {
  it("first-ever activity starts the streak at 1 (and best follows)", () => {
    const r = advanceStreak({ current: 0, best: 0, lastActiveDate: null, freezes: 1 }, "2026-10-21");
    expect(r).toEqual({
      state: { current: 1, best: 1, lastActiveDate: "2026-10-21", freezes: 1 },
      changed: true,
      freezeConsumed: false,
    });
  });

  it("same-day second activity changes nothing (changed: false)", () => {
    const state = { current: 3, best: 5, lastActiveDate: "2026-10-21", freezes: 1 };
    const r = advanceStreak(state, "2026-10-21");
    expect(r.state).toEqual(state);
    expect(r.changed).toBe(false);
    expect(r.freezeConsumed).toBe(false);
  });

  it("yesterday activity: +1 and best tracks the new current", () => {
    const r = advanceStreak({ current: 5, best: 5, lastActiveDate: "2026-10-20", freezes: 0 }, "2026-10-21");
    expect(r.state).toEqual({ current: 6, best: 6, lastActiveDate: "2026-10-21", freezes: 0 });
    expect(r.changed).toBe(true);
    expect(r.freezeConsumed).toBe(false);
  });

  it("yesterday activity: best stays when already higher", () => {
    const r = advanceStreak({ current: 3, best: 9, lastActiveDate: "2026-10-20", freezes: 0 }, "2026-10-21");
    expect(r.state).toEqual({ current: 4, best: 9, lastActiveDate: "2026-10-21", freezes: 0 });
  });

  it("2-day gap with a freeze: +1 and the freeze is consumed (month boundary)", () => {
    // 2026-09-29 → 2026-10-01 is 2 calendar days.
    const r = advanceStreak({ current: 4, best: 9, lastActiveDate: "2026-09-29", freezes: 1 }, "2026-10-01");
    expect(r).toEqual({
      state: { current: 5, best: 9, lastActiveDate: "2026-10-01", freezes: 0 },
      changed: true,
      freezeConsumed: true,
    });
  });

  it("2-day gap without a freeze: streak resets to 0 (lastActiveDate still moves)", () => {
    const r = advanceStreak({ current: 4, best: 9, lastActiveDate: "2026-10-19", freezes: 0 }, "2026-10-21");
    expect(r).toEqual({
      state: { current: 0, best: 9, lastActiveDate: "2026-10-21", freezes: 0 },
      changed: true,
      freezeConsumed: false,
    });
  });

  it("3-day gap with a freeze: reset to 0 — freeze does NOT cover two missed days", () => {
    const r = advanceStreak({ current: 4, best: 9, lastActiveDate: "2026-10-18", freezes: 1 }, "2026-10-21");
    expect(r).toEqual({
      state: { current: 0, best: 9, lastActiveDate: "2026-10-21", freezes: 1 },
      changed: true,
      freezeConsumed: false,
    });
  });

  it("after a reset, the next consecutive day builds from 0 to 1", () => {
    const reset = advanceStreak({ current: 4, best: 9, lastActiveDate: "2026-10-19", freezes: 0 }, "2026-10-21");
    const next = advanceStreak(reset.state, "2026-10-22");
    expect(next.state).toEqual({ current: 1, best: 9, lastActiveDate: "2026-10-22", freezes: 0 });
  });
});

describe("computeLessonXp", () => {
  it("xp = round(xpBase × firstTryAccuracy); no bonus below 1", () => {
    expect(computeLessonXp(10, 0.66)).toEqual({ xp: 7, perfectBonus: 0 }); // round(6.6)
    expect(computeLessonXp(10, 0)).toEqual({ xp: 0, perfectBonus: 0 });
  });

  it("perfect lesson (firstTryAccuracy === 1) adds a flat 5 bonus", () => {
    expect(computeLessonXp(10, 1)).toEqual({ xp: 10, perfectBonus: 5 });
  });

  it("rounds half up", () => {
    expect(computeLessonXp(10, 0.25).xp).toBe(3); // round(2.5)
    expect(computeLessonXp(10, 0.65).xp).toBe(7); // round(6.5)
  });
});

describe("BADGES / evaluateBadges", () => {
  const empty = {
    totalXp: 0,
    completions: [] as { firstTryAccuracy: number }[],
    perfectCount: 0,
    streakCurrent: 0,
    streakBest: 0,
    coursesCompleted: 0,
    comeback: false,
  };

  it("BADGES defines exactly the 8 stable keys with Persian title/description", () => {
    expect(Object.keys(BADGES).sort()).toEqual(
      ["comeback", "course_complete_1", "five_perfect", "first_lesson", "first_perfect", "streak_3", "streak_7", "xp_100"].sort(),
    );
    for (const b of Object.values(BADGES)) {
      expect(b.title.length).toBeGreaterThan(0);
      expect(b.description.length).toBeGreaterThan(0);
      // Persian text: contains at least one Arabic-script character.
      expect(b.title).toMatch(/[؀-ۿ]/);
      expect(b.description).toMatch(/[؀-ۿ]/);
    }
  });

  it("first_lesson: any completion", () => {
    expect(evaluateBadges({ ...empty, completions: [{ firstTryAccuracy: 0.4 }] })).toEqual(["first_lesson"]);
  });

  it("first_perfect: perfectCount ≥ 1", () => {
    expect(evaluateBadges({ ...empty, perfectCount: 1 })).toContain("first_perfect");
    expect(evaluateBadges({ ...empty, perfectCount: 1 })).not.toContain("five_perfect");
  });

  it("five_perfect: perfectCount ≥ 5", () => {
    expect(evaluateBadges({ ...empty, perfectCount: 5 })).toContain("five_perfect");
    expect(evaluateBadges({ ...empty, perfectCount: 4 })).not.toContain("five_perfect");
  });

  it("streak_3 / streak_7 on streakCurrent", () => {
    expect(evaluateBadges({ ...empty, streakCurrent: 3 })).toEqual(["streak_3"]);
    expect(evaluateBadges({ ...empty, streakCurrent: 6 })).toEqual(["streak_3"]);
    expect(evaluateBadges({ ...empty, streakCurrent: 7 }).sort()).toEqual(["streak_3", "streak_7"]);
    expect(evaluateBadges({ ...empty, streakCurrent: 2 })).toEqual([]);
    // best alone (without current) earns nothing
    expect(evaluateBadges({ ...empty, streakBest: 10 })).toEqual([]);
  });

  it("course_complete_1: coursesCompleted ≥ 1", () => {
    expect(evaluateBadges({ ...empty, coursesCompleted: 1 })).toEqual(["course_complete_1"]);
  });

  it("xp_100: totalXp ≥ 100", () => {
    expect(evaluateBadges({ ...empty, totalXp: 100 })).toEqual(["xp_100"]);
    expect(evaluateBadges({ ...empty, totalXp: 99 })).toEqual([]);
  });

  it("comeback: only when the flag is passed", () => {
    expect(evaluateBadges({ ...empty, comeback: true })).toEqual(["comeback"]);
    expect(evaluateBadges({ ...empty, comeback: false })).toEqual([]);
  });

  it("a maxed-out snapshot earns all 8, each exactly once (no duplicates)", () => {
    const keys = evaluateBadges({
      totalXp: 150,
      completions: [{ firstTryAccuracy: 1 }, { firstTryAccuracy: 0.8 }],
      perfectCount: 6,
      streakCurrent: 9,
      streakBest: 9,
      coursesCompleted: 2,
      comeback: true,
    });
    expect(keys).toHaveLength(8);
    expect(new Set(keys).size).toBe(8);
    expect([...keys].sort()).toEqual(Object.keys(BADGES).sort());
  });
});
