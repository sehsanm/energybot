// Response shaping for the courses/me API — pure (db, userId) functions so the
// route handlers stay thin wrappers (currentUser() reads next/headers cookies)
// and the views are testable against a plain test db, like applyProfileUpdate.

import { eq, max } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import { gamificationSummary, type GamificationSummary } from "@/lib/gamification/awards";
import type { Course, Lesson } from "./schema";
import { getCourses, getCourse, hasAudio } from "./catalog";

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

/** ONE completions query: best accuracy per (course, lesson) the user did. */
function completionsByLesson(db: DB, userId: string): Map<string, number> {
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
  return new Map(rows.map((r) => [`${r.courseSlug}/${r.lessonSlug}`, r.best ?? 0]));
}

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

  const done = completionsByLesson(db, userId);

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

// --- course detail (the lesson player's pre-flight payload) -----------------

/** A full lesson definition plus the fields the player layers on top. */
export interface DetailLessonView extends Lesson {
  /** only present for authed callers */
  state?: LessonState;
  /** MAX accuracy over the user's completions, 3dp — only when completed */
  bestAccuracy?: number;
  hasIntroAudio: boolean;
  /** per exercise id — task 12's TTS tree, false until the mp3s land */
  hasExerciseAudio: Record<string, boolean>;
}

export interface CourseDetailView extends Omit<Course, "lessons"> {
  lessons: DetailLessonView[];
}

/**
 * The GET /api/courses/:courseSlug payload: the ENTIRE course definition with
 * per-lesson state and per-item audio flags, so the player can boot from one
 * request. Unknown slug → null (the route's 404). Anonymous callers get the
 * definitions with no per-user fields — same rule as the catalog view.
 */
export function courseDetailView(
  db: DB,
  userId: string | null,
  courseSlug: string,
): { course: CourseDetailView } | null {
  const course = getCourse(courseSlug);
  if (!course) return null;

  const done = userId ? completionsByLesson(db, userId) : new Map<string, number>();

  const lessons: DetailLessonView[] = course.lessons.map((l, i) => {
    const base: DetailLessonView = {
      ...l,
      hasIntroAudio: hasAudio(course.slug, l.slug, "intro"),
      hasExerciseAudio: Object.fromEntries(
        l.exercises.map((e) => [e.id, hasAudio(course.slug, l.slug, e.id)]),
      ),
    };
    if (!userId) return base; // definitions only — no per-user fields
    const best = done.get(`${course.slug}/${l.slug}`);
    const completed = best !== undefined;
    const prevDone = i === 0 || done.has(`${course.slug}/${course.lessons[i - 1].slug}`);
    return completed
      ? { ...base, state: "completed" as const, bestAccuracy: round3(best) }
      : { ...base, state: prevDone ? ("available" as const) : ("locked" as const) };
  });

  return {
    course: {
      slug: course.slug,
      title: course.title,
      cluster: course.cluster,
      description: course.description,
      lessons,
    },
  };
}
