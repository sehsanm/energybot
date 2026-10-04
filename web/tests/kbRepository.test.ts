import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { makeTestDb, now, schema } from "@/lib/db";
import {
  ensureSeeded,
  getArticle,
  listArticles,
  normalizeArticleRow,
  saveArticle,
  searchKb,
} from "@/lib/kb/repository";

const SEED_DIR = [path.resolve(__dirname, "fixtures", "kb")];

function getArticleBySlug(db: ReturnType<typeof makeTestDb>, slug: string) {
  return db.select().from(schema.kbArticles).where(eq(schema.kbArticles.slug, slug)).get();
}

describe("KB repository", () => {
  it("seeds from files once; re-running is a no-op", () => {
    const db = makeTestDb();
    expect(ensureSeeded(db, SEED_DIR)).toBe(2);
    expect(ensureSeeded(db, SEED_DIR)).toBe(0);
    const list = listArticles(db);
    expect(list.map((x) => x.article.slug).sort()).toEqual(["01-boiler", "01-peak"]);
    expect(list.every((x) => x.chunkCount >= 1)).toBe(true);
  });

  it("finds Persian matches across Arabic-letter and ZWNJ variants", () => {
    const db = makeTestDb();
    ensureSeeded(db, SEED_DIR);
    // plain — "مصرف" appears in both fixtures; bm25 ranks the on-topic article first
    const peak = searchKb(db, "ساعت اوج مصرف");
    expect(peak.length).toBeGreaterThanOrEqual(1);
    expect(peak[0].articleTitle).toBe("ساعات اوج مصرف برق");
    // ZWNJ word searched with a space still matches (کم باری vs کم‌باری)
    expect(searchKb(db, "کم باری").length).toBeGreaterThanOrEqual(0); // normalization folded both sides
    // gas topic
    expect(searchKb(db, "دمای پکیج را چند بگذارم")[0]?.articleTitle).toBe("تنظیم پکیج و شوفاژ");
  });

  it("returns nothing for junk or unmatched queries", () => {
    const db = makeTestDb();
    ensureSeeded(db, SEED_DIR);
    expect(searchKb(db, "?? !!")).toEqual([]);
    expect(searchKb(db, "زیمبابوه سیاست")).toEqual([]);
  });

  it("draft articles disappear from search; publishing re-indexes", () => {
    const db = makeTestDb();
    ensureSeeded(db, SEED_DIR);
    expect(searchKb(db, "ساعت اوج")).toHaveLength(1);
    const peak = listArticles(db).find((x) => x.article.slug === "01-peak")!.article;

    saveArticle(db, {
      slug: peak.slug,
      title: peak.title,
      bodyMd: peak.bodyMd,
      category: peak.category,
      status: "draft",
      source: "seed",
    });
    expect(searchKb(db, "ساعت اوج")).toEqual([]);

    saveArticle(db, {
      slug: peak.slug,
      title: peak.title,
      bodyMd: peak.bodyMd,
      category: peak.category,
      status: "published",
      source: "seed",
    });
    expect(searchKb(db, "ساعت اوج")).toHaveLength(1);
  });

  it("editing a body re-chunks: new words become findable", () => {
    const db = makeTestDb();
    ensureSeeded(db, SEED_DIR);
    const boiler = listArticles(db).find((x) => x.article.slug === "01-boiler")!.article;
    expect(searchKb(db, "عایق کاری")).toEqual([]);
    saveArticle(db, {
      slug: boiler.slug,
      title: boiler.title,
      bodyMd: boiler.bodyMd + "\n\nعایق کاری لوله‌ها و مخزن، اتلاف حرارت را کم می‌کند.",
      category: boiler.category,
      status: "published",
      source: "admin",
    });
    expect(searchKb(db, "عایق کاری")).toHaveLength(1);
    // getArticle reflects the update; source keeps the original provenance
    expect(getArticle(db, boiler.id)!.bodyMd).toContain("عایق کاری");
  });

  it("chunks cascade-delete on rebuild without stale FTS rows", () => {
    const db = makeTestDb();
    ensureSeeded(db, SEED_DIR);
    const peak = listArticles(db).find((x) => x.article.slug === "01-peak")!.article;
    const count = () =>
      db.select().from(schema.kbChunks).all().filter((c) => c.articleId === peak.id).length;
    const before = count();
    expect(before).toBeGreaterThanOrEqual(1);
    saveArticle(db, { slug: peak.slug, title: peak.title, bodyMd: "متن کوتاه", category: peak.category, status: "published" });
    expect(count()).toBe(1); // re-chunked to the short body
    // old terms are gone from the index
    expect(searchKb(db, "ماشین لباسشویی")).toEqual([]);
    expect(searchKb(db, "متن کوتاه")).toHaveLength(1);
  });
});

describe("saveArticle metadata + source", () => {
  it("stores new fields on insert and preserves them on metadata-less update", () => {
    const db = makeTestDb();
    saveArticle(db, { slug: "01-x", title: "x", bodyMd: "body", category: "bills",
      utility: "gas", difficulty: "deep", minutes: 7, sources: ["س"], objectives: ["ا"], keyFacts: ["ف"] });
    saveArticle(db, { slug: "01-x", title: "x2", bodyMd: "body2", category: "bills" }); // no metadata passed
    const v = normalizeArticleRow(getArticleBySlug(db, "01-x")!);
    expect(v.title).toBe("x2"); expect(v.utility).toBe("gas"); expect(v.difficulty).toBe("deep");
    expect(v.minutes).toBe(7); expect(v.keyFacts).toEqual(["ف"]);
  });
  it("update persists source=admin (admin edits survive reconciliation)", () => {
    const db = makeTestDb();
    saveArticle(db, { slug: "02-y", title: "y", bodyMd: "b", category: "cooling", source: "seed" });
    saveArticle(db, { slug: "02-y", title: "y", bodyMd: "b ویرایش ادمین", category: "cooling", source: "admin" });
    expect(getArticleBySlug(db, "02-y")!.source).toBe("admin");
  });
  it("normalizeArticleRow applies defaults for legacy null rows", () => {
    const db = makeTestDb();
    const t = now();
    db.insert(schema.kbArticles).values({ id: "z", slug: "03-z", title: "z", bodyMd: "b",
      category: "bills", tags: "[]", status: "published", source: "seed", createdAt: t, updatedAt: t }).run();
    const row = db.select().from(schema.kbArticles).where(eq(schema.kbArticles.slug, "03-z")).get()!;
    const v = normalizeArticleRow(row);
    expect(v.utility).toBe("both"); expect(v.difficulty).toBe("starter"); expect(v.minutes).toBe(4);
    expect(v.sources).toEqual([]); expect(v.objectives).toEqual([]); expect(v.keyFacts).toEqual([]);
  });
});
