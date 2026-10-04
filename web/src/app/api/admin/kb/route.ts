// GET /api/admin/kb — article list with chunk counts.
// PUT /api/admin/kb {id, title?, bodyMd?, category?, tags?, status?} — save + reindex.

import { getDb, now, schema } from "@/lib/db";
import { badCsrf, csrfGuard, currentAdmin, unauth } from "@/lib/auth/api";
import { listArticles, normalizeArticleRow, saveArticle } from "@/lib/kb/repository";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const admin = await currentAdmin();
  if (!admin) return unauth();
  const rows = listArticles(getDb());
  return Response.json({
    articles: rows.map(({ article, chunkCount }) => ({
      ...normalizeArticleRow(article),
      tags: JSON.parse(article.tags), // array — not the raw JSON text from the row
      chunkCount,
    })),
  });
}

export async function PUT(req: Request): Promise<Response> {
  const admin = await currentAdmin();
  if (!admin) return unauth();
  if (!csrfGuard(req, admin.sessionId)) return badCsrf();
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    title?: string;
    bodyMd?: string;
    category?: string;
    tags?: string[];
    status?: "draft" | "published";
  } | null;
  if (!body?.id) return Response.json({ error: "bad request" }, { status: 400 });

  const db = getDb();
  const { getArticle } = await import("@/lib/kb/repository");
  const existing = getArticle(db, body.id);
  if (!existing) return Response.json({ error: "not found" }, { status: 404 });

  const updated = saveArticle(db, {
    slug: existing.slug,
    title: (body.title ?? existing.title).slice(0, 300),
    bodyMd: body.bodyMd ?? existing.bodyMd,
    category: (body.category ?? existing.category).toLowerCase().slice(0, 40),
    tags: body.tags ?? JSON.parse(existing.tags),
    status: body.status ?? (existing.status as "draft" | "published"),
    source: "admin",
  });
  db.insert(schema.auditLog)
    .values({
      adminId: admin.id,
      action: "kb.article_save",
      entityType: "kb_article",
      entityId: updated.id,
      meta: JSON.stringify({ status: updated.status, chunks: true }),
      createdAt: now(),
    })
    .run();
  return Response.json({ ok: true, article: { ...updated, tags: JSON.parse(updated.tags) } });
}
