// GET /api/admin/kb/:id — single article with body (for the edit form).

import { getDb } from "@/lib/db";
import { currentAdmin, unauth } from "@/lib/auth/api";
import { getArticle, normalizeArticleRow } from "@/lib/kb/repository";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const admin = await currentAdmin();
  if (!admin) return unauth();
  const { id } = await ctx.params;
  const article = getArticle(getDb(), id);
  if (!article) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({
    article: {
      ...normalizeArticleRow(article),
      tags: JSON.parse(article.tags), // array — not the raw JSON text from the row
    },
  });
}
