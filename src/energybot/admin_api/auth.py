import time
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Annotated
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.db import get_session
from energybot.core.models import AdminSession, AdminUser
from energybot.core.security import hash_password, new_session_token, session_id_for, sign_csrf, verify_password
from energybot.settings import get_settings

router = APIRouter(prefix="/api/admin", tags=["admin"])

_LOGIN_HITS: dict[str, list[float]] = defaultdict(list)
_LOGIN_WINDOW = 60.0
_LOGIN_CAP = 5


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class MeOut(BaseModel):
    id: str
    email: str
    role: str


def _client_ip(request: Request) -> str:
    return (request.client.host if request.client else "?") or "?"


async def current_admin(
    request: Request,
    response: Response,
    energybot_admin: Annotated[str | None, Cookie()] = None,
    session: AsyncSession = Depends(get_session),
) -> AdminUser:
    if not energybot_admin:
        raise HTTPException(status_code=401, detail="unauth")
    sid = session_id_for(energybot_admin)
    row = (await session.execute(
        select(AdminSession).where(AdminSession.id == sid, AdminSession.expires_at > datetime.utcnow())
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=401, detail="unauth")
    user = (await session.execute(select(AdminUser).where(AdminUser.id == row.admin_user_id))).scalar_one()
    if not user.is_active:
        raise HTTPException(status_code=401, detail="inactive")
    s = get_settings()
    expected = sign_csrf(s.session_secret, sid)
    response.headers["x-csrf"] = expected
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        if request.headers.get("x-csrf") != expected:
            raise HTTPException(status_code=403, detail="bad csrf")
    return user


@router.post("/login")
async def login(payload: LoginIn, request: Request, response: Response, session: AsyncSession = Depends(get_session)) -> dict:
    ip = _client_ip(request)
    now = time.time()
    hits = [t for t in _LOGIN_HITS[ip] if now - t < _LOGIN_WINDOW]
    if len(hits) >= _LOGIN_CAP:
        _LOGIN_HITS[ip] = hits
        raise HTTPException(status_code=429, detail="too many attempts")
    user = (await session.execute(select(AdminUser).where(AdminUser.email == payload.email, AdminUser.is_active.is_(True)))).scalar_one_or_none()
    if user is None or not verify_password(user.password_hash, payload.password):
        hits.append(now)
        _LOGIN_HITS[ip] = hits
        raise HTTPException(status_code=401, detail="invalid credentials")
    cookie_val, sid = new_session_token()
    expires = datetime.utcnow() + timedelta(days=30)
    session.add(AdminSession(id=sid, admin_user_id=user.id, expires_at=expires))
    user.last_login_at = datetime.utcnow()
    await session.commit()
    s = get_settings()
    response.set_cookie("energybot_admin", cookie_val, max_age=30 * 86400, httponly=True, samesite="strict", secure=False)
    response.headers["x-csrf"] = sign_csrf(s.session_secret, sid)
    return {"ok": True}


@router.post("/logout")
async def logout(response: Response, admin: AdminUser = Depends(current_admin)) -> dict:
    response.delete_cookie("energybot_admin")
    return {"ok": True}


@router.get("/me", response_model=MeOut)
async def me(admin: AdminUser = Depends(current_admin)) -> MeOut:
    return MeOut(id=str(admin.id), email=admin.email, role=admin.role)
