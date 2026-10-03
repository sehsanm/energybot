import { describe, expect, it } from "vitest";
import { normalizeFa, toFtsQuery, ZWNJ } from "@/lib/kb/normalize";
import { chunkText } from "@/lib/kb/chunk";
import { parseFrontmatter } from "@/lib/kb/frontmatter";

describe("normalizeFa (legacy normalize_fa parity)", () => {
  it("maps Arabic letters/digits to Persian", () => {
    expect(normalizeFa("كتاب ي")).toBe("کتاب ی");
    expect(normalizeFa("١٢٣")).toBe("۱۲۳");
  });
  it("collapses ZWNJ runs and space/ZWNJ boundaries", () => {
    expect(normalizeFa(`می${ZWNJ}${ZWNJ}رود`)).toBe(`می${ZWNJ}رود`);
    expect(normalizeFa(`می ${ZWNJ} رود`)).toBe(`می${ZWNJ}رود`);
  });
  it("collapses whitespace and lowercases Latin", () => {
    expect(normalizeFa("  چند   فاصله  ")).toBe("چند فاصله");
    expect(normalizeFa("AC Unit")).toBe("ac unit");
  });
  it("leaves already-normalized Persian untouched", () => {
    expect(normalizeFa("ساعت اوج مصرف")).toBe("ساعت اوج مصرف");
  });
});

describe("toFtsQuery", () => {
  it("builds quoted prefix terms joined with OR", () => {
    expect(toFtsQuery("ساعت اوج مصرف")).toBe(`"ساعت"* OR "اوج"* OR "مصرف"*`);
  });
  it("drops junk: short tokens, quotes, operators", () => {
    expect(toFtsQuery('a "x" (y) بین')).toBe(`"بین"*`);
    expect(toFtsQuery("")).toBe("");
    expect(toFtsQuery("!! ؟")).toBe("");
  });
  it("caps the term count", () => {
    const q = toFtsQuery("یک دو سه چهار پنج شش هفت هشت نه ده");
    expect(q.split(" OR ")).toHaveLength(8);
  });
});

describe("chunkText (legacy structure, char-based)", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkText("متن کوتاه")).toEqual(["متن کوتاه"]);
    expect(chunkText("   ")).toEqual([]);
  });
  it("splits on paragraphs, then sentences, with overlap", () => {
    const para = Array.from({ length: 30 }, (_, i) => `جملهٔ شماره ${i} دربارهٔ مصرف برق است.`).join(" ");
    const text = `${para}\n\n${para}`;
    const chunks = chunkText(text, { targetChars: 400, overlapChars: 80 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(400 + 200); // target + one long unit tolerance
    }
    // overlap: the first words of chunk n+1 appear near the end of chunk n
    const tail = chunks[0].slice(-200);
    expect(chunks[1].split(" ").some((w) => w.length > 3 && tail.includes(w))).toBe(true);
  });
});

describe("parseFrontmatter", () => {
  it("parses title/category/tags", () => {
    const fm = parseFrontmatter(
      `---\ntitle: ساعات اوج\ncategory: Electricity\ntags: ["اوج", "پیک"]\n---\n\n# ساعات اوج\n\nمتن بدنه.`,
    );
    expect(fm.title).toBe("ساعات اوج");
    expect(fm.category).toBe("electricity");
    expect(fm.tags).toEqual(["اوج", "پیک"]);
    expect(fm.body).toContain("متن بدنه.");
  });
  it("falls back to the first heading when no frontmatter exists", () => {
    const fm = parseFrontmatter("# تیتر بدون فرامت\n\nبدنه");
    expect(fm.title).toBe("تیتر بدون فرامت");
    expect(fm.category).toBe("general");
    expect(fm.body).toBe("بدنه");
  });
  it("parses unquoted tag lists", () => {
    const fm = parseFrontmatter(`---\ntitle: x\ntags: الف, ب, ج\n---\nبدنه`);
    expect(fm.tags).toEqual(["الف", "ب", "ج"]);
  });
});
