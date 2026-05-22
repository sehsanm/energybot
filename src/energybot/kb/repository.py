from collections.abc import Callable
from datetime import datetime
from typing import BinaryIO
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import KBArticle, KBAttachment


class KBRepository:
    def __init__(self, *, session_factory: Callable[[], AsyncSession]):
        self._session_factory = session_factory

    async def create(self, *, title: str, body: str, category: str, tags: list[str], created_by: UUID | None) -> UUID:
        s = self._session_factory()
        art = KBArticle(title=title, body=body, category=category, tags=tags, status="draft", version=1, created_by=created_by)
        s.add(art)
        await s.commit()
        return art.id

    async def get(self, article_id: UUID) -> KBArticle:
        s = self._session_factory()
        return (await s.execute(select(KBArticle).where(KBArticle.id == article_id))).scalar_one()

    async def update(self, article_id: UUID, *, title: str | None = None, body: str | None = None,
                     category: str | None = None, tags: list[str] | None = None) -> None:
        s = self._session_factory()
        row = (await s.execute(select(KBArticle).where(KBArticle.id == article_id))).scalar_one()
        if title is not None: row.title = title
        if body is not None: row.body = body
        if category is not None: row.category = category
        if tags is not None: row.tags = tags
        row.version = row.version + 1
        row.updated_at = datetime.utcnow()
        await s.commit()

    async def soft_delete(self, article_id: UUID) -> None:
        s = self._session_factory()
        row = (await s.execute(select(KBArticle).where(KBArticle.id == article_id))).scalar_one()
        row.deleted_at = datetime.utcnow()
        await s.commit()

    async def restore(self, article_id: UUID) -> None:
        s = self._session_factory()
        row = (await s.execute(select(KBArticle).where(KBArticle.id == article_id))).scalar_one()
        row.deleted_at = None
        await s.commit()

    async def list_visible(self) -> list[KBArticle]:
        s = self._session_factory()
        return list((await s.execute(select(KBArticle).where(KBArticle.deleted_at.is_(None)))).scalars())

    async def list_trashed(self) -> list[KBArticle]:
        s = self._session_factory()
        return list((await s.execute(select(KBArticle).where(KBArticle.deleted_at.is_not(None)))).scalars())

    async def add_attachment(self, article_id: UUID, *, storage, fp: BinaryIO,
                             declared_mime: str, filename: str, caption_fa: str | None = None,
                             order_index: int = 0) -> UUID:
        info = storage.save(fp, declared_mime=declared_mime, filename=filename)
        s = self._session_factory()
        att = KBAttachment(
            article_id=article_id, type=info.type, mime_type=info.mime_type,
            file_size_bytes=info.file_size_bytes, storage_path=info.storage_path,
            caption_fa=caption_fa, order_index=order_index,
        )
        s.add(att)
        await s.commit()
        return att.id
