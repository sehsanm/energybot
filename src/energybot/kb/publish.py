from collections.abc import Callable
from datetime import datetime
from uuid import UUID
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import KBArticle, KBAttachment, KBChunk, VideoTranscript
from energybot.core.normalize_fa import normalize_fa
from energybot.kb.chunking import chunk_text
from energybot.kb.embedding import EmbeddingService
from energybot.kb.repository import KBRepository


class PublishService:
    def __init__(self, *, repo: KBRepository, router, session_factory: Callable[[], AsyncSession]):
        self._repo = repo
        self._embed = EmbeddingService(router=router)
        self._session_factory = session_factory

    async def publish(self, article_id: UUID) -> None:
        s = self._session_factory()
        art = (await s.execute(select(KBArticle).where(KBArticle.id == article_id))).scalar_one()
        atts = (await s.execute(select(KBAttachment).where(KBAttachment.article_id == article_id, KBAttachment.type == "video"))).scalars().all()
        transcripts: dict = {}
        for a in atts:
            t = (await s.execute(select(VideoTranscript).where(VideoTranscript.attachment_id == a.id))).scalar_one_or_none()
            if t is None:
                raise RuntimeError(f"video attachment {a.id} missing transcript; cannot publish")
            transcripts[a.id] = t.text

        article_chunks = chunk_text(art.body)
        inputs: list[str] = list(article_chunks)
        meta: list[dict] = [{"article_title": art.title, "category": art.category, "tags": art.tags, "source": "article"} for _ in article_chunks]
        for att_id, text in transcripts.items():
            vchunks = chunk_text(text)
            inputs.extend(vchunks)
            meta.extend([{"article_title": art.title, "category": art.category, "tags": art.tags, "source": "video", "attachment_id": str(att_id)} for _ in vchunks])
        if not inputs:
            raise RuntimeError("article has no content to publish")

        normalized = [normalize_fa(t) for t in inputs]
        # If embedding fails here, we have not yet mutated the DB — exception bubbles up cleanly.
        vectors = await self._embed.embed_all(normalized)

        await s.execute(delete(KBChunk).where(KBChunk.article_id == article_id))
        for idx, (text, ntext, vec, m) in enumerate(zip(inputs, normalized, vectors, meta)):
            s.add(KBChunk(article_id=article_id, chunk_index=idx, text=text, text_normalized=ntext, embedding=vec, meta=m))

        art.status = "published"
        art.published_at = datetime.utcnow()
        await s.commit()
