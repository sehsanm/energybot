// KB repository: seeding from src/content/kb, FTS5 index management, bm25 search.
// The FTS5 virtual table lives outside drizzle's schema — created lazily here.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { getDb, now, schema, type DB } from "@/lib/db";
import { chunkText } from "./chunk";
import { normalizeFa, toFtsQuery } from "./normalize";
import { parseFrontmatter } from "./frontmatter";

export interface KbHit {
  articleTitle: string;
  articleSlug: string;
  chunkText: string;
}

function seedDirs(): string[] {
  return [
    path.join(process.cwd(), "src", "content", "kb"),
    path.join(process.cwd(), "content", "kb"),
  ];
}

export function ensureFts(db: DB): void {
  db.run(sql`CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(chunk_id UNINDEXED, text_normalized)`);
}

/** Drop an article's FTS rows BEFORE its chunks go away (they're keyed by chunk id). */
function dropIndex(db: DB, articleId: string): void {
  db.run(
    sql`DELETE FROM kb_fts WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE article_id = ${articleId})`,
  );
}

function indexArticle(db: DB, articleId: string, bodyMd: string): void {
  const chunks = chunkText(bodyMd);
  chunks.forEach((text, i) => {
    const res = db
      .insert(schema.kbChunks)
      .values({ articleId, chunkIndex: i, text, textNormalized: normalizeFa(text) })
      .run();
    const chunkId = Number(res.lastInsertRowid);
    db.run(sql`INSERT INTO kb_fts (chunk_id, text_normalized) VALUES (${chunkId}, ${normalizeFa(text)})`);
  });
}

export interface SaveArticleInput {
  slug: string;
  title: string;
  bodyMd: string;
  category: string;
  tags?: string[];
  status?: "draft" | "published";
  source?: "seed" | "admin";
  utility?: "electricity" | "gas" | "both";
  difficulty?: "starter" | "medium" | "deep";
  minutes?: number;
  sources?: string[];
  objectives?: string[];
  keyFacts?: string[];
}

/** A stored row with course metadata made non-null: legacy nulls get defaults, JSON arrays parsed. */
export type KbArticleView = Omit<
  typeof schema.kbArticles.$inferSelect,
  "utility" | "difficulty" | "minutes" | "sources" | "objectives" | "keyFacts"
> & {
  utility: "electricity" | "gas" | "both";
  difficulty: "starter" | "medium" | "deep";
  minutes: number;
  sources: string[];
  objectives: string[];
  keyFacts: string[];
};

function parseJsonArray(column: string | null): string[] {
  try {
    const parsed = JSON.parse(column ?? "[]");
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Read defaults: legacy rows (pre-metadata columns are null) read as usable course articles. */
export function normalizeArticleRow(row: typeof schema.kbArticles.$inferSelect): KbArticleView {
  return {
    ...row,
    utility: (row.utility as KbArticleView["utility"]) ?? "both",
    difficulty: (row.difficulty as KbArticleView["difficulty"]) ?? "starter",
    minutes: row.minutes ?? 4,
    sources: parseJsonArray(row.sources),
    objectives: parseJsonArray(row.objectives),
    keyFacts: parseJsonArray(row.keyFacts),
  };
}

/** Upsert by slug; re-chunks and re-indexes. Drafts are indexed with no rows. */
export function saveArticle(db: DB, input: SaveArticleInput): typeof schema.kbArticles.$inferSelect {
  ensureFts(db); // saveArticle writes to kb_fts — must exist even on a fresh database
  const t = now();
  const existing = db.select().from(schema.kbArticles).where(eq(schema.kbArticles.slug, input.slug)).get();
  let id: string;
  if (existing) {
    id = existing.id;
    dropIndex(db, id);
    db.delete(schema.kbChunks).where(eq(schema.kbChunks.articleId, id)).run();
    db.update(schema.kbArticles)
      .set({
        title: input.title,
        bodyMd: input.bodyMd,
        category: input.category,
        tags: JSON.stringify(input.tags ?? []),
        status: input.status ?? existing.status,
        source: input.source ?? existing.source,
        utility: input.utility ?? existing.utility,
        difficulty: input.difficulty ?? existing.difficulty,
        minutes: input.minutes ?? existing.minutes,
        sources: input.sources !== undefined ? JSON.stringify(input.sources) : existing.sources,
        objectives: input.objectives !== undefined ? JSON.stringify(input.objectives) : existing.objectives,
        keyFacts: input.keyFacts !== undefined ? JSON.stringify(input.keyFacts) : existing.keyFacts,
        updatedAt: t,
      })
      .where(eq(schema.kbArticles.id, id))
      .run();
  } else {
    id = randomUUID();
    db.insert(schema.kbArticles)
      .values({
        id,
        slug: input.slug,
        title: input.title,
        bodyMd: input.bodyMd,
        category: input.category,
        tags: JSON.stringify(input.tags ?? []),
        status: input.status ?? "published",
        source: input.source ?? "admin",
        utility: input.utility ?? null,
        difficulty: input.difficulty ?? null,
        minutes: input.minutes ?? null,
        sources: input.sources !== undefined ? JSON.stringify(input.sources) : null,
        objectives: input.objectives !== undefined ? JSON.stringify(input.objectives) : null,
        keyFacts: input.keyFacts !== undefined ? JSON.stringify(input.keyFacts) : null,
        createdAt: t,
        updatedAt: t,
      })
      .run();
  }
  if ((input.status ?? "published") === "published") {
    indexArticle(db, id, input.bodyMd);
  }
  return db.select().from(schema.kbArticles).where(eq(schema.kbArticles.id, id)).get()!;
}

/** Seed from the content dir when the KB is empty. Idempotent by design. */
export function ensureSeeded(db: DB = getDb(), dirs: string[] = seedDirs()): number {
  ensureFts(db);
  const any = db.select({ id: schema.kbArticles.id }).from(schema.kbArticles).limit(1).get();
  if (any) return 0;
  const dir = dirs.find((d) => fs.existsSync(d));
  if (!dir) {
    console.warn("[kb] no seed directory found; KB starts empty");
    return 0;
  }
  let count = 0;
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (e.name.endsWith(".md")) files.push(path.join(d, e.name));
    }
  };
  walk(dir);
  files.sort();
  for (const f of files) {
    const fm = parseFrontmatter(fs.readFileSync(f, "utf-8"), path.basename(f, ".md"));
    if (!fm.body.trim()) continue;
    saveArticle(db, {
      slug: path.basename(f, ".md"),
      title: fm.title || path.basename(f, ".md"),
      bodyMd: fm.body,
      category: fm.category,
      tags: fm.tags,
      status: "published",
      source: "seed",
    });
    count++;
  }
  console.info(`[kb] seeded ${count} articles from ${dir}`);
  return count;
}

/** bm25 search over published chunks. Returns [] on no usable terms. */
export function searchKb(db: DB, query: string, k = 4): KbHit[] {
  ensureFts(db);
  const q = toFtsQuery(normalizeFa(query));
  if (!q) return [];
  const rows = db
    .all<{ chunkId: number }>(
      sql`SELECT kb_fts.chunk_id AS chunkId FROM kb_fts WHERE kb_fts MATCH ${q} ORDER BY bm25(kb_fts) LIMIT ${k}`,
    )
    .filter((r) => Number.isFinite(Number(r.chunkId)));
  const hits: KbHit[] = [];
  for (const r of rows) {
    const chunk = db.select().from(schema.kbChunks).where(eq(schema.kbChunks.id, Number(r.chunkId))).get();
    if (!chunk) continue; // stale fts row — index rebuilt on next save
    const article = db.select().from(schema.kbArticles).where(eq(schema.kbArticles.id, chunk.articleId)).get();
    if (!article || article.status !== "published") continue;
    hits.push({ articleTitle: article.title, articleSlug: article.slug, chunkText: chunk.text });
  }
  return hits;
}

export function listArticles(db: DB): { article: typeof schema.kbArticles.$inferSelect; chunkCount: number }[] {
  ensureFts(db);
  return db
    .select()
    .from(schema.kbArticles)
    .orderBy(asc(schema.kbArticles.category), asc(schema.kbArticles.slug))
    .all()
    .map((article) => ({
      article,
      chunkCount: db.select({ id: schema.kbChunks.id }).from(schema.kbChunks).where(eq(schema.kbChunks.articleId, article.id)).all().length,
    }));
}

export function getArticle(db: DB, id: string): typeof schema.kbArticles.$inferSelect | undefined {
  return db.select().from(schema.kbArticles).where(eq(schema.kbArticles.id, id)).get();
}
