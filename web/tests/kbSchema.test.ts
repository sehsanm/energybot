import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, now, schema } from "@/lib/db";

const BASE = { slug: "01-x", title: "x", bodyMd: "body", category: "bills", createdAt: now(), updatedAt: now() };

describe("kb_articles course-metadata columns", () => {
  it("stores and returns all six new fields", () => {
    const db = makeTestDb();
    db.insert(schema.kbArticles).values({ ...BASE, id: "t1", utility: "gas", difficulty: "medium", minutes: 5,
      sources: '["ساتبا"]', objectives: "[]", keyFacts: "[]" }).run();
    const row = db.select().from(schema.kbArticles).where(eq(schema.kbArticles.slug, "01-x")).get()!;
    expect(row.utility).toBe("gas");
    expect(row.difficulty).toBe("medium");
    expect(row.minutes).toBe(5);
    expect(row.sources).toBe('["ساتبا"]');
  });

  it("accepts inserts without the new fields (legacy rows stay legal)", () => {
    const db = makeTestDb();
    db.insert(schema.kbArticles).values({ ...BASE, id: "t2", slug: "02-y" }).run();
    const row = db.select().from(schema.kbArticles).where(eq(schema.kbArticles.slug, "02-y")).get()!;
    expect(row.utility).toBeNull();
    expect(row.keyFacts).toBeNull();
  });
});
