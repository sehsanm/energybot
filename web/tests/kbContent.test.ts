// web/tests/kbContent.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "@/lib/kb/frontmatter";
import { ensureSeeded, listArticles } from "@/lib/kb/repository";
import { makeTestDb } from "@/lib/db";
import { EXPECTED_KB } from "./fixtures/kbExpected";

const ROOT = path.resolve(__dirname, "..", "src", "content", "kb");
const CLUSTERS = ["bills", "cooling", "heating", "hot-water", "kitchen", "appliances", "lighting", "envelope", "solar", "safety", "behavior"];

function walk(dir: string, acc: { cluster: string; file: string }[] = []): { cluster: string; file: string }[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(dir, e.name), acc);
    else if (e.name.endsWith(".md")) acc.push({ cluster: path.relative(ROOT, path.dirname(path.join(dir, e.name))), file: path.basename(e.name, ".md") });
  }
  return acc;
}

describe("KB content map", () => {
  it("uses only cluster directories", () => {
    const dirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    for (const d of dirs) expect(CLUSTERS).toContain(d);
  });
  it("matches EXPECTED_KB exactly (no missing, no extra)", () => {
    const files = walk(ROOT);
    const actual = files.map((f) => `${f.cluster}/${f.file}`).sort();
    const expected = Object.entries(EXPECTED_KB).flatMap(([c, slugs]) => slugs.map((s) => `${c}/${s}`)).sort();
    expect(actual).toEqual(expected);
  });
});

describe("KB article schema and style (every file)", () => {
  const files = walk(ROOT);
  it.each(files.map((f) => [`${f.cluster}/${f.file}`, f]))("%s conforms", (_label, f) => {
    const raw = fs.readFileSync(path.join(ROOT, f.cluster, `${f.file}.md`), "utf-8");
    const fm = parseFrontmatter(raw, f.file);
    expect(fm.title.length).toBeGreaterThan(3);
    expect(fm.category).toBe(f.cluster);
    expect(fm.tags.length).toBeGreaterThanOrEqual(2);
    expect(["electricity", "gas", "both"]).toContain(fm.utility);
    expect(["starter", "medium", "deep"]).toContain(fm.difficulty);
    expect(fm.minutes).toBeGreaterThanOrEqual(2);
    expect(fm.minutes).toBeLessThanOrEqual(15);
    expect(fm.sources.length).toBeGreaterThanOrEqual(2);
    expect(fm.sources.length).toBeLessThanOrEqual(6);
    expect(fm.sources.every((s) => s.trim().length > 3)).toBe(true);
    expect(fm.objectives.length).toBeGreaterThanOrEqual(2);
    expect(fm.objectives.length).toBeLessThanOrEqual(4);
    expect(fm.keyFacts.length).toBeGreaterThanOrEqual(4);
    expect(fm.keyFacts.length).toBeLessThanOrEqual(8);
    expect(fm.body).toContain("یک قدم اول");
    const words = fm.body.split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(300);
    expect(words).toBeLessThanOrEqual(1150);
    expect(fm.body.replace(/[A-Za-z0-9+.\-/%°]+/g, "")).not.toMatch(/\d/); // Persian digits only, latin runs exempt
  });
});

describe("KB reconciliation smoke (real content dir)", () => {
  it("seeds exactly the expected slugs; re-run inserts nothing", () => {
    const db = makeTestDb();
    expect(ensureSeeded(db, [ROOT])).toBe(Object.values(EXPECTED_KB).flat().length);
    expect(ensureSeeded(db, [ROOT])).toBe(0);
    expect(listArticles(db)).toHaveLength(Object.values(EXPECTED_KB).flat().length);
  });
});
