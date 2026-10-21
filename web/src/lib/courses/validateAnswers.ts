// Payload validation for POST …/complete. This gate is LOAD-BEARING: the
// scoring engine coerces with Number(v) (mcq) and would silently treat null,
// "" or an absent-ish value as index 0, so by the time answers reach
// awardLessonCompletion every key must be a known exercise id and every value
// must already be the right primitive for its exercise kind. Client-sent
// claims (xp, accuracy, …) never enter: only body.answers is read, and only
// its validated entries are returned.

import type { Exercise, Lesson } from "./schema";

export type ValidatedAnswers = Record<string, number | boolean>;

export type AnswersValidation = { ok: true; answers: ValidatedAnswers } | { ok: false };

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
 * with no entry score as incorrect downstream. Returns the sanitized answers
 * on success; anything else (including a missing/non-object body or answers)
 * is `{ ok: false }` → the route answers 400 before touching the engine.
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
  return { ok: true, answers };
}
