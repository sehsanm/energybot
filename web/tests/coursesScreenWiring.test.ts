// Structural wiring checks for the courses screen (درس‌ها) — the same fs-read
// approach as onboardingWiring.test.ts (the repo has no DOM test env by
// design). The screen must be memory-nav safe (two in-component views, no
// router) and hand lesson opening to the player via the onOpenLesson prop
// (task 11 mounts the player on top of this screen).

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { describe, test, expect } from "vitest";
import { copy } from "../src/content/copy";

const root = join(dirname(__filename), "..");
const screen = readFileSync(join(root, "src/components/screens/CoursesScreen.tsx"), "utf8");

describe("courses screen wiring", () => {
  test("loads the catalog from GET /api/courses through the shared api helper", () => {
    expect(screen).toContain("/api/courses");
    expect(screen).toContain('from "@/lib/client/api"');
  });

  test("renders all three lesson states: locked, available, completed", () => {
    expect(screen).toContain("locked");
    expect(screen).toContain("available");
    expect(screen).toContain("completed");
  });

  test("two in-component views only — memory-nav safe, no router navigation", () => {
    expect(screen).not.toContain("useRouter");
    expect(screen).not.toContain("router.push");
    expect(screen).not.toContain("pushState");
  });

  test("opens lessons through the onOpenLesson prop (player mounts on top)", () => {
    expect(screen).toMatch(/onOpenLesson/);
    expect(screen).toContain("onOpenLesson?.(");
  });

  test("shows the streak/XP strip via StreakFlame", () => {
    expect(screen).toContain("StreakFlame");
  });

  test("strip chips render independently of the flame — xp survives a cold streak", () => {
    // StreakFlame returns null at days 0, so the screen must gate the flame on
    // the streak itself and let the xp/coins chips stand on their own values.
    expect(screen).toMatch(
      /me\.streak\.current > 0 &&\s*<StreakFlame\s+days=\{me\.streak\.current\}\s*\/>/,
    );
    expect(screen).toMatch(/me\.xp > 0 &&/);
    expect(screen).toMatch(/⚡\s*\{toFaDigits\(me\.xp\)\}/);
    // coin chip aria, at parity with the home strip
    expect(screen).toContain("aria-label={copy.home.coinsAria}");
  });

  test("renders the «به‌زودی» ghosts from copy, not a hardcoded list", () => {
    expect(screen).toMatch(/\.ghosts/);
  });

  test("fetch failure and empty catalog render different states (no conflation)", () => {
    // `failed` must be checked before the empty branch: a successful fetch
    // with zero courses must never show the error+retry card.
    const errAt = screen.indexOf(") : failed ? (");
    const emptyAt = screen.indexOf(") : courses.length === 0 ? (");
    expect(errAt).toBeGreaterThan(-1);
    expect(emptyAt).toBeGreaterThan(errAt);
    // the empty branch renders its own copy, not the error strings
    expect(screen).toContain("emptyTitle");
  });
});

describe("coursesScreen copy", () => {
  test("carries the header, progress and accuracy strings in Persian digits", () => {
    const c = copy.coursesScreen;
    expect(c.title).toBe("درس‌ها");
    expect(c.subtitle).toBeTruthy();
    expect(c.soonBadge).toBe("به‌زودی");
    expect(c.progressOf(2, 6)).toBe("۲ از ۶");
    expect(c.accuracyOf(83)).toBe("دقت: ۸۳٪");
  });

  test("carries loading, fetch-failure and retry copy (EmptyState pattern)", () => {
    const c = copy.coursesScreen;
    expect(c.loading).toBeTruthy();
    expect(c.errorTitle).toBeTruthy();
    expect(c.errorDesc).toBeTruthy();
    expect(c.retryBtn).toBeTruthy();
  });

  test("empty catalog has its own copy — distinct from the error strings", () => {
    const c = copy.coursesScreen;
    expect(c.emptyTitle).toBeTruthy();
    expect(c.emptyDesc).toBeTruthy();
    expect(c.emptyTitle).not.toBe(c.errorTitle);
    expect(c.emptyDesc).not.toBe(c.errorDesc);
  });

  test("ghost cards cover all 10 upcoming clusters in the spec order", () => {
    expect(copy.coursesScreen.ghosts.map((g) => g.label)).toEqual([
      "سرمایش",
      "گرمایش",
      "آب گرم",
      "آشپزخانه",
      "لوازم خانگی",
      "روشنایی",
      "بدنه ساختمان",
      "خورشیدی",
      "ایمنی",
      "عادت‌ها",
    ]);
    // every ghost keeps the copy style: an emoji accent per cluster
    for (const g of copy.coursesScreen.ghosts) expect(g.emoji).toBeTruthy();
  });
});
