// Pure logic for the design kit — unit-tested directly (repo has no DOM test
// env by design; components stay thin presentation over these functions).

export const CONFETTI_COLORS = [
  "var(--primary)",
  "var(--streak)",
  "var(--chart-2)",
  "var(--secondary)",
  "var(--accent)",
] as const;

export function toFaDigits(n: number): string {
  return n.toLocaleString("fa-IR");
}

/** Streak label in Persian digits; null hides the flame for fresh accounts. */
export function streakLabel(days: number): string | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  return `روز ${toFaDigits(days)}`;
}

export type FlameIntensity = "none" | "warm" | "hot" | "blazing";

/** Tier drives the flame's visual heat (color strength + motion). */
export function flameIntensity(days: number): FlameIntensity {
  if (days >= 30) return "blazing";
  if (days >= 7) return "hot";
  if (days >= 1) return "warm";
  return "none";
}

/** Only 'user' is the user side; every other role renders as the assistant. */
export function bubbleSide(role: string): "user" | "assistant" {
  return role === "user" ? "user" : "assistant";
}

export type CelebrateEvent =
  | "lesson_completed"
  | "bill_insights_ready"
  | "chat_message"
  | "profile_saved";

/** Completions celebrate; ordinary traffic never does. */
export function shouldCelebrate(event: CelebrateEvent): boolean {
  return event === "lesson_completed" || event === "bill_insights_ready";
}

export interface ConfettiPiece {
  leftPct: number;
  delayMs: number;
  durationMs: number;
  color: string;
  sizePx: number;
}

// mulberry32 — tiny deterministic PRNG so a seed yields stable pieces.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic confetti specs: same seed → identical burst, every time. */
export function confettiPieces(seed: number, count = 24): ConfettiPiece[] {
  const rnd = mulberry32(seed);
  const pieces: ConfettiPiece[] = [];
  for (let i = 0; i < count; i++) {
    pieces.push({
      leftPct: Math.floor(rnd() * 100),
      delayMs: Math.floor(rnd() * 350),
      durationMs: 900 + Math.floor(rnd() * 700),
      color: CONFETTI_COLORS[Math.floor(rnd() * CONFETTI_COLORS.length)],
      sizePx: 6 + Math.floor(rnd() * 6),
    });
  }
  return pieces;
}
