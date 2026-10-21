// Response shaping for the courses/me API — pure (db, userId) functions so the
// route handlers stay thin wrappers (currentUser() reads next/headers cookies)
// and the views are testable against a plain test db, like applyProfileUpdate.

import { eq, max } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { gamificationSummary, type GamificationSummary } from "@/lib/gamification/awards";
import { getCourses, hasAudio } from "./catalog";

export type LessonState = "locked" | "available" | "completed";

export interface CatalogLessonView {
  slug: string;
  title: string;
  /** only present for authed callers */
  state?: LessonState;
  /** MAX accuracy over the user's completions, 3dp — only when completed */
  bestAccuracy?: number;
  hasAudio: boolean;
}

export interface CatalogCourseView {
  slug: string;
  title: string;
  description: string;
  lessons: CatalogLessonView[];
}

export interface CatalogMeView {
  xp: number;
  coins: number;
  streak: { current: number; best: number; freezes: number };
  badges: string[];
}

export interface CoursesCatalogView {
  courses: CatalogCourseView[];
  /** only present for authed callers */
  me?: CatalogMeView;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * The GET /api/courses payload. Authed: lesson 0 (and any lesson whose
 * predecessor has ≥1 completion) is available, a lesson with ≥1 completion is
 * completed (taking precedence), and `me` carries the gamification header
 * stats. Anonymous: the same catalog with no per-user fields at all.
 */
export function coursesCatalogView(db: DB, userId: string | null): CoursesCatalogView {
  if (!userId) {
    return {
      courses: getCourses().map((c) => ({
        slug: c.slug,
        title: c.title,
        description: c.description,
        lessons: c.lessons.map((l) => ({
          slug: l.slug,
          title: l.title,
          hasAudio: hasAudio(c.slug, l.slug, "intro"),
        })),
      })),
    };
  }

  // ONE completions query: best accuracy per (course, lesson) the user did.
  const rows = db
    .select({
      courseSlug: schema.lessonCompletions.courseSlug,
      lessonSlug: schema.lessonCompletions.lessonSlug,
      best: max(schema.lessonCompletions.accuracy),
    })
    .from(schema.lessonCompletions)
    .where(eq(schema.lessonCompletions.userId, userId))
    .groupBy(schema.lessonCompletions.courseSlug, schema.lessonCompletions.lessonSlug)
    .all();
  const done = new Map(rows.map((r) => [`${r.courseSlug}/${r.lessonSlug}`, r.best ?? 0]));

  const courses = getCourses().map((c) => ({
    slug: c.slug,
    title: c.title,
    description: c.description,
    lessons: c.lessons.map((l, i): CatalogLessonView => {
      const best = done.get(`${c.slug}/${l.slug}`);
      const completed = best !== undefined;
      const prevDone = i === 0 || done.has(`${c.slug}/${c.lessons[i - 1].slug}`);
      return {
        slug: l.slug,
        title: l.title,
        ...(completed
          ? { state: "completed" as const, bestAccuracy: round3(best) }
          : { state: prevDone ? ("available" as const) : ("locked" as const) }),
        hasAudio: hasAudio(c.slug, l.slug, "intro"),
      };
    }),
  }));

  const s = gamificationSummary(db, userId);
  return { courses, me: { xp: s.xp, coins: s.coins, streak: s.streak, badges: s.badges } };
}

/** The `gamification` block of GET /api/me. */
export function meGamificationView(db: DB, userId: string): GamificationSummary {
  return gamificationSummary(db, userId);
}
