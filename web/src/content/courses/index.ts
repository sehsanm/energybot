// Course registry: re-exports every <course-slug>/course.ts so the catalog has
// one static import. tests/courseContent.test.ts fails if a course dir under
// src/content/courses is missing from this list (or vice versa).

import type { Course } from "@/lib/courses/schema";
import { billLiteracy } from "./bill-literacy/course";

export const courses: Course[] = [billLiteracy];
