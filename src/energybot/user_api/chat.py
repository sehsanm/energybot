import asyncio
import json
import os
from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.db import get_session, get_sessionmaker
from energybot.core.models import KBAttachment, User
from energybot.settings import get_settings
from energybot.agent.builder import build_agent
from energybot.agent.channels import WebChannel
from energybot.chat.repository import ChatRepository
from energybot.logging import get_logger
from energybot.user_api.auth import current_user

router = APIRouter(prefix="/api/app", tags=["app"])


@router.get("/media/{attachment_id}")
async def media(attachment_id: str, user: User = Depends(current_user),
                session: AsyncSession = Depends(get_session)):
    try:
        aid = UUID(attachment_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="not found")
    att = (await session.execute(
        select(KBAttachment).where(KBAttachment.id == aid, KBAttachment.deleted_at.is_(None))
    )).scalar_one_or_none()
    if att is None or not os.path.isfile(att.storage_path):
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(att.storage_path, media_type=att.mime_type)


class ChatIn(BaseModel):
    text: str


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


_FALLBACK = "متأسفم، یه مشکل فنی پیش اومد. می‌تونی یک بار دیگه تلاش کنی؟"


@router.post("/chat")
async def chat(payload: ChatIn, user: User = Depends(current_user)):
    s = get_settings()
    sf = get_sessionmaker()
    text = payload.text
    chat_repo = ChatRepository(session_factory=sf, idle_minutes=s.session_idle_minutes)

    async def gen():
        yield _sse("status", {"text": "در حال فکر کردن…"})
        web = WebChannel()
        try:
            sid = await chat_repo.session_for(user.id)
            await chat_repo.add_message(user.id, sid, role="user", content=text)
            agent = build_agent(user_id=user.id, channel=web, session_factory=sf)
            final = await agent.handle(text)
            await chat_repo.add_message(user.id, sid, role="assistant", content=final)
        except Exception:
            get_logger(__name__).exception("web_chat_failed", user_id=str(user.id))
            yield _sse("error", {"text": _FALLBACK})
            return
        for ev in web.events:
            yield _sse("media", ev)
        n = max(1, s.web_chat_chunk_chars)
        for i in range(0, len(final), n):
            yield _sse("chunk", {"text": final[i:i + n]})
            if s.web_chat_chunk_delay_ms:
                await asyncio.sleep(s.web_chat_chunk_delay_ms / 1000)
        msg_id = await chat_repo.latest_assistant_message_id(user.id)
        yield _sse("done", {"message_id": msg_id})

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/chat/history")
async def chat_history(
    user: User = Depends(current_user),
    before: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
):
    s = get_settings()
    repo = ChatRepository(session_factory=get_sessionmaker(), idle_minutes=s.session_idle_minutes)
    rows = await repo.history_page(user.id, before=before, limit=limit)
    return {"messages": [
        {"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
        for m in rows
    ]}
