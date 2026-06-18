from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID
from sqlalchemy import select, desc, func
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

    async def history_page(self, user_id: UUID, *, before: int | None = None, limit: int = 30) -> list[Message]:
        s = self._session_factory()
        q = (
            select(Message)
            .where(Message.user_id == user_id, Message.role.in_(("user", "assistant")), Message.deleted_at.is_(None))
        )
        if before is not None:
            q = q.where(Message.id < before)
        q = q.order_by(desc(Message.id)).limit(limit)
        rows = (await s.execute(q)).scalars().all()
        return list(reversed(rows))

    async def list_sessions(self, user_id: UUID) -> list[dict]:
        s = self._session_factory()
        sessions = (await s.execute(
            select(ChatSession).where(ChatSession.user_id == user_id).order_by(desc(ChatSession.started_at))
        )).scalars().all()
        out: list[dict] = []
        for sess in sessions:
            count = (await s.execute(
                select(func.count()).select_from(Message).where(
                    Message.session_id == sess.id,
                    Message.role.in_(("user", "assistant")),
                    Message.deleted_at.is_(None),
                )
            )).scalar_one()
            snippet = (await s.execute(
                select(Message.content).where(
                    Message.session_id == sess.id, Message.role == "user", Message.deleted_at.is_(None)
                ).order_by(Message.id).limit(1)
            )).scalar_one_or_none()
            out.append({
                "id": str(sess.id),
                "started_at": sess.started_at.isoformat(),
                "ended_at": sess.ended_at.isoformat() if sess.ended_at else None,
                "message_count": int(count),
                "snippet": (snippet or "")[:80],
            })
        return out

    async def get_session_owned(self, user_id: UUID, session_id: UUID) -> ChatSession | None:
        s = self._session_factory()
        return (await s.execute(
            select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user_id)
        )).scalar_one_or_none()

    async def session_messages(self, user_id: UUID, session_id: UUID) -> list[Message]:
        s = self._session_factory()
        rows = (await s.execute(
            select(Message).where(
                Message.user_id == user_id, Message.session_id == session_id,
                Message.role.in_(("user", "assistant")), Message.deleted_at.is_(None),
            ).order_by(Message.id)
        )).scalars().all()
        return list(rows)

    async def latest_assistant_message_id(self, user_id: UUID) -> int | None:
        s = self._session_factory()
        return (await s.execute(
            select(Message.id)
            .where(Message.user_id == user_id, Message.role == "assistant", Message.deleted_at.is_(None))
            .order_by(desc(Message.id)).limit(1)
        )).scalar_one_or_none()
