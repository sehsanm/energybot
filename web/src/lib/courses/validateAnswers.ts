// Payload validation for POST …/complete. This gate is LOAD-BEARING: the
// scoring engine coerces with Number(v) (mcq) and would silently treat null,
// "" or an absent-ish value as index 0, so by the time answers reach
// awardLessonCompletion every key must be a known exercise id and every value
// must already be the right primitive for its exercise kind. Client-sent
// claims (xp, accuracy, …) never enter: only body.answers (and the optional,
// strictly-true body.firstTry map) is read, and only the validated entries
// are returned.

import type { Exercise, Lesson } from "./schema";

export type ValidatedAnswers = Record<string, number | boolean>;

/** ids answered correctly on their FIRST presentation (the player's report). */
export type FirstTryMap = Record<string, true>;

export type AnswersValidation =
  | { ok: true; answers: ValidatedAnswers; firstTry?: FirstTryMap }
  | { ok: false };

function valueOk(ex: Exercise, v: unknown): boolean {
  switch (ex.kind) {
    case "mcq":
      return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 3;
    case "truefalse":
      return typeof v === "boolean";
    case "numeric":
    case "scenario":
      return typeof v === "number" && Number.isFinite(v);
  }
}

/**
 * Validate a completion request body (parsed JSON, `unknown` on purpose)
 * against a lesson. Every key of `answers` must be an exercise id of that
 * lesson; values must match their exercise kind (mcq: integer 0–3; truefalse:
 * boolean; numeric/scenario: finite number). Entries may be partial — ids
 * with no entry score as incorrect downstream.
 *
 * The OPTIONAL `firstTry` map (task 11 fix) reports ids answered correctly on
 * their first presentation. Its stakes are bounded: keys that aren't exercise
 * ids of the lesson are STRIPPED (client-side bookkeeping may drift), and
 * every value must be strictly `true` — anything else rejects the payload, so
 * the map can never smuggle data. An absent map passes through as undefined
 * (legacy single-attempt semantics for direct API callers).
 *
 * Returns the sanitized answers (+ map) on success; anything else (including
 * a missing/non-object body or answers) is `{ ok: false }` → the route answers
 * 400 before touching the engine.
 */
export function validateAnswers(lesson: Lesson, body: unknown): AnswersValidation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false };
  const raw = (body as { answers?: unknown }).answers;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false };

  const byId = new Map(lesson.exercises.map((ex) => [ex.id, ex]));
  const answers: ValidatedAnswers = {};
  for (const [id, value] of Object.entries(raw)) {
    const ex = byId.get(id);
    if (!ex || !valueOk(ex, value)) return { ok: false };
    answers[id] = value;
  }

  const rawFirstTry = (body as { firstTry?: unknown }).firstTry;
  if (rawFirstTry === undefined) return { ok: true, answers };
  if (typeof rawFirstTry !== "object" || rawFirstTry === null || Array.isArray(rawFirstTry)) {
    return { ok: false };
  }
  const firstTry: FirstTryMap = {};
  for (const [id, value] of Object.entries(rawFirstTry)) {
    if (!byId.has(id)) continue; // unknown key — strip, don't reject
    if (value !== true) return { ok: false }; // strictly true or the payload dies
    firstTry[id] = true;
  }
  return { ok: true, answers, firstTry };
}
