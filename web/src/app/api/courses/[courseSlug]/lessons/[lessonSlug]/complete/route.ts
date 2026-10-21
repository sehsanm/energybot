// POST /api/courses/:courseSlug/lessons/:lessonSlug/complete — score a lesson
// attempt server-side and award everything it earns. The client sends raw
// answers ONLY: every accuracy/xp/coin/badge/streak number in the response is
// computed here from the lesson definition; claim fields in the body (xp,
// accuracy, …) are never read. Lesson sequence is deliberately NOT enforced
// (forgiving philosophy — Task 7 ruling).

import { getDb } from "@/lib/db";
import { badCsrf, csrfGuard, currentUser, unauth } from "@/lib/auth/api";
import { getCourse, getLesson } from "@/lib/courses/catalog";
import { validateAnswers } from "@/lib/courses/validateAnswers";
import { awardLessonCompletion } from "@/lib/gamification/awards";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ courseSlug: string; lessonSlug: string }> },
): Promise<Response> {
  const user = await currentUser();
  if (!user) return unauth();
  if (!csrfGuard(req, user.sessionId)) return badCsrf();
  const { courseSlug, lessonSlug } = await ctx.params;

  const course = getCourse(courseSlug);
  const lesson = course ? getLesson(course, lessonSlug) : undefined;
  if (!course || !lesson) return Response.json({ error: "not_found" }, { status: 404 });

  // Validate BEFORE the engine: null/"" would coerce to mcq index 0 inside it.
  const body = await req.json().catch(() => null);
  const v = validateAnswers(lesson, body);
  if (!v.ok) return Response.json({ error: "bad request" }, { status: 400 });

  const outcome = awardLessonCompletion(getDb(), user.id, courseSlug, lessonSlug, v.answers, Date.now(), v.firstTry);
  if (!outcome.ok) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(outcome.result);
}
