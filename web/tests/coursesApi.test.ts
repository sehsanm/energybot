// Task 7: the /api/courses catalog view + the me.gamification view. Route
// handlers are thin wrappers (currentUser() reads next/headers cookies, not
// reachable from vitest), so the response shaping lives in
// lib/courses/apiViews.ts and is tested here against a real migrated
// in-memory sqlite db — the applyProfileUpdate precedent.

import { describe, expect, it } from "vitest";
import { makeTestDb, schema } from "@/lib/db";
import { getCourses } from "@/lib/courses/catalog";
import { coursesCatalogView, meGamificationView } from "@/lib/courses/apiViews";

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
