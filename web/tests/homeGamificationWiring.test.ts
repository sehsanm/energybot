// Structural wiring checks for /home (task 12): the درس‌ها quick action going
// live and the streak/XP strip beside the greeting. Same fs-read approach as
// onboardingWiring.test.ts (the repo has no DOM test env by design) — these
// read the component source and assert the wiring, not the pixels.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { describe, test, expect } from "vitest";
import { copy } from "../src/content/copy";

const root = join(dirname(__filename), "..");
const home = readFileSync(join(root, "src/components/screens/HomeScreen.tsx"), "utf8");

describe("home gamification wiring", () => {
  test("types the /api/me gamification block (optional — older payloads stay safe)", () => {
    expect(home).toMatch(/gamification\?:/);
    expect(home).toMatch(/streak:\s*\{\s*current/);
  });

  test("renders StreakFlame from the real streak and xp once /api/me answers", () => {
    expect(home).toContain("StreakFlame");
    expect(home).toMatch(/StreakFlame\s+days=\{stats\.streak\.current\}\s+xp=\{stats\.xp\}/);
  });

  test("the strip is zero-guarded — nothing renders until a counter is nonzero", () => {
    // All three counters must appear in one guard so a fresh account keeps
    // the bare greeting instead of a row of empty chips.
    expect(home).toMatch(/xp > 0 \|\|[\s\S]*?coins > 0 \|\|[\s\S]*?streak\.current > 0/);
    // The old placeholder (flame pinned at zero) must be gone.
    expect(home).not.toContain("days={0}");
  });

  test("counter values are formatted in Persian digits", () => {
    expect(home).toContain("toFaDigits");
  });

  test("the درس‌ها quick action navigates via go(\"courses\")", () => {
    expect(home).toContain('go("courses")');
  });

  test("the درس‌ها tile is no longer a به‌زودی ghost", () => {
    expect(home).not.toContain("به‌زودی");
  });
});

describe("home copy", () => {
  test("carries the live درس‌ها tile label from copy, not an inline string", () => {
    expect(copy.home.lessonsTile).toBe("درس‌ها");
    expect(home).toContain("copy.home.lessonsTile");
  });
});
