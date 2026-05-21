from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session, get_sessionmaker
from energybot.core.models import AdminUser
from energybot.kb.media_storage import MediaStorage
from energybot.kb.publish import PublishService
from energybot.kb.repository import KBRepository
from energybot.kb.retrieval import RetrievalService
from energybot.providers.frontier import FrontierProvider
from energybot.providers.metis import MetisProvider
from energybot.providers.router import ProviderRouter
from energybot.settings import get_settings

router = APIRouter(prefix="/api/admin/kb", tags=["admin-kb"])


def build_router_for_admin(session_factory):
    s = get_settings()
    return ProviderRouter(
        providers={
            "frontier": FrontierProvider(api_key=s.frontier_api_key, base_url=s.frontier_base_url, proxy_url=s.frontier_proxy_url),
            "metis": MetisProvider(api_key=s.metis_api_key, base_url=s.metis_base_url),
        },
        session_factory=session_factory,
    )


def _session_factory(s: AsyncSession):
    return lambda: s


@router.post("/articles")
async def create_article(payload: dict, admin: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    repo = KBRepository(session_factory=_session_factory(s))
    aid = await repo.create(title=payload["title"], body=payload["body"], category=payload["category"], tags=payload.get("tags", []), created_by=admin.id)
    return {"id": str(aid)}


@router.get("/articles")
async def list_articles(_: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    repo = KBRepository(session_factory=_session_factory(s))
    rows = await repo.list_visible()
    return {"articles": [{"id": str(r.id), "title": r.title, "category": r.category, "status": r.status, "version": r.version, "updated_at": r.updated_at.isoformat()} for r in rows]}


@router.get("/articles/{article_id}")
async def get_article(article_id: UUID, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    repo = KBRepository(session_factory=_session_factory(s))
    a = await repo.get(article_id)
    return {"id": str(a.id), "title": a.title, "body": a.body, "category": a.category, "tags": a.tags, "status": a.status, "version": a.version}


@router.put("/articles/{article_id}")
async def update_article(article_id: UUID, payload: dict, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    repo = KBRepository(session_factory=_session_factory(s))
    await repo.update(article_id, title=payload.get("title"), body=payload.get("body"),
                      category=payload.get("category"), tags=payload.get("tags"))
    return {"ok": True}


@router.delete("/articles/{article_id}")
async def delete_article(article_id: UUID, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    repo = KBRepository(session_factory=_session_factory(s))
    await repo.soft_delete(article_id)
    return {"ok": True}


@router.post("/articles/{article_id}/publish")
async def publish_article(article_id: UUID, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    repo = KBRepository(session_factory=_session_factory(s))
    rtr = build_router_for_admin(_session_factory(s))
    svc = PublishService(repo=repo, router=rtr, session_factory=_session_factory(s))
    await svc.publish(article_id)
    return {"ok": True}


@router.post("/articles/{article_id}/attachments")
async def upload_attachment(article_id: UUID, file: UploadFile = File(...), caption_fa: str = Form(""), _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    settings = get_settings()
    storage = MediaStorage(root=settings.media_root)
    repo = KBRepository(session_factory=_session_factory(s))
    att_id = await repo.add_attachment(
        article_id, storage=storage, fp=file.file, declared_mime=file.content_type or "application/octet-stream",
        filename=file.filename or "file", caption_fa=caption_fa,
    )
    return {"id": str(att_id)}


@router.post("/search")
async def search_test(payload: dict, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    rtr = build_router_for_admin(_session_factory(s))
    ret = RetrievalService(router=rtr, session_factory=_session_factory(s))
    hits = await ret.search(query=payload["query"], top_k=int(payload.get("top_k", 5)), category=payload.get("category"))
    return {"hits": hits}
