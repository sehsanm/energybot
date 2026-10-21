// Course registry: re-exports every <course-slug>/course.ts so the catalog has
// one static import. Empty until the pilot course (bill-literacy) is authored —
// the content task replaces this file's contents, not its shape.

import type { Course } from "@/lib/courses/schema";

export const courses = [] as Course[];
