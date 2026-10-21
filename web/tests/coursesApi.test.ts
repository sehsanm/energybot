// Task 7: the /api/courses catalog view + the me.gamification view. Route
// handlers are thin wrappers (currentUser() reads next/headers cookies, not
// reachable from vitest), so the response shaping lives in
// lib/courses/apiViews.ts and is tested here against a real migrated
// in-memory sqlite db — the applyProfileUpdate precedent.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTestDb, schema } from "@/lib/db";
import { getCourses } from "@/lib/courses/catalog";
import { coursesCatalogView, meGamificationView } from "@/lib/courses/apiViews";
import { validateAnswers } from "@/lib/courses/validateAnswers";
import { awardLessonCompletion, purchaseFreeze, type AwardOutcome } from "@/lib/gamification/awards";

type DB = ReturnType<typeof makeTestDb>;

const course = getCourses()[0]; // bill-literacy — 6 lessons
const T0 = Date.UTC(2026, 9, 21, 12, 0);

function seedUser(db: DB, id = "u1") {
  db.insert(schema.users).values({ id, createdAt: T0 }).run();
}

/** A raw completion row — the view only reads, so no need to run the award path. */
function seedCompletion(db: DB, userId: string, lessonSlug: string, accuracy: number, n = 0) {
  db.insert(schema.lessonCompletions)
    .values({
      id: `c-${userId}-${lessonSlug}-${n}`,
      userId,
      courseSlug: course.slug,
      lessonSlug,
      accuracy,
      firstTryAccuracy: accuracy,
      xp: 0,
      createdAt: T0,
    })
    .run();
}

describe("coursesCatalogView — authed", () => {
  it("no completions: lesson 1 available, lessons 2–6 locked, zero me, hasAudio false", () => {
    const db = makeTestDb();
    seedUser(db);
    const v = coursesCatalogView(db, "u1");

    expect(v.courses).toHaveLength(1);
    const c = v.courses[0];
    expect(c.slug).toBe(course.slug);
    expect(c.title).toBe(course.title);
    expect(c.description).toBe(course.description);
    expect(c.lessons).toHaveLength(6);
    expect(c.lessons.map((l) => l.state)).toEqual(["available", "locked", "locked", "locked", "locked", "locked"]);
    expect(c.lessons.every((l) => l.hasAudio === false)).toBe(true); // no audio tree yet
    expect(c.lessons.every((l) => !("bestAccuracy" in l))).toBe(true);

    expect(v.me).toEqual({ xp: 0, coins: 0, streak: { current: 0, best: 0, freezes: 0 }, badges: [] });
  });

  it("a completion of lesson 1: lesson 1 completed with bestAccuracy = MAX rounded to 3dp, lesson 2 unlocked, 3–6 still locked", () => {
    const db = makeTestDb();
    seedUser(db);
    seedCompletion(db, "u1", course.lessons[0].slug, 0.5);
    seedCompletion(db, "u1", course.lessons[0].slug, 5 / 6, 1); // replay with a better score

    const c = coursesCatalogView(db, "u1").courses[0];
    expect(c.lessons[0]).toMatchObject({ state: "completed", bestAccuracy: 0.833 });
    expect(c.lessons[1].state).toBe("available");
    expect(c.lessons.slice(2).every((l) => l.state === "locked")).toBe(true);
    expect(c.lessons.slice(1).every((l) => !("bestAccuracy" in l))).toBe(true);
  });
});

describe("coursesCatalogView — anonymous", () => {
  it("catalog-only shape: no state/bestAccuracy on lessons, no me key", () => {
    const db = makeTestDb();
    seedUser(db);
    seedCompletion(db, "u1", course.lessons[0].slug, 1);
    const v = coursesCatalogView(db, null);

    expect("me" in v).toBe(false);
    const c = v.courses[0];
    expect(c.lessons.map((l) => l.slug)).toEqual(course.lessons.map((l) => l.slug));
    expect(c.lessons.every((l) => !("state" in l) && !("bestAccuracy" in l))).toBe(true);
    expect(c.lessons.every((l) => l.hasAudio === false)).toBe(true);
  });
});

describe("meGamificationView", () => {
  it("zero-state for a fresh user (no rows at all)", () => {
    const db = makeTestDb();
    seedUser(db);
    expect(meGamificationView(db, "u1")).toEqual({
      xp: 0,
      coins: 0,
      streak: { current: 0, best: 0, freezes: 0 },
      freezes: 0,
      badges: [],
      lessonsCompleted: 0,
    });
  });
});

// --- Task 8: POST …/lessons/:lessonSlug/complete + POST /api/gamification/freeze
//
// Both routes are session+CSRF-gated thin wrappers (currentUser() reads
// next/headers cookies, not reachable from vitest — Task 7's note). What the
// routes actually decide is exercised here at the layers they delegate to:
// validateAnswers — the load-bearing gate that must run BEFORE the engine (the
// engine's Number() coercion would otherwise treat null/"" as index 0) — and
// the award/freeze outcomes the routes map 1:1 onto HTTP statuses. The
// auth/CSRF/ordering wiring itself is asserted structurally at the bottom
// (onboardingWiring.test.ts precedent).

const lesson1 = course.lessons[0]; // 01-tariff-tiers: e1 mcq, e2 mcq, e3 tf, e4 mcq, e5 mcq, e6 numeric

/** A completion body whose answers are each exercise's correct value, derived
 *  from the course definition itself (mcq → correctIndex, truefalse → answer,
 *  numeric/scenario → answer). `extra` simulates fabricated client claims. */
function perfectBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const ex of lesson1.exercises) {
    if (ex.kind === "mcq") answers[ex.id] = ex.correctIndex;
    else if (ex.kind === "truefalse") answers[ex.id] = ex.answer;
    else answers[ex.id] = ex.answer;
  }
  return { answers, ...extra };
}

function unwrapAward(r: AwardOutcome) {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.result;
}

describe("validateAnswers — the gate before the engine", () => {
  it("accepts a perfect payload derived from the course definition and returns the answers verbatim", () => {
    const body = perfectBody();
    expect(validateAnswers(lesson1, body)).toEqual({ ok: true, answers: body.answers });
  });

  it("accepts partial answers — ids with no entry simply score incorrect downstream", () => {
    const answers = { e2: 2 }; // one correct mcq answer out of six exercises
    expect(validateAnswers(lesson1, { answers })).toEqual({ ok: true, answers });
  });

  it("ignores extra body fields: xp/accuracy claims never make it into the validated answers", () => {
    const clean = validateAnswers(lesson1, perfectBody());
    const withClaims = validateAnswers(lesson1, perfectBody({ xp: 9999, accuracy: 1, badges: ["xp_100"] }));
    expect(withClaims).toEqual(clean);
  });

  it.each([
    ["missing body (route hands null on a JSON parse failure)", null],
    ["body is an array", [1, 2]],
    ["body is a string", "nope"],
    ["answers key missing entirely", {}],
    ["answers is null", { answers: null }],
    ["answers is an array", { answers: [1] }],
    ["answers is a string", { answers: "e1" }],
    ["answers has an id that is not an exercise of the lesson", { answers: { nope: 1 } }],
    ["answers mixes a valid id with an unknown id", { answers: { e1: 0, nope: 1 } }],
    ["mcq answer 5 (out of the 0–3 option range)", { answers: { e1: 5 } }],
    ["mcq answer 1.5 (not an integer)", { answers: { e1: 1.5 } }],
    ["mcq answer -1", { answers: { e1: -1 } }],
    ["mcq answer \"2\" (string index)", { answers: { e1: "2" } }],
    ["mcq answer null (Number(null)===0 trap)", { answers: { e1: null } }],
    ["truefalse answer \"true\" (string)", { answers: { e3: "true" } }],
    ["truefalse answer 1 (number)", { answers: { e3: 1 } }],
    ["numeric answer \"100\" (string)", { answers: { e6: "100" } }],
    ["numeric answer NaN", { answers: { e6: NaN } }],
    ["numeric answer Infinity", { answers: { e6: Infinity } }],
    ["numeric answer is an object", { answers: { e6: { value: 30 } } }],
  ])("rejects: %s", (_label, body) => {
    expect(validateAnswers(lesson1, body)).toEqual({ ok: false });
  });
});

describe("complete — the award the route returns (server-computed)", () => {
  it("perfect answers → full XP: xp 10 + perfect 5, daily coin, streak 1, first_lesson + first_perfect", () => {
    const db = makeTestDb();
    seedUser(db);
    const v = validateAnswers(lesson1, perfectBody());
    if (!v.ok) throw new Error("fixture must validate");
    // 6/6 correct: xp = round(10 × 1) = 10, +5 perfect bonus, first lesson of the Tehran day → 1 coin.
    expect(awardLessonCompletion(db, "u1", course.slug, lesson1.slug, v.answers, T0)).toEqual({
      ok: true,
      result: {
        accuracy: 1,
        firstTryAccuracy: 1,
        xpAwarded: 15,
        coinsAwarded: 1,
        newBadges: ["first_lesson", "first_perfect"],
        streak: { current: 1, best: 1, freezes: 0 },
      },
    });
  });

  it("wrong answers → reduced XP the server recomputed (4/6: xp 7, no bonus, no first_perfect)", () => {
    const db = makeTestDb();
    seedUser(db);
    const perfect = perfectBody().answers as Record<string, unknown>;
    const answers = { ...perfect, e1: 1, e3: false }; // two exercises answered wrong
    const v = validateAnswers(lesson1, { answers });
    if (!v.ok) throw new Error("fixture must validate");
    // round(10 × 4/6) = 7, accuracy below 1 → no perfect bonus.
    expect(awardLessonCompletion(db, "u1", course.slug, lesson1.slug, v.answers, T0)).toEqual({
      ok: true,
      result: {
        accuracy: 4 / 6,
        firstTryAccuracy: 4 / 6,
        xpAwarded: 7,
        coinsAwarded: 1,
        newBadges: ["first_lesson"],
        streak: { current: 1, best: 1, freezes: 0 },
      },
    });
  });

  it("fabricated xp/accuracy in the body change nothing: award identical to the no-extras call", () => {
    const db = makeTestDb();
    seedUser(db, "u1");
    seedUser(db, "u2");
    const withClaims = validateAnswers(lesson1, perfectBody({ xp: 9999, accuracy: 1 }));
    const clean = validateAnswers(lesson1, perfectBody());
    if (!withClaims.ok || !clean.ok) throw new Error("fixtures must validate");
    const r1 = unwrapAward(awardLessonCompletion(db, "u1", course.slug, lesson1.slug, withClaims.answers, T0));
    const r2 = unwrapAward(awardLessonCompletion(db, "u2", course.slug, lesson1.slug, clean.answers, T0));
    expect(r1).toEqual(r2); // deep equal: xpAwarded 15, not 9999; accuracy 1, not the body's claim
  });

  it("unknown lesson or course is not_found — the route's 404", () => {
    const db = makeTestDb();
    seedUser(db);
    const v = validateAnswers(lesson1, perfectBody());
    if (!v.ok) throw new Error("fixture must validate");
    expect(awardLessonCompletion(db, "u1", course.slug, "99-does-not-exist", v.answers, T0)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(awardLessonCompletion(db, "u1", "no-such-course", lesson1.slug, v.answers, T0)).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("freeze — the outcomes the route maps to 200/400", () => {
  it("success once → { freezes: 1, coins }, immediate retry → max_freezes, broke user → insufficient_coins", () => {
    const db = makeTestDb();
    seedUser(db);
    for (let i = 0; i < 6; i++) {
      db.insert(schema.coinEvents)
        .values({ id: `seed-coin-${i}`, userId: "u1", kind: "daily_lesson", amount: 1, ref: "seed", createdAt: T0 })
        .run();
    }
    expect(purchaseFreeze(db, "u1", T0)).toEqual({ ok: true, freezes: 1, coins: 1 }); // 200 { freezes, coins }
    expect(purchaseFreeze(db, "u1", T0)).toEqual({ ok: false, error: "max_freezes" }); // 400

    const broke = makeTestDb();
    seedUser(broke);
    expect(purchaseFreeze(broke, "u1", T0)).toEqual({ ok: false, error: "insufficient_coins" }); // 400
  });
});

describe("complete + freeze route wiring (structural — no route-boundary harness exists)", () => {
  const src = (...parts: string[]) => readFileSync(join(dirname(__filename), "..", "src", "app", "api", ...parts), "utf8");

  it("complete: session + CSRF gated, validated answers (only) reach the engine, 404/400 mappings", () => {
    const route = src("courses", "[courseSlug]", "lessons", "[lessonSlug]", "complete", "route.ts");
    expect(route).toContain("currentUser()"); // session gate
    expect(route).toContain("unauth()");
    expect(route).toContain("csrfGuard"); // CSRF gate → 403
    expect(route).toContain("badCsrf()");
    // the gate runs BEFORE the engine, and only its sanitized answers are passed on
    expect(route.indexOf("validateAnswers")).toBeLessThan(route.indexOf("awardLessonCompletion"));
    expect(route).toMatch(/awardLessonCompletion\([\s\S]*?\bv\.answers\b/);
    expect(route).toContain('"not_found"');
    expect(route).toMatch(/status:\s*404/);
    expect(route).toContain('"bad request"');
    expect(route).toMatch(/status:\s*400/);
    // no client claim field is ever read from the body
    expect(route).not.toContain("body.xp");
    expect(route).not.toContain("body.accuracy");
  });

  it("freeze: session + CSRF gated, purchaseFreeze decides, errors map to 400", () => {
    const route = src("gamification", "freeze", "route.ts");
    expect(route).toContain("currentUser()");
    expect(route).toContain("unauth()");
    expect(route).toContain("csrfGuard");
    expect(route).toContain("badCsrf()");
    expect(route).toContain("purchaseFreeze");
    expect(route).toMatch(/status:\s*400/);
  });
});
