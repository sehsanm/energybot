from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import ChatSession, ChatSummary, Message


class ChatRepository:
    def __init__(self, *, session_factory: Callable[[], AsyncSession], idle_minutes: int = 30):
        self._session_factory = session_factory
        self._idle = timedelta(minutes=idle_minutes)

    async def session_for(self, user_id: UUID) -> UUID:
        s = self._session_factory()
        open_sess = (await s.execute(
            select(ChatSession).where(ChatSession.user_id == user_id, ChatSession.ended_at.is_(None)).order_by(desc(ChatSession.started_at))
        )).scalars().first()
        if open_sess is not None:
            last = (await s.execute(
                select(Message).where(Message.session_id == open_sess.id).order_by(desc(Message.created_at))
            )).scalars().first()
            last_ts = last.created_at if last else open_sess.started_at
            if datetime.utcnow() - last_ts <= self._idle:
                return open_sess.id
            open_sess.ended_at = datetime.utcnow()
            await s.commit()
        new = ChatSession(user_id=user_id)
        s.add(new)
        await s.commit()
        return new.id

    async def add_message(self, user_id: UUID, session_id: UUID, *, role: str, content: str,
                          tool_name: str | None = None, tool_args: dict[str, Any] | None = None,
                          tool_result: dict[str, Any] | None = None, tokens_in: int | None = None,
                          tokens_out: int | None = None, latency_ms: int | None = None,
                          model_used: str | None = None, meta: dict[str, Any] | None = None) -> int:
        s = self._session_factory()
        m = Message(
            user_id=user_id, session_id=session_id, role=role, content=content,
            tool_name=tool_name, tool_args=tool_args, tool_result=tool_result,
            tokens_in=tokens_in, tokens_out=tokens_out, latency_ms=latency_ms,
            model_used=model_used, meta=meta or {},
        )
        s.add(m)
        await s.commit()
        return m.id

    async def last_n_user_assistant(self, user_id: UUID, *, n: int = 10) -> list[Message]:
        s = self._session_factory()
        rows = (await s.execute(
            select(Message)
            .where(Message.user_id == user_id, Message.role.in_(("user", "assistant")), Message.deleted_at.is_(None))
            .order_by(desc(Message.created_at)).limit(n)
        )).scalars().all()
        return list(reversed(rows))

    async def latest_summary(self, user_id: UUID) -> ChatSummary | None:
        s = self._session_factory()
        return (await s.execute(
            select(ChatSummary).where(ChatSummary.user_id == user_id).order_by(desc(ChatSummary.id))
        )).scalars().first()

    async def messages_since(self, user_id: UUID, after_message_id: int) -> list[Message]:
        s = self._session_factory()
        rows = (await s.execute(
            select(Message)
            .where(Message.user_id == user_id, Message.id > after_message_id, Message.deleted_at.is_(None))
            .order_by(Message.id)
        )).scalars().all()
        return list(rows)
