# User Web Platform — Stage 1 (Auth Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the authentication foundation for the user web platform: Bale-initiated magic-link login, web sessions, a `current_user` gate, the `/web` bot entry point, and the `app_ui` frontend shell with a working auth screen.

**Architecture:** A one-time login token is minted by the Bale bot and delivered as a deep-link button. The browser redeems it at `POST /api/app/auth/redeem`, which creates a `UserSession` and sets an httpOnly cookie. A `current_user` FastAPI dependency (parallel to the existing `current_admin`) gates the new `/api/app/*` router. The frontend is a new Next.js static-export app `app_ui` mounted at `/app`, reusing `admin_ui`'s toolchain and component conventions.

**Tech Stack:** Python 3 + FastAPI + SQLAlchemy (async) + Alembic + Postgres; Next.js static export + React + Tailwind; pytest (unit + Postgres integration).

## Global Constraints

- Persian-only (`fa`), RTL throughout the frontend.
- Reuse `energybot/core/security.py` helpers — never store raw tokens; store `sha256` hashes.
- Cookie auth must mirror admin exactly: httpOnly cookie + `x-csrf` header echoed on every authed response, required on mutating requests.
- `current_user` must reject users where `is_blocked` is true or `deleted_at` is set.
- Single container; FastAPI serves the static frontend (no Node runtime in production).
- Follow existing module layout: backend feature packages under `src/energybot/`, integration tests under `tests/integration/`.
- New backend package for this surface: `src/energybot/user_api/`.

**Reference spec:** `docs/superpowers/specs/2026-06-18-user-web-platform-design.md`

---

## File Structure

- `src/energybot/core/models.py` — add `WebLoginToken`, `UserSession` models (modify).
- `alembic/versions/<rev>_user_web_auth.py` — migration for the two tables (create).
- `src/energybot/user_api/__init__.py` — new package (create).
- `src/energybot/user_api/tokens.py` — mint/redeem login-token service (create).
- `src/energybot/user_api/auth.py` — `/api/app` auth router + `current_user` dependency + `UserMeOut` (create).
- `src/energybot/settings.py` — add `public_base_url`, `web_login_token_ttl_minutes`, `user_session_days` (modify).
- `src/energybot/bale_adapter/handler.py` — handle `/web` command, send deep-link button (modify).
- `src/energybot/bale_adapter/web_login.py` — pure `build_web_login_markup(...)` helper (create).
- `src/energybot/main.py` — include the user-auth router + mount `app_ui/out` at `/app` (modify).
- `app_ui/` — new Next.js static-export frontend: shell (sidebar/topbar), auth screen, API client (create).
- Tests: `tests/test_web_login_markup.py`, `tests/integration/test_user_auth.py`, `tests/integration/test_bot_web_entry.py` (create).

---

### Task 1: DB models + migration for web auth tables

**Files:**
- Modify: `src/energybot/core/models.py` (append two model classes)
- Create: `alembic/versions/<rev>_user_web_auth.py`
- Test: `tests/integration/test_user_auth.py` (first test only — table round-trip)

**Interfaces:**
- Produces:
  - `WebLoginToken(token_hash: str [PK], user_id: UUID, expires_at: datetime, used_at: datetime|None, created_at: datetime)`
  - `UserSession(id: str [PK], user_id: UUID, issued_at: datetime, last_seen_at: datetime, expires_at: datetime)`

- [ ] **Step 1: Add the models**

Append to `src/energybot/core/models.py` (the file already imports `datetime`, `UUID`, `PGUUID`, `String`, `ForeignKey`, `func`, `Base`):

```python
class WebLoginToken(Base):
    __tablename__ = "web_login_tokens"
    token_hash: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    used_at: Mapped[datetime | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class UserSession(Base):
    __tablename__ = "user_sessions"
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    issued_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
```

- [ ] **Step 2: Create the migration**

First find the current head: `alembic heads`. At time of writing it is `a1b2c3d4e5f6`. Set `down_revision` to whatever `alembic heads` prints.

Create `alembic/versions/c3d4e5f6a1b2_user_web_auth.py`:

```python
"""user web auth tables

Revision ID: c3d4e5f6a1b2
Revises: a1b2c3d4e5f6
Create Date: 2026-06-18 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID

revision: str = "c3d4e5f6a1b2"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "web_login_tokens",
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("user_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("token_hash"),
    )
    op.create_index(op.f("ix_web_login_tokens_user_id"), "web_login_tokens", ["user_id"])
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("user_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("issued_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_sessions_user_id"), "user_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_user_sessions_user_id"), table_name="user_sessions")
    op.drop_table("user_sessions")
    op.drop_index(op.f("ix_web_login_tokens_user_id"), table_name="web_login_tokens")
    op.drop_table("web_login_tokens")
```

- [ ] **Step 3: Apply the migration to the test DB**

Run:
```bash
docker compose -f docker-compose.test.yml up -d
TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  alembic upgrade head
```
Expected: `Running upgrade a1b2c3d4e5f6 -> c3d4e5f6a1b2, user web auth tables`.

- [ ] **Step 4: Add the table cleanup to the integration conftest**

In `tests/integration/conftest.py`, inside `clean_router_tables`, add deletes for the two new tables **before** the `DELETE FROM users` line in BOTH the pre-test and post-test blocks (they are children of `users`):

```python
    await db_session.execute(text("DELETE FROM user_sessions"))
    await db_session.execute(text("DELETE FROM web_login_tokens"))
```

- [ ] **Step 5: Write the round-trip test**

Create `tests/integration/test_user_auth.py`:

```python
import os
from datetime import datetime, timedelta
import pytest
from sqlalchemy import select
from energybot.core.models import User, UserSession, WebLoginToken

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


@pytest.mark.asyncio
async def test_web_auth_tables_roundtrip(db_session):
    u = User(bale_user_id=11111, display_name="آرش")
    db_session.add(u)
    await db_session.flush()
    db_session.add(WebLoginToken(token_hash="h1", user_id=u.id, expires_at=datetime.utcnow() + timedelta(minutes=5)))
    db_session.add(UserSession(id="s1", user_id=u.id, expires_at=datetime.utcnow() + timedelta(days=30)))
    await db_session.commit()
    tok = (await db_session.execute(select(WebLoginToken).where(WebLoginToken.token_hash == "h1"))).scalar_one()
    sess = (await db_session.execute(select(UserSession).where(UserSession.id == "s1"))).scalar_one()
    assert tok.user_id == u.id
    assert sess.user_id == u.id
```

- [ ] **Step 6: Run the test**

Run:
```bash
TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  pytest tests/integration/test_user_auth.py::test_web_auth_tables_roundtrip -v
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/energybot/core/models.py alembic/versions/c3d4e5f6a1b2_user_web_auth.py tests/integration/conftest.py tests/integration/test_user_auth.py
git commit -m "feat(user-auth): add web_login_tokens and user_sessions tables"
```

---

### Task 2: Login-token mint/redeem service

**Files:**
- Create: `src/energybot/user_api/__init__.py` (empty)
- Create: `src/energybot/user_api/tokens.py`
- Modify: `src/energybot/settings.py` (add `web_login_token_ttl_minutes`)
- Test: `tests/integration/test_user_auth.py` (append)

**Interfaces:**
- Consumes: `core.security.new_session_token`, `core.security.session_id_for`; `core.models.WebLoginToken`.
- Produces:
  - `async def mint_login_token(session: AsyncSession, user_id: UUID, *, ttl_minutes: int) -> str` — returns the raw token (store only its hash).
  - `async def redeem_login_token(session: AsyncSession, raw_token: str) -> UUID | None` — returns the `user_id` on success (and marks the token used), else `None`.

- [ ] **Step 1: Add the TTL setting**

In `src/energybot/settings.py`, add inside `Settings` (near `session_idle_minutes`):

```python
    web_login_token_ttl_minutes: int = 5
    user_session_days: int = 30
    public_base_url: str = ""  # public origin for deep links, e.g. https://app.example.ir
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/integration/test_user_auth.py`:

```python
from energybot.user_api.tokens import mint_login_token, redeem_login_token


@pytest.mark.asyncio
async def test_mint_then_redeem_returns_user_id(db_session):
    u = User(bale_user_id=22222)
    db_session.add(u)
    await db_session.flush()
    raw = await mint_login_token(db_session, u.id, ttl_minutes=5)
    assert isinstance(raw, str) and len(raw) > 20
    got = await redeem_login_token(db_session, raw)
    assert got == u.id


@pytest.mark.asyncio
async def test_redeem_is_single_use(db_session):
    u = User(bale_user_id=33333)
    db_session.add(u)
    await db_session.flush()
    raw = await mint_login_token(db_session, u.id, ttl_minutes=5)
    assert await redeem_login_token(db_session, raw) == u.id
    assert await redeem_login_token(db_session, raw) is None


@pytest.mark.asyncio
async def test_redeem_expired_returns_none(db_session):
    u = User(bale_user_id=44444)
    db_session.add(u)
    await db_session.flush()
    raw = await mint_login_token(db_session, u.id, ttl_minutes=-1)  # already expired
    assert await redeem_login_token(db_session, raw) is None


@pytest.mark.asyncio
async def test_redeem_unknown_token_returns_none(db_session):
    assert await redeem_login_token(db_session, "not-a-real-token") is None
```

- [ ] **Step 3: Run the tests to verify they fail**

Run:
```bash
TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  pytest tests/integration/test_user_auth.py -k "mint or redeem" -v
```
Expected: FAIL with `ModuleNotFoundError: energybot.user_api.tokens`.

- [ ] **Step 4: Create the package and implementation**

Create empty `src/energybot/user_api/__init__.py`.

Create `src/energybot/user_api/tokens.py`:

```python
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  pytest tests/integration/test_user_auth.py -k "mint or redeem" -v
```
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/user_api/__init__.py src/energybot/user_api/tokens.py src/energybot/settings.py tests/integration/test_user_auth.py
git commit -m "feat(user-auth): login-token mint/redeem service"
```

---

### Task 3: `current_user` dependency + `/api/app` auth router

**Files:**
- Create: `src/energybot/user_api/auth.py`
- Modify: `src/energybot/main.py` (include the router)
- Test: `tests/integration/test_user_auth.py` (append HTTP tests)

**Interfaces:**
- Consumes: `tokens.redeem_login_token`; `core.security.new_session_token`, `session_id_for`, `sign_csrf`; `core.models.User`, `UserSession`; `core.db.get_session`; `settings.get_settings`.
- Produces:
  - `router` (APIRouter, prefix `/api/app`) with `POST /auth/redeem`, `POST /auth/logout`, `GET /me`.
  - `async def current_user(request, response, energybot_user: Cookie, session) -> User` — the dependency later stages import to gate routes.
  - `UserMeOut(id: str, display_name: str | None, language: str)`.
  - Redeem sets cookie `energybot_user` and returns `{"user": UserMeOut, "ok": True}`.

- [ ] **Step 1: Write the failing HTTP tests**

Append to `tests/integration/test_user_auth.py`:

```python
from httpx import ASGITransport, AsyncClient


@pytest.fixture
async def app(monkeypatch, db_session):
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    monkeypatch.setenv("SESSION_SECRET", "z" * 32)
    monkeypatch.setenv("BALE_WEBHOOK_SECRET", "x")
    monkeypatch.setenv("BALE_BOT_TOKEN", "t")
    monkeypatch.setenv("FRONTIER_API_KEY", "f")
    monkeypatch.setenv("METIS_API_KEY", "m")
    from energybot.settings import get_settings
    get_settings.cache_clear()
    import energybot.core.db as _db
    _db._engine = None
    _db._sessionmaker = None
    import energybot.user_api.auth as _uauth
    _uauth._REDEEM_HITS.clear()
    from energybot.main import create_app
    return create_app()


async def _mint_for(db_session, bale_user_id: int) -> str:
    u = User(bale_user_id=bale_user_id)
    db_session.add(u)
    await db_session.flush()
    raw = await mint_login_token(db_session, u.id, ttl_minutes=5)
    return raw


@pytest.mark.asyncio
async def test_redeem_sets_session_cookie(app, db_session):
    raw = await _mint_for(db_session, 55555)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/api/app/auth/redeem", json={"t": raw})
    assert r.status_code == 200
    assert "energybot_user" in r.cookies
    assert r.json()["user"]["id"]


@pytest.mark.asyncio
async def test_redeem_bad_token_401(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/api/app/auth/redeem", json={"t": "nope"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_requires_session(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/app/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_user_after_redeem(app, db_session):
    raw = await _mint_for(db_session, 66666)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await c.post("/api/app/auth/redeem", json={"t": raw})
        r = await c.get("/api/app/me")
    assert r.status_code == 200
    assert r.json()["language"] == "fa"


@pytest.mark.asyncio
async def test_blocked_user_rejected(app, db_session):
    from sqlalchemy import update
    raw = await _mint_for(db_session, 77777)
    from energybot.core.models import User as U
    await db_session.execute(update(U).where(U.bale_user_id == 77777).values(is_blocked=True))
    await db_session.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await c.post("/api/app/auth/redeem", json={"t": raw})
        r = await c.get("/api/app/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_redeem_rate_limited(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        for _ in range(10):
            await c.post("/api/app/auth/redeem", json={"t": "nope"})
        r = await c.post("/api/app/auth/redeem", json={"t": "nope"})
    assert r.status_code == 429
```

- [ ] **Step 2: Run to verify failure**

Run:
```bash
TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  pytest tests/integration/test_user_auth.py -k "redeem_sets or me_ or blocked or rate_limited" -v
```
Expected: FAIL (`ModuleNotFoundError: energybot.user_api.auth` / 404s).

- [ ] **Step 3: Implement the router and dependency**

Create `src/energybot/user_api/auth.py`:

```python
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
    row.last_seen_at = datetime.utcnow()
    await session.commit()
    s = get_settings()
    expected = sign_csrf(s.session_secret, sid)
    response.headers["x-csrf"] = expected
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        if request.headers.get("x-csrf") != expected:
            raise HTTPException(status_code=403, detail="bad csrf")
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
```

> Note: `secure=False` matches the admin cookie today (TLS terminated by the reverse proxy in prod). Keep it identical to admin for consistency; hardening both to `secure=True` is a separate change.

- [ ] **Step 4: Wire the router into the app**

In `src/energybot/main.py`, add the import near the other router imports:

```python
from energybot.user_api.auth import router as user_auth_router
```

and add inside `create_app()` after `app.include_router(admin_stats_router)`:

```python
    app.include_router(user_auth_router)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:
```bash
TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  pytest tests/integration/test_user_auth.py -v
```
Expected: all tests in the file pass.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/user_api/auth.py src/energybot/main.py tests/integration/test_user_auth.py
git commit -m "feat(user-auth): /api/app redeem, logout, me + current_user gate"
```

---

### Task 4: Bot `/web` entry point (deep-link button)

**Files:**
- Create: `src/energybot/bale_adapter/web_login.py`
- Modify: `src/energybot/bale_adapter/handler.py` (handle `/web`; update `/help` text)
- Test: `tests/test_web_login_markup.py` (pure unit), `tests/integration/test_bot_web_entry.py` (handler integration)

**Interfaces:**
- Consumes: `tokens.mint_login_token`; `settings.public_base_url`, `web_login_token_ttl_minutes`.
- Produces: `def build_web_login_markup(url: str) -> dict` — an inline keyboard with a single URL button labeled `"🌐 ورود به نسخهٔ وب"`.

- [ ] **Step 1: Write the failing unit test**

Create `tests/test_web_login_markup.py`:

```python
from energybot.bale_adapter.web_login import build_web_login_markup


def test_markup_has_single_url_button():
    m = build_web_login_markup("https://app.example.ir/app/auth?t=abc")
    btn = m["inline_keyboard"][0][0]
    assert btn["url"] == "https://app.example.ir/app/auth?t=abc"
    assert "وب" in btn["text"]
    assert "callback_data" not in btn
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_web_login_markup.py -v`
Expected: FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Implement the helper**

Create `src/energybot/bale_adapter/web_login.py`:

```python
def build_web_login_markup(url: str) -> dict:
    return {"inline_keyboard": [[{"text": "🌐 ورود به نسخهٔ وب", "url": url}]]}
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_web_login_markup.py -v`
Expected: PASS.

- [ ] **Step 5: Handle `/web` in the bot handler**

In `src/energybot/bale_adapter/handler.py`, inside `handle_bale_update`, in the `UpdateText` branch, add a new command handler right after the `/help` block:

```python
        if text == "/web":
            from energybot.settings import get_settings
            from energybot.user_api.tokens import mint_login_token
            from energybot.bale_adapter.web_login import build_web_login_markup
            s = get_settings()
            if not s.public_base_url:
                await bale.send_message(chat_id=parsed.chat_id, text="نسخهٔ وب هنوز پیکربندی نشده است.")
                return
            raw = await mint_login_token(session, user.id, ttl_minutes=s.web_login_token_ttl_minutes)
            url = f"{s.public_base_url.rstrip('/')}/app/auth?t={raw}"
            await bale.send_message(
                chat_id=parsed.chat_id,
                text="برای ورود به نسخهٔ وب روی دکمهٔ زیر بزن. این لینک یک‌بارمصرف است و تا چند دقیقه اعتبار دارد.",
                reply_markup=build_web_login_markup(url),
            )
            return
```

Also update the `/help` text string to mention `/web` (append ` /web برای ورود به نسخهٔ وب.` before the closing quote).

- [ ] **Step 6: Write the handler integration test**

Create `tests/integration/test_bot_web_entry.py`:

```python
import os
import pytest
from sqlalchemy import select
from energybot.core.models import User, WebLoginToken

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


class _FakeBale:
    def __init__(self):
        self.sent = []

    async def send_chat_action(self, **kw):
        pass

    async def send_message(self, *, chat_id, text, reply_markup=None):
        self.sent.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})
        return 1


@pytest.fixture
def fake_bale(monkeypatch):
    fb = _FakeBale()
    import energybot.bale_adapter.handler as h
    monkeypatch.setattr(h, "get_bale_client", lambda: fb)
    return fb


@pytest.mark.asyncio
async def test_web_command_sends_deep_link_button(monkeypatch, db_session, fake_bale):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://app.example.ir")
    from energybot.settings import get_settings
    get_settings.cache_clear()

    def session_factory():
        return db_session

    from energybot.bale_adapter.handler import handle_bale_update
    body = {
        "update_id": 9001,
        "message": {"message_id": 1, "from": {"id": 88888}, "chat": {"id": 88888}, "text": "/web"},
    }
    await handle_bale_update(body, session_factory=session_factory)

    assert len(fake_bale.sent) >= 1
    last = fake_bale.sent[-1]
    btn = last["reply_markup"]["inline_keyboard"][0][0]
    assert btn["url"].startswith("https://app.example.ir/app/auth?t=")
    tok = (await db_session.execute(select(WebLoginToken))).scalars().first()
    assert tok is not None
```

> If the parsed-update shape differs, mirror an existing handler test's body (see how `parse_update` is exercised in `tests/test_bale_parser.py`). The required fields are `update_id`, and a `message` with `from.id`, `chat.id`, and `text`.

- [ ] **Step 7: Run the handler test**

Run:
```bash
TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  pytest tests/integration/test_bot_web_entry.py -v
```
Expected: PASS. If it fails on update parsing, adjust `body` to match `tests/test_bale_parser.py`, not the handler code.

- [ ] **Step 8: Commit**

```bash
git add src/energybot/bale_adapter/web_login.py src/energybot/bale_adapter/handler.py tests/test_web_login_markup.py tests/integration/test_bot_web_entry.py
git commit -m "feat(user-auth): /web bot command sends one-time deep-link button"
```

---

### Task 5: `app_ui` frontend shell + auth screen + `/app` mount

**Files:**
- Create: `app_ui/` Next.js app (config copied/adapted from `admin_ui`).
- Create: `app_ui/src/lib/api.ts`, `app_ui/src/app/auth/page.tsx`, `app_ui/src/app/page.tsx` (dashboard placeholder), `app_ui/src/components/AppShell.tsx`, `Sidebar.tsx`, `Topbar.tsx`.
- Modify: `src/energybot/main.py` (mount `app_ui/out` at `/app`).
- Modify: `README.md` (build step), `.env.example` (`PUBLIC_BASE_URL`).

**Interfaces:**
- Consumes: `POST /api/app/auth/redeem`, `GET /api/app/me`, `POST /api/app/auth/logout`.

> Frontend has no unit-test convention in this repo (neither `admin_ui` nor `landing_ui` ship FE tests). Verification for this task is a successful production build plus a manual/Playwright smoke of the login→shell flow.

- [ ] **Step 1: Scaffold by copying admin_ui's config**

Copy the build/config files (NOT the pages) from `admin_ui` and adapt the basePath:

```bash
mkdir -p app_ui/src/app app_ui/src/components/ui app_ui/src/lib
cp admin_ui/package.json app_ui/package.json
cp admin_ui/next.config.* app_ui/ 2>/dev/null || true
cp admin_ui/tsconfig.json app_ui/tsconfig.json
cp admin_ui/postcss.config.* app_ui/ 2>/dev/null || true
cp admin_ui/tailwind.config.* app_ui/ 2>/dev/null || true
cp admin_ui/.gitignore app_ui/.gitignore 2>/dev/null || true
cp admin_ui/src/app/globals.css app_ui/src/app/globals.css
cp admin_ui/src/lib/cn.ts app_ui/src/lib/cn.ts
cp admin_ui/src/lib/csrf.ts app_ui/src/lib/csrf.ts 2>/dev/null || true
cp -r admin_ui/src/components/ui/. app_ui/src/components/ui/
cp admin_ui/src/components/ThemeToggle.tsx app_ui/src/components/ThemeToggle.tsx
```

Then edit `app_ui/next.config.*`: set `basePath: "/app"` and keep `output: "export"`. Edit `app_ui/package.json`: change `"name"` to `"app_ui"`. Confirm `next.config` has `output: "export"` (match admin_ui's value).

- [ ] **Step 2: Write the API client**

Create `app_ui/src/lib/api.ts`:

```ts
let csrf = "";

async function req(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const method = (init.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && csrf) headers.set("x-csrf", csrf);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(`/api/app${path}`, { ...init, headers, credentials: "same-origin" });
  const c = res.headers.get("x-csrf");
  if (c) csrf = c;
  return res;
}

export async function redeem(t: string) {
  const r = await req("/auth/redeem", { method: "POST", body: JSON.stringify({ t }) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
export async function getMe() {
  const r = await req("/me");
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
export async function logout() {
  await req("/auth/logout", { method: "POST" });
}
```

- [ ] **Step 3: Build the shell components**

Create `app_ui/src/components/Sidebar.tsx`:

```tsx
"use client";
const ITEMS = [
  { href: "/app", label: "داشبورد" },
  { href: "/app/chat", label: "گفتگو" },
  { href: "/app/bills", label: "قبض‌ها" },
  { href: "/app/history", label: "تاریخچه" },
  { href: "/app/profile", label: "پروفایل" },
];
export function Sidebar() {
  return (
    <nav className="flex flex-col gap-1 p-3 border-s w-56 shrink-0">
      {ITEMS.map((i) => (
        <a key={i.href} href={i.href} className="rounded-md px-3 py-2 text-sm hover:bg-muted">
          {i.label}
        </a>
      ))}
    </nav>
  );
}
```

Create `app_ui/src/components/Topbar.tsx`:

```tsx
"use client";
import { logout } from "@/lib/api";
export function Topbar({ name }: { name?: string | null }) {
  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <span className="text-sm font-medium">{name || "کاربر"}</span>
      <button
        className="text-sm text-muted-foreground hover:text-foreground"
        onClick={async () => { await logout(); window.location.href = "/app/auth"; }}
      >
        خروج
      </button>
    </header>
  );
}
```

Create `app_ui/src/components/AppShell.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { getMe } from "@/lib/api";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "anon">("loading");
  useEffect(() => {
    getMe().then((m) => { setName(m.display_name); setState("ok"); })
      .catch(() => { setState("anon"); window.location.href = "/app/auth"; });
  }, []);
  if (state !== "ok") return <div className="p-8 text-center text-sm">در حال بارگذاری…</div>;
  return (
    <div className="flex min-h-screen" dir="rtl">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Topbar name={name} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Build the root layout, auth page, and dashboard placeholder**

Create `app_ui/src/app/layout.tsx`:

```tsx
import "./globals.css";
export const metadata = { title: "انرژی‌بات" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
```

Create `app_ui/src/app/auth/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { redeem } from "@/lib/api";

export default function AuthPage() {
  const [error, setError] = useState(false);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (!t) { setError(true); return; }
    redeem(t).then(() => { window.location.href = "/app"; }).catch(() => setError(true));
  }, []);
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center p-8 text-center">
      {error ? (
        <div className="space-y-2">
          <p className="text-sm">این لینک معتبر نیست یا منقضی شده.</p>
          <p className="text-sm text-muted-foreground">به بله برگرد و دوباره دستور /web را بفرست.</p>
        </div>
      ) : (
        <p className="text-sm">در حال ورود…</p>
      )}
    </div>
  );
}
```

Create `app_ui/src/app/page.tsx` (dashboard placeholder; real dashboard is Stage 4):

```tsx
"use client";
import { AppShell } from "@/components/AppShell";
export default function DashboardPage() {
  return (
    <AppShell>
      <h1 className="text-lg font-semibold">داشبورد</h1>
      <p className="mt-2 text-sm text-muted-foreground">به‌زودی…</p>
    </AppShell>
  );
}
```

- [ ] **Step 5: Build the frontend**

Run:
```bash
cd app_ui && npm install && npm run build && cd ..
```
Expected: a static export under `app_ui/out` with `app/index.html` and `app/auth/index.html` (basePath `/app`). If the export path layout differs, match how `admin_ui/out` is structured.

- [ ] **Step 6: Mount `/app` in the backend**

In `src/energybot/main.py`, after the landing mount block, add:

```python
    app_dir = os.environ.get("ENERGYBOT_APP_STATIC_DIR", "app_ui/out")
    if os.path.isdir(app_dir):
        app.mount("/app", StaticFiles(directory=app_dir, html=True), name="app")
```

> Mount `/app` BEFORE the `/` landing mount (the landing mount at `/` is a catch-all and must remain last). Place this block immediately above the existing `landing_dir` block.

- [ ] **Step 7: Manual smoke test**

Run the server with a public base set:
```bash
PUBLIC_BASE_URL=http://localhost:8000 uvicorn energybot.main:app --reload
```
Then verify the redeem flow end-to-end with a freshly minted token:
```bash
python - <<'PY'
import asyncio
from energybot.core.db import get_sessionmaker
from energybot.core.models import User
from energybot.user_api.tokens import mint_login_token
async def main():
    sm = get_sessionmaker()
    async with sm() as s:
        u = User(bale_user_id=999999)
        s.add(u); await s.flush()
        raw = await mint_login_token(s, u.id, ttl_minutes=5)
        print(f"http://localhost:8000/app/auth?t={raw}")
asyncio.run(main())
PY
```
Open the printed URL in a browser. Expected: it redeems, redirects to `/app`, and the shell renders "داشبورد" with the sidebar. Reload `/app` directly → still authenticated (cookie persists). Click "خروج" → redirected to `/app/auth` showing the error/return-to-Bale message.

Optional Playwright smoke (Playwright is available in this environment): navigate to the printed URL, assert the page reaches `/app` and the text "داشبورد" is visible.

- [ ] **Step 8: Docs + env example**

Add to `.env.example`:
```
PUBLIC_BASE_URL=
```
Add a build step to `README.md` after the landing-UI build line:
```
8b. Build user app UI: `cd app_ui && npm install && npm run build && cd ..`
```

- [ ] **Step 9: Commit**

```bash
git add app_ui src/energybot/main.py .env.example README.md
git commit -m "feat(user-web): app_ui shell, auth screen, and /app mount"
```

---

## Self-Review

**Spec coverage (Stage 1 scope only):**
- §4.1 deep-link flow → Tasks 2, 3, 4, 5. ✓
- §4.2 tables → Task 1. ✓
- §4.3 security (reuse helpers, httpOnly+CSRF, rate-limit, single-use, blocked/deleted reject) → Tasks 2 (single-use/expiry), 3 (cookie/CSRF/rate-limit/blocked). ✓
- §5 `auth/redeem`, `auth/logout`, `/me` → Task 3. ✓
- §7 frontend shell (sidebar/topbar), `/app/auth`, `/app` dashboard placeholder, static mount, env var → Task 5. ✓
- §10 build-order Stage 1 ("auth + sessions + current_user + /web bot entry + app_ui shell") → all five tasks. ✓
- Out of Stage 1 scope (deferred to later stage plans): chat/SSE (§6), bills/profile/history endpoints & screens (§5/§7), dashboard aggregate (§5). Intentionally excluded.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N". The `app_ui` dashboard page is an explicit, intentional placeholder UI for Stage 4 — labeled as such, with complete code. The `next.config`/tailwind copy steps reference adapting real `admin_ui` files (concrete), with a fallback instruction if export layout differs.

**Type consistency:** `mint_login_token(session, user_id, *, ttl_minutes)` and `redeem_login_token(session, raw_token) -> UUID | None` are used identically in Tasks 2, 3, 4. `current_user(...) -> User`, cookie name `energybot_user`, and `UserMeOut{id, display_name, language}` are consistent across Task 3 and Task 5's API client. `build_web_login_markup(url) -> dict` matches between Task 4's helper and its tests. `_REDEEM_HITS` referenced in the test fixture matches the name defined in `auth.py`.

## Notes for later stages (not part of this plan)

- Stage 2 (chat) will add the `ResponseChannel` abstraction + `/api/app/chat` SSE + history endpoints, importing `current_user` from `user_api/auth.py`.
- Stage 3 (bills/profile) and Stage 4 (dashboard) add routers under the same `/api/app` prefix and screens under `app_ui/`.
- A periodic cleanup job for expired `web_login_tokens` / `user_sessions` can be added to `jobs/` (mirrors existing `jobs/cleanup.py`); deferred until the surface is in use.
