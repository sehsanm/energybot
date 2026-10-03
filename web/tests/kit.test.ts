import { describe, test, expect } from "vitest";
import {
  streakLabel,
  flameIntensity,
  bubbleSide,
  confettiPieces,
  CONFETTI_COLORS,
  shouldCelebrate,
  nextBurst,
} from "../src/components/kit/logic";

describe("StreakFlame logic", () => {
  test("zero streak hides (no demotivating 0 on a new account)", () => {
    expect(streakLabel(0)).toBeNull();
  });

  test("labels render Persian digits", () => {
    expect(streakLabel(1)).toBe("روز ۱");
    expect(streakLabel(5)).toBe("روز ۵");
    expect(streakLabel(12)).toBe("روز ۱۲");
    expect(streakLabel(365)).toBe("روز ۳۶۵");
  });

  test("flame intensity tiers", () => {
    expect(flameIntensity(0)).toBe("none");
    expect(flameIntensity(1)).toBe("warm");
    expect(flameIntensity(6)).toBe("warm");
    expect(flameIntensity(7)).toBe("hot");
    expect(flameIntensity(29)).toBe("hot");
    expect(flameIntensity(30)).toBe("blazing");
  });
});

describe("MessageBubble logic", () => {
  test("only 'user' maps to the user side; everything else is the assistant", () => {
    expect(bubbleSide("user")).toBe("user");
    expect(bubbleSide("assistant")).toBe("assistant");
    expect(bubbleSide("system")).toBe("assistant");
  });
});

describe("Confetti logic (hand-rolled, no dependency)", () => {
  test("deterministic from a seed: same seed → same pieces", () => {
    const a = confettiPieces(42, 24);
    const b = confettiPieces(42, 24);
    expect(a).toEqual(b);
  });

  test("every piece is fully specified and on-brand", () => {
    const pieces = confettiPieces(7, 24);
    expect(pieces).toHaveLength(24);
    for (const p of pieces) {
      expect(p.leftPct).toBeGreaterThanOrEqual(0);
      expect(p.leftPct).toBeLessThan(100);
      expect(p.delayMs).toBeGreaterThanOrEqual(0);
      expect(p.durationMs).toBeGreaterThan(0);
      expect(CONFETTI_COLORS).toContain(p.color);
    }
  });

  test("celebration gates: completions celebrate, ordinary traffic does not", () => {
    expect(shouldCelebrate("lesson_completed")).toBe(true);
    expect(shouldCelebrate("bill_insights_ready")).toBe(true);
    expect(shouldCelebrate("chat_message")).toBe(false);
  });

  test("burst counter advances on every celebrated event (repeatable confetti)", () => {
    let b = nextBurst(0, "bill_insights_ready");
    expect(b).toBe(1);
    b = nextBurst(b, "chat_message"); // ordinary traffic never bursts
    expect(b).toBe(1);
    b = nextBurst(b, "bill_insights_ready"); // regenerate celebrates again
    expect(b).toBe(2);
    b = nextBurst(b, "lesson_completed");
    expect(b).toBe(3);
  });
});
