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
  it("no completions: lesson 1 available, lessons 2–6 locked, zero me, intro audio available", () => {
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
    expect(c.lessons.every((l) => l.hasAudio === true)).toBe(true); // generated intro audio is committed
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
    expect(c.lessons.every((l) => l.hasAudio === true)).toBe(true);
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

describe("validateAnswers — the optional firstTry map (task 11 fix)", () => {
  it("absent map passes through: ok with NO firstTry key (direct API callers unaffected)", () => {
    const body = perfectBody();
    const v = validateAnswers(lesson1, body);
    expect(v).toEqual({ ok: true, answers: body.answers });
    if (v.ok) expect("firstTry" in v).toBe(false);
  });

  it("accepts the map for known exercise ids: returned verbatim", () => {
    const body: Record<string, unknown> = { ...perfectBody(), firstTry: { e1: true, e3: true } };
    expect(validateAnswers(lesson1, body)).toEqual({
      ok: true,
      answers: body.answers,
      firstTry: { e1: true, e3: true },
    });
  });

  it("empty map {} is a legal payload (every exercise was a miss first)", () => {
    const body: Record<string, unknown> = { ...perfectBody(), firstTry: {} };
    expect(validateAnswers(lesson1, body)).toEqual({ ok: true, answers: body.answers, firstTry: {} });
  });

  it("strips unknown keys instead of rejecting (client refs may drift)", () => {
    const body: Record<string, unknown> = { ...perfectBody(), firstTry: { e1: true, nope: true } };
    expect(validateAnswers(lesson1, body)).toEqual({ ok: true, answers: body.answers, firstTry: { e1: true } });
  });

  it.each([
    ["firstTry is an array", { firstTry: ["e1"] }],
    ["firstTry is a string", { firstTry: "e1" }],
    ["firstTry is null", { firstTry: null }],
    ["firstTry is a number", { firstTry: 1 }],
    ["value false (boolean but not strictly true)", { firstTry: { e1: false } }],
    ["value \"true\" (string)", { firstTry: { e1: "true" } }],
    ["value 1", { firstTry: { e1: 1 } }],
  ])("rejects: %s", (_label, extra) => {
    expect(validateAnswers(lesson1, { ...perfectBody(), ...extra })).toEqual({ ok: false });
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

// --- Task 11: GET /api/courses/:courseSlug — the detail payload the lesson
// player consumes (full definitions + per-user state + per-item audio flags).

import { courseDetailView } from "@/lib/courses/apiViews";

describe("courseDetailView", () => {
  it("returns the full course definition: intro text, exercises verbatim (answers/tolerance included), xpBase", () => {
    const db = makeTestDb();
    seedUser(db);
    const v = courseDetailView(db, "u1", course.slug);
    if (!v) throw new Error("known course must resolve");
    const c = v.course;
    expect(c.slug).toBe(course.slug);
    expect(c.title).toBe(course.title);
    expect(c.description).toBe(course.description);
    expect(c.cluster).toBe(course.cluster);
    expect(c.lessons).toHaveLength(6);

    const l1 = c.lessons[0];
    expect(l1.slug).toBe(course.lessons[0].slug);
    expect(l1.title).toBe(course.lessons[0].title);
    expect(l1.articleSlug).toBe(course.lessons[0].articleSlug);
    expect(l1.xpBase).toBe(course.lessons[0].xpBase);
    expect(l1.intro.text).toBe(course.lessons[0].intro.text);
    // exercise definitions ride along verbatim, kind-discriminated with answers
    expect(l1.exercises).toEqual(course.lessons[0].exercises);
    const e6 = l1.exercises.find((e) => e.id === "e6");
    if (!e6 || e6.kind !== "numeric") throw new Error("e6 must be numeric");
    expect(e6).toMatchObject({ unit: "درصد", answer: 30, tolerance: 3 });
  });

  it("fresh user: lesson 1 available, 2–6 locked, no bestAccuracy anywhere", () => {
    const db = makeTestDb();
    seedUser(db);
    const c = courseDetailView(db, "u1", course.slug)!.course;
    expect(c.lessons.map((l) => l.state)).toEqual([
      "available",
      "locked",
      "locked",
      "locked",
      "locked",
      "locked",
    ]);
    expect(c.lessons.every((l) => !("bestAccuracy" in l))).toBe(true);
  });

  it("a completion of lesson 1: completed + bestAccuracy = MAX (3dp), lesson 2 available, 3–6 locked", () => {
    const db = makeTestDb();
    seedUser(db);
    seedCompletion(db, "u1", course.lessons[0].slug, 0.5);
    seedCompletion(db, "u1", course.lessons[0].slug, 5 / 6, 1);
    const c = courseDetailView(db, "u1", course.slug)!.course;
    expect(c.lessons[0]).toMatchObject({ state: "completed", bestAccuracy: 0.833 });
    expect(c.lessons[1].state).toBe("available");
    expect(c.lessons.slice(2).every((l) => l.state === "locked")).toBe(true);
  });

  it("audio flags reflect the generated tree: hasIntroAudio and every hasExerciseAudio entry", () => {
    const db = makeTestDb();
    seedUser(db);
    const c = courseDetailView(db, "u1", course.slug)!.course;
    for (const l of c.lessons) {
      expect(l.hasIntroAudio).toBe(true);
      expect(Object.keys(l.hasExerciseAudio).sort()).toEqual(
        [...course.lessons.find((x) => x.slug === l.slug)!.exercises.map((e) => e.id)].sort(),
      );
      expect(Object.values(l.hasExerciseAudio).every((x) => x === true)).toBe(true);
    }
  });

  it("anonymous caller (userId null): definitions without state/bestAccuracy", () => {
    const db = makeTestDb();
    seedUser(db);
    seedCompletion(db, "u1", course.lessons[0].slug, 1);
    const c = courseDetailView(db, null, course.slug)!.course;
    expect(c.lessons).toHaveLength(6);
    expect(c.lessons.every((l) => !("state" in l) && !("bestAccuracy" in l))).toBe(true);
  });

  it("unknown slug → null (the route's 404)", () => {
    const db = makeTestDb();
    seedUser(db);
    expect(courseDetailView(db, "u1", "no-such-course")).toBeNull();
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
    // the sanitized firstTry map rides along (task 11 fix) — never a raw field
    expect(route).toMatch(/awardLessonCompletion\([\s\S]*?\bv\.firstTry\b/);
    expect(route).not.toContain("body.firstTry");
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

  it("course detail: session-gated thin wrapper over courseDetailView, 404 on unknown slug", () => {
    const route = src("courses", "[courseSlug]", "route.ts");
    expect(route).toContain("currentUser()"); // session gate
    expect(route).toContain("unauth()");
    expect(route).toContain("courseDetailView"); // the only decision is the view's null
    expect(route).toContain('"not_found"');
    expect(route).toMatch(/status:\s*404/);
    // GET only — the detail route is read-only, no mutation surface
    expect(route).not.toContain('"POST"');
    expect(route).not.toContain('"PUT"');
    expect(route).not.toContain('"DELETE"');
  });
});
