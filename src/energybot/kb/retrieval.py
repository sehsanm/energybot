from collections.abc import Callable
from typing import Any
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.normalize_fa import normalize_fa
from energybot.providers.base import EmbeddingRequest


class RetrievalService:
    def __init__(self, *, router, session_factory: Callable[[], AsyncSession], rrf_k: int = 60):
        self._router = router
        self._session_factory = session_factory
        self._rrf_k = rrf_k

    async def search(self, *, query: str, top_k: int = 5, category: str | None) -> list[dict[str, Any]]:
        q_norm = normalize_fa(query)
        if not q_norm:
            return []
        emb_resp = await self._router.embed(call_type="embed", req=EmbeddingRequest(model="", inputs=[q_norm]))
        qvec = emb_resp.vectors[0]
        session = self._session_factory()

        cat_clause = "AND a.category = :category" if category else ""
        # pgvector expects the literal vector string '[v1,v2,...]'. We format it explicitly.
        qvec_str = "[" + ",".join(repr(float(x)) for x in qvec) + "]"
        sql = f"""
        WITH v AS (
            SELECT c.id, c.article_id, c.text, c.metadata, a.title, a.category,
                   ROW_NUMBER() OVER (ORDER BY c.embedding <=> CAST(:qvec AS vector)) AS rank
            FROM kb_chunks c JOIN kb_articles a ON c.article_id = a.id
            WHERE a.status = 'published' AND a.deleted_at IS NULL {cat_clause}
            ORDER BY c.embedding <=> CAST(:qvec AS vector) ASC LIMIT 20
        ),
        k AS (
            SELECT c.id, c.article_id, c.text, c.metadata, a.title, a.category,
                   ROW_NUMBER() OVER (ORDER BY ts_rank(to_tsvector('simple', c.text_normalized), plainto_tsquery('simple', :q_norm)) DESC) AS rank
            FROM kb_chunks c JOIN kb_articles a ON c.article_id = a.id
            WHERE a.status = 'published' AND a.deleted_at IS NULL {cat_clause}
              AND to_tsvector('simple', c.text_normalized) @@ plainto_tsquery('simple', :q_norm)
            ORDER BY ts_rank(to_tsvector('simple', c.text_normalized), plainto_tsquery('simple', :q_norm)) DESC LIMIT 20
        ),
        merged AS (
            SELECT id, article_id, text, metadata, title, category, 1.0 / (:rrf_k + rank) AS s FROM v
            UNION ALL
            SELECT id, article_id, text, metadata, title, category, 1.0 / (:rrf_k + rank) AS s FROM k
        )
        SELECT id, article_id, text, metadata, title, category, SUM(s) AS score
        FROM merged
        GROUP BY id, article_id, text, metadata, title, category
        ORDER BY score DESC LIMIT :top_k
        """
        params = {"qvec": qvec_str, "q_norm": q_norm, "rrf_k": self._rrf_k, "top_k": top_k}
        if category:
            params["category"] = category
        rows = (await session.execute(text(sql), params)).mappings().all()
        return [
            {
                "chunk_id": r["id"],
                "article_id": str(r["article_id"]),
                "article_title": r["title"],
                "chunk_text": r["text"],
                "category": r["category"],
                "relevance": float(r["score"]),
                "source": (r["metadata"] or {}).get("source", "article"),
                "attachment_id": (r["metadata"] or {}).get("attachment_id"),
            }
            for r in rows
        ]
