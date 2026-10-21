// Course catalog: registry loads (empty until Task 3 authors the pilot) and
// audio existence checks resolve against the pre-generated audio tree.

import { describe, expect, it } from "vitest";
import { getCourses, getCourse, hasAudio } from "@/lib/courses/catalog";

describe("course catalog", () => {
  it("loads from the registry (empty until Task 3 authors the pilot)", () => {
    expect(getCourses()).toEqual([]); // registry placeholder exports []
    expect(getCourse("bill-literacy")).toBeUndefined();
  });
  it("hasAudio is false when no file exists", () => {
    expect(hasAudio("any-course", "any-lesson", "intro")).toBe(false);
  });
});
