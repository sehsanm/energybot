// Course content lint: the gate every course (v3.x) must pass before shipping.
// Structure rules come from the schema bounds; integration rules tie each
// lesson to its source KB article; style rules enforce Persian digits and
// keyFacts coverage. The pilot block pins the bill-literacy spec from the plan.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCourses } from "@/lib/courses/catalog";
import { parseFrontmatter } from "@/lib/kb/frontmatter";
import type { Exercise } from "@/lib/courses/schema";

const KB_ROOT = path.resolve(__dirname, "..", "src", "content", "kb");
const COURSES_ROOT = path.resolve(__dirname, "..", "src", "content", "courses");

// LIVE Persian-digit rule, identical to tests/kbContent.test.ts:57 — strip
// latin runs (kWh, m³, tavanir.org.ir, …) then no ASCII digit may remain.
const stripLatinRuns = (s: string) => s.replace(/[A-Za-z0-9+.\-/%°]*[A-Za-z][A-Za-z0-9+.\-/%°]*/g, "");
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const normalizeDigits = (s: string) => s.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Every user-facing string of an exercise (options only exist on mcq). */
function exerciseStrings(ex: Exercise): string[] {
  return ex.kind === "mcq" ? [ex.prompt, ...ex.options, ex.explanation] : [ex.prompt, ex.explanation];
}

describe("course content lint", () => {
  const courses = getCourses();

  it("registry is exactly the course dirs under src/content/courses", () => {
    const dirs = fs
      .readdirSync(COURSES_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(courses.map((c) => c.slug).sort()).toEqual(dirs);
  });

  it("structure: kebab slugs, unique lesson slugs/exercise ids, 5–8 exercises, valid options, tolerance > 0, xpBase 5–20", () => {
    const problems: string[] = [];
    for (const course of courses) {
      if (!KEBAB.test(course.slug)) problems.push(`course slug not kebab: ${course.slug}`);
      const lessonSlugs = course.lessons.map((l) => l.slug);
      if (new Set(lessonSlugs).size !== lessonSlugs.length) problems.push(`${course.slug}: duplicate lesson slugs`);
      for (const lesson of course.lessons) {
        const id = `${course.slug}/${lesson.slug}`;
        if (!KEBAB.test(lesson.slug)) problems.push(`${id}: lesson slug not kebab`);
        if (lesson.exercises.length < 5 || lesson.exercises.length > 8)
          problems.push(`${id}: ${lesson.exercises.length} exercises (need 5–8)`);
        if (lesson.xpBase < 5 || lesson.xpBase > 20) problems.push(`${id}: xpBase ${lesson.xpBase} (need 5–20)`);
        const exIds = lesson.exercises.map((e) => e.id);
        if (new Set(exIds).size !== exIds.length) problems.push(`${id}: duplicate exercise ids`);
        for (const ex of lesson.exercises) {
          const where = `${id}/${ex.id}`;
          if (!ex.prompt.trim()) problems.push(`${where}: empty prompt`);
          if (!ex.explanation.trim()) problems.push(`${where}: empty explanation`);
          if (ex.kind === "mcq") {
            if (ex.correctIndex < 0 || ex.correctIndex > 3) problems.push(`${where}: correctIndex ${ex.correctIndex}`);
            ex.options.forEach((o, i) => {
              if (!o.trim()) problems.push(`${where}: empty option ${i}`);
            });
            if (new Set(ex.options).size !== ex.options.length) problems.push(`${where}: duplicate options`);
          }
          if ((ex.kind === "numeric" || ex.kind === "scenario") && !(ex.tolerance > 0))
            problems.push(`${where}: tolerance must be > 0`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("integration: every articleSlug resolves to an existing KB article file", () => {
    const problems: string[] = [];
    for (const course of courses) {
      for (const lesson of course.lessons) {
        const id = `${course.slug}/${lesson.slug}`;
        if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(lesson.articleSlug)) {
          problems.push(`${id}: articleSlug "${lesson.articleSlug}" is not <cluster>/<file>`);
          continue;
        }
        if (!fs.existsSync(path.join(KB_ROOT, `${lesson.articleSlug}.md`)))
          problems.push(`${id}: no KB article at ${lesson.articleSlug}.md`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("style: Persian digits only in every prompt, option, explanation (and intro)", () => {
    const problems: string[] = [];
    for (const course of courses) {
      for (const lesson of course.lessons) {
        const strings: [string, string][] = [[`${course.slug}/${lesson.slug} intro`, lesson.intro.text]];
        for (const ex of lesson.exercises)
          for (const s of exerciseStrings(ex)) strings.push([`${course.slug}/${lesson.slug}/${ex.id}`, s]);
        for (const [where, s] of strings) if (/\d/.test(stripLatinRuns(s))) problems.push(`${where}: latin digit in "${s}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("style: ≥60% of each source article's keyFacts appear in exercise text (substring, digits normalized)", () => {
    const problems: string[] = [];
    for (const course of courses) {
      for (const lesson of course.lessons) {
        const fm = parseFrontmatter(fs.readFileSync(path.join(KB_ROOT, `${lesson.articleSlug}.md`), "utf-8"));
        if (fm.keyFacts.length === 0) continue;
        const blob = normalizeDigits(lesson.exercises.flatMap(exerciseStrings).join("\n"));
        const missing = fm.keyFacts.filter((f) => !blob.includes(normalizeDigits(f)));
        const coverage = 1 - missing.length / fm.keyFacts.length;
        if (coverage < 0.6)
          problems.push(
            `${course.slug}/${lesson.slug}: ${(coverage * 100).toFixed(0)}% keyFacts covered; missing: ${missing.join(" | ")}`,
          );
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("pilot course: سوادِ قبض (bill-literacy)", () => {
  it("is registered with the 6 plan lessons in order and the plan's exercise counts", () => {
    const course = getCourses().find((c) => c.slug === "bill-literacy");
    expect(course?.title).toBe("سوادِ قبض — از تعرفه تا کاهش مصرف");
    expect(course?.cluster).toBe("bills");
    expect(course?.lessons.map((l) => l.slug)).toEqual([
      "01-tariff-tiers",
      "02-peak-hours",
      "03-reading-your-bill",
      "04-gas-tariff",
      "05-smart-prepaid-meter",
      "06-bill-spike-troubleshooting",
    ]);
    expect(course?.lessons.map((l) => l.exercises.length)).toEqual([6, 5, 6, 7, 6, 8]);
    // lesson 06 carries the single scenario exercise of the whole course
    expect(course?.lessons[5].exercises.filter((e) => e.kind === "scenario")).toHaveLength(1);
  });
});
