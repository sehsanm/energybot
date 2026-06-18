from datetime import datetime, timedelta
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import WebLoginToken
from energybot.core.security import new_session_token, session_id_for


async def mint_login_token(session: AsyncSession, user_id: UUID, *, ttl_minutes: int) -> str:
    raw, token_hash = new_session_token()
    session.add(WebLoginToken(
        token_hash=token_hash,
        user_id=user_id,
        expires_at=datetime.utcnow() + timedelta(minutes=ttl_minutes),
    ))
    await session.commit()
    return raw


async def redeem_login_token(session: AsyncSession, raw_token: str) -> UUID | None:
    token_hash = session_id_for(raw_token)
    row = (await session.execute(
        select(WebLoginToken).where(
            WebLoginToken.token_hash == token_hash,
            WebLoginToken.used_at.is_(None),
            WebLoginToken.expires_at > datetime.utcnow(),
        )
    )).scalar_one_or_none()
    if row is None:
        return None
    row.used_at = datetime.utcnow()
    await session.commit()
    return row.user_id
