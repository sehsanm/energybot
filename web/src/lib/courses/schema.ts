// Course content model: the single source of the course/lesson/exercise shapes.
// Lesson definitions live in src/content/courses/<course-slug>/course.ts,
// authored and type-checked at dev time — no course DB tables, no seeding.

export interface Course {
  slug: string; // kebab, e.g. "bill-literacy"
  title: string; // Persian
  cluster: string; // KB cluster slug, e.g. "bills"
  description: string; // Persian, 1–2 sentences
  lessons: Lesson[]; // ordered
}

export interface Lesson {
  slug: string; // kebab within course, unique
  title: string; // Persian
  articleSlug: string; // source KB article slug (must exist in kb content)
  intro: { text: string; audioId?: string }; // audioId ↔ public/audio manifest
  exercises: Exercise[]; // 5–8
  xpBase: number; // 10 for the pilot
}

export type Exercise =
  | { kind: "mcq"; id: string; prompt: string; options: [string, string, string, string];
      correctIndex: 0 | 1 | 2 | 3; explanation: string }
  | { kind: "truefalse"; id: string; prompt: string; answer: boolean; explanation: string }
  | { kind: "numeric"; id: string; prompt: string; unit: string;
      answer: number; tolerance: number; explanation: string }
  | { kind: "scenario"; id: string; prompt: string; inputs: string;
      unit: string; answer: number; tolerance: number; explanation: string };
