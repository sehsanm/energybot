// Course catalog: static lookups over the content registry plus existence
// checks against the pre-generated TTS audio tree (no DB, no seeding).

import fs from "node:fs";
import path from "node:path";
import { courses } from "@/content/courses";
import type { Course, Lesson } from "./schema";

export const AUDIO_DIR = path.join(process.cwd(), "public", "audio", "courses");

/** All registered courses, in registry order. */
export function getCourses(): Course[] {
  return courses;
}

export function getCourse(slug: string): Course | undefined {
  return courses.find((c) => c.slug === slug);
}

export function getLesson(course: Course, slug: string): Lesson | undefined {
  return course.lessons.find((l) => l.slug === slug);
}

/** Whether the pre-generated mp3 exists; id is "intro" or an exercise id. */
export function hasAudio(course: string, lesson: string, id: string): boolean {
  return fs.existsSync(path.join(AUDIO_DIR, course, lesson, `${id}.mp3`));
}
