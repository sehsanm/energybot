// Course catalog: registry loads (pilot authored in Task 3; the content lint
// in courseContent.test.ts carries the per-course assertions) and audio
// existence checks resolve against the pre-generated audio tree.

import { describe, expect, it } from "vitest";
import { getCourses, getCourse, hasAudio } from "@/lib/courses/catalog";

describe("course catalog", () => {
  it("loads the pilot course from the registry", () => {
    expect(getCourses().map((c) => c.slug)).toContain("bill-literacy");
    expect(getCourse("bill-literacy")?.lessons).toHaveLength(6);
  });
  it("hasAudio is false when no file exists", () => {
    expect(hasAudio("any-course", "any-lesson", "intro")).toBe(false);
  });
});
