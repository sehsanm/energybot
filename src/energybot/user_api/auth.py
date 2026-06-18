import time
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Annotated
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.db import get_session
from energybot.core.models import User, UserSession
from energybot.core.security import new_session_token, session_id_for, sign_csrf
from energybot.settings import get_settings
from energybot.user_api.tokens import redeem_login_token

router = APIRouter(prefix="/api/app", tags=["app"])

_REDEEM_HITS: dict[str, list[float]] = defaultdict(list)
_REDEEM_WINDOW = 60.0
_REDEEM_CAP = 10


class RedeemIn(BaseModel):
    t: str


class UserMeOut(BaseModel):
    id: str
    display_name: str | None
    language: str


def _client_ip(request: Request) -> str:
    return (request.client.host if request.client else "?") or "?"


async def current_user(
    request: Request,
    response: Response,
    energybot_user: Annotated[str | None, Cookie()] = None,
    session: AsyncSession = Depends(get_session),
) -> User:
    if not energybot_user:
        raise HTTPException(status_code=401, detail="unauth")
    sid = session_id_for(energybot_user)
    row = (await session.execute(
        select(UserSession).where(UserSession.id == sid, UserSession.expires_at > datetime.utcnow())
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=401, detail="unauth")
    user = (await session.execute(select(User).where(User.id == row.user_id))).scalar_one_or_none()
    if user is None or user.is_blocked or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="inactive")
    s = get_settings()
    expected = sign_csrf(s.session_secret, sid)
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        if request.headers.get("x-csrf") != expected:
            raise HTTPException(status_code=403, detail="bad csrf")
    response.headers["x-csrf"] = expected
    row.last_seen_at = datetime.utcnow()
    await session.commit()
    return user


def _me(user: User) -> UserMeOut:
    return UserMeOut(id=str(user.id), display_name=user.display_name, language=user.language)


@router.post("/auth/redeem")
async def redeem(payload: RedeemIn, request: Request, response: Response,
                 session: AsyncSession = Depends(get_session)) -> dict:
    ip = _client_ip(request)
    now = time.time()
    hits = [t for t in _REDEEM_HITS[ip] if now - t < _REDEEM_WINDOW]
    if len(hits) >= _REDEEM_CAP:
        _REDEEM_HITS[ip] = hits
        raise HTTPException(status_code=429, detail="too many attempts")
    user_id = await redeem_login_token(session, payload.t)
    if user_id is None:
        hits.append(now)
        _REDEEM_HITS[ip] = hits
        raise HTTPException(status_code=401, detail="invalid token")
    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one()
    if user.is_blocked or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="inactive")
    s = get_settings()
    cookie_val, sid = new_session_token()
    expires = datetime.utcnow() + timedelta(days=s.user_session_days)
    session.add(UserSession(id=sid, user_id=user.id, expires_at=expires))
    user.last_seen_at = datetime.utcnow()
    await session.commit()
    response.set_cookie("energybot_user", cookie_val, max_age=s.user_session_days * 86400,
                        httponly=True, samesite="lax", secure=False)
    response.headers["x-csrf"] = sign_csrf(s.session_secret, sid)
    return {"ok": True, "user": _me(user)}


@router.post("/auth/logout")
async def logout(response: Response, request: Request,
                 energybot_user: Annotated[str | None, Cookie()] = None,
                 session: AsyncSession = Depends(get_session)) -> dict:
    if energybot_user:
        sid = session_id_for(energybot_user)
        row = (await session.execute(select(UserSession).where(UserSession.id == sid))).scalar_one_or_none()
        if row is not None:
            await session.delete(row)
            await session.commit()
    response.delete_cookie("energybot_user")
    return {"ok": True}


@router.get("/me", response_model=UserMeOut)
async def me(user: User = Depends(current_user)) -> UserMeOut:
    return _me(user)
