// Structural wiring checks for the lesson player (task 11) — the same fs-read
// approach as coursesScreenWiring.test.ts (the repo has no DOM test env by
// design). The player is a full-screen overlay mounted by CoursesScreen: it
// must consume the detail + complete routes, handle all four exercise kinds,
// stay memory-nav safe and celebrate the summary — all verifiable at the
// source level, with the copy contract checked against content/copy.ts.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { describe, test, expect } from "vitest";
import { copy } from "../src/content/copy";

const root = join(dirname(__filename), "..");
const player = readFileSync(join(root, "src/components/courses/LessonPlayer.tsx"), "utf8");
const screen = readFileSync(join(root, "src/components/screens/CoursesScreen.tsx"), "utf8");

describe("lesson player wiring", () => {
  test("fetches the course detail route with the courseSlug path param", () => {
    expect(player).toContain("`/api/courses/${courseSlug}`");
  });

  test("POSTs the complete route with the exact path shape and an answers-only body", () => {
    expect(player).toContain("`/api/courses/${courseSlug}/lessons/${lessonSlug}/complete`");
    expect(player).toContain('"POST"');
    expect(player).toMatch(/body:\s*\{\s*answers\b/);
  });

  test("submits the first-try map alongside answers (miss-then-corrected ids excluded)", () => {
    expect(player).toMatch(/body:\s*\{\s*answers,\s*firstTry\b/);
    expect(player).toContain("firstTryRef");
  });

  test("renders all four exercise kinds", () => {
    for (const kind of ["mcq", "truefalse", "numeric", "scenario"]) {
      expect(player).toContain(`"${kind}"`);
    }
  });

  test("normalizes Persian digits before parsing numeric input", () => {
    expect(player).toContain("normalizeFaDigits");
  });

  test("no routing — the player is memory-nav safe like the screen under it", () => {
    expect(player).not.toContain("useRouter");
    expect(player).not.toContain("router.push");
    expect(player).not.toContain("pushState");
  });

  test("in-component step machine: intro | exercising | summary", () => {
    for (const step of ["intro", "exercising", "summary"]) {
      expect(player).toContain(`"${step}"`);
    }
  });

  test("a wrong answer is re-queued exactly once (repeat guard)", () => {
    expect(player).toMatch(/repeated|repeatQueue/);
  });

  test("summary celebrates: Confetti via nextBurst, fired only on first completion", () => {
    expect(player).toContain("<Confetti");
    expect(player).toContain("nextBurst");
    expect(player).toContain("lesson_completed");
    // first completion is decided from the lesson state fetched BEFORE playing
    expect(player).toMatch(/state !== "completed"|firstCompletion/);
  });

  test("intro audio button gated on hasIntroAudio — tap to play, never autoplay", () => {
    expect(player).toContain("hasIntroAudio");
    expect(player).not.toContain("autoPlay");
  });

  test("summary renders the server-computed award, not client claims", () => {
    expect(player).toContain("BADGES"); // badge titles from the engine's map
    expect(player).toContain("StreakFlame");
    expect(player).toContain("streak.current");
    expect(player).toContain("newBadges");
    expect(player).toContain("firstTryAccuracy"); // drives the بی‌نقص callout
    expect(player).toContain("xpAwarded");
    expect(player).toContain("coinsAwarded");
  });

  test("exit (×) discards progress through onDone — no confirmation flow", () => {
    expect(player).toContain("onDone");
  });

  test("a failed POST keeps the player mounted with EmptyState + retry", () => {
    expect(player).toContain("EmptyState");
    expect(player).toContain("retryBtn");
  });
});

describe("lessonPlayer copy", () => {
  test("carries the interaction strings: تأیید، شروع، ادامه، درست/نادرست", () => {
    const c = copy.lessonPlayer;
    expect(c.confirmBtn).toBe("تأیید");
    expect(c.startBtn).toBe("شروع");
    expect(c.continueBtn).toBe("ادامه");
    expect(c.trueBtn).toBe("درست");
    expect(c.falseBtn).toBe("نادرست");
  });

  test("numbers the exercise stream and the accuracy line in Persian digits", () => {
    const c = copy.lessonPlayer;
    expect(c.exerciseOf(2, 6)).toBe("سؤال ۲ از ۶");
    expect(c.accuracyOf(100)).toBe("دقت: ۱۰۰٪");
  });

  test("carries intro framing, audio, exit and summary strings", () => {
    const c = copy.lessonPlayer;
    expect(c.introLabel).toBeTruthy();
    expect(c.listenBtn).toBeTruthy();
    expect(c.exitAria).toBeTruthy();
    expect(c.summaryTitle).toBeTruthy();
    expect(c.perfectCallout).toBeTruthy();
    expect(c.backBtn).toBe("بازگشت به مسیر");
  });

  test("carries loading/error/retry copy for both fetch and submit failures", () => {
    const c = copy.lessonPlayer;
    expect(c.loading).toBeTruthy();
    expect(c.submitting).toBeTruthy();
    expect(c.errorTitle).toBeTruthy();
    expect(c.errorDesc).toBeTruthy();
    expect(c.retryBtn).toBeTruthy();
  });

  test("reveals the correct answer after a miss", () => {
    const c = copy.lessonPlayer;
    expect(c.correctWas("۳۰")).toContain("پاسخ درست");
  });
});

describe("courses screen mounts the player", () => {
  test("LessonPlayer renders over the screen when a lesson opens; done refreshes the catalog", () => {
    expect(screen).toContain("LessonPlayer");
    expect(screen).toMatch(/onDone=\{/);
  });
});
