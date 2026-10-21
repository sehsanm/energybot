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

  test("the flame renders only for a live streak — chips stand on their own values", () => {
    expect(home).toContain("StreakFlame");
    // The flame is conditioned on the streak at the screen level: a cold
    // streak (StreakFlame returns null at days 0) can no longer take the
    // earned-xp chip down with it.
    expect(home).toMatch(
      /stats\.streak\.current > 0 &&\s*<StreakFlame\s+days=\{stats\.streak\.current\}\s*\/>/,
    );
    expect(home).toMatch(/stats\.xp > 0 &&/);
    expect(home).toMatch(/⚡\s*\{toFaDigits\(stats\.xp\)\}/);
    expect(home).toMatch(/stats\.coins > 0 &&/);
    expect(home).toMatch(/🪙\s*\{toFaDigits\(stats\.coins\)\}/);
    // both chips are announced, at parity with StreakFlame's «استریک …» aria
    expect(home).toContain("aria-label={copy.home.xpAria}");
    expect(home).toContain("aria-label={copy.home.coinsAria}");
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

  test("carries aria labels for the xp and coins chips", () => {
    expect(copy.home.xpAria).toBe("امتیاز");
    expect(copy.home.coinsAria).toBe("سکه‌ها");
  });
});
