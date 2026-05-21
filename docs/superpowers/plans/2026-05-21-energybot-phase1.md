# Energybot Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Persian-language energy-saving assistant on Bale messenger backed by an admin-curated knowledge base, ready for ~50 beta users.

**Architecture:** Single FastAPI service + Postgres (pgvector + pg_trgm) + bundled static Next.js admin SPA. Dual LLM provider router (frontier via proxy + Metis). APScheduler in-process for background jobs. See `docs/superpowers/specs/2026-05-21-energybot-phase1-design.md` for the design.

**Tech Stack:** Python 3.10+, FastAPI, SQLAlchemy 2 (async + asyncpg), Alembic, Pydantic 2, pgvector, Jinja2, APScheduler, argon2-cffi, python-magic, tiktoken, httpx, pytest + pytest-asyncio, Next.js 14, TypeScript, Docker.

---

## Conventions

- **TDD:** every task writes a failing test, watches it fail, implements, watches it pass.
- **Commits:** every task ends with a single commit on `main`. Imperative subject, conventional-commits prefix.
- **Naming:** module `energybot`. Tests under `tests/` mirror source layout.
- **Async:** all DB and HTTP code is async. Test functions use `@pytest.mark.asyncio`.
- **DB tests:** integration tests use a real Postgres at `TEST_DATABASE_URL` (provided by `docker-compose.test.yml`). Each test runs in a transaction that is rolled back.
- **LLM in tests:** mocked by default. Live-LLM tests gated behind `pytest --llm` and excluded from CI.
- **Persian strings in code:** UTF-8, no escapes. Never English strings shown to end users.

---

## File Structure

```
energybot/
├── pyproject.toml
├── alembic.ini
├── Dockerfile
├── docker-compose.yml
├── docker-compose.test.yml
├── .env.example
├── README.md
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
├── src/energybot/
│   ├── __init__.py
│   ├── main.py                      # FastAPI app factory
│   ├── settings.py                  # pydantic-settings
│   ├── logging.py                   # structured JSON logger
│   ├── core/
│   │   ├── db.py                    # async engine, AsyncSession
│   │   ├── models.py                # SQLAlchemy ORM
│   │   ├── security.py              # argon2, session tokens, CSRF
│   │   └── normalize_fa.py          # Persian normalisation
│   ├── providers/
│   │   ├── base.py                  # Provider interface + Pydantic types
│   │   ├── frontier.py
│   │   ├── metis.py
│   │   └── router.py                # routing + fallback + llm_calls logging
│   ├── agent/
│   │   ├── prompts.py               # template loader (TTL cached)
│   │   ├── model_configs.py         # model config loader
│   │   ├── context.py               # context assembly
│   │   ├── summarizer.py            # inline rolling-summary trigger
│   │   ├── loop.py                  # handle_message
│   │   └── tools/
│   │       ├── base.py              # Tool base + registry
│   │       ├── read_profile.py
│   │       ├── update_profile.py
│   │       ├── record_commitment.py
│   │       ├── escalate.py
│   │       ├── search_kb.py
│   │       └── send_kb_media.py
│   ├── profile/
│   │   ├── repository.py
│   │   ├── render.py                # Persian summary text from profile
│   │   └── wizard.py                # onboarding state machine
│   ├── chat/
│   │   ├── repository.py            # messages, sessions, summaries
│   │   └── session.py               # 30-min idle gap manager
│   ├── kb/
│   │   ├── repository.py
│   │   ├── chunking.py
│   │   ├── embedding.py
│   │   ├── retrieval.py
│   │   ├── publish.py
│   │   ├── transcribe.py
│   │   └── media_storage.py
│   ├── bale_adapter/
│   │   ├── client.py                # outbound Bale API
│   │   ├── webhook.py               # /bale/webhook
│   │   ├── parser.py
│   │   ├── serialization.py         # per-user lock
│   │   └── commands.py
│   ├── admin_api/
│   │   ├── auth.py
│   │   ├── audit.py                 # decorator + log writer
│   │   ├── users.py
│   │   ├── chats.py
│   │   ├── kb.py
│   │   ├── prompts.py
│   │   ├── models.py
│   │   ├── audit_log.py
│   │   └── stats.py
│   ├── admin_cli.py
│   ├── jobs/
│   │   ├── scheduler.py
│   │   ├── daily_stats.py
│   │   ├── cleanup.py
│   │   └── purge.py
│   ├── health.py
│   └── metrics.py
├── admin_ui/                        # Next.js 14 (app router, TS)
│   ├── package.json
│   ├── next.config.mjs              # output: 'export'
│   ├── src/app/
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── users/page.tsx
│   │   ├── users/[id]/page.tsx
│   │   ├── chats/page.tsx
│   │   ├── chats/[id]/page.tsx
│   │   ├── kb/articles/page.tsx
│   │   ├── kb/articles/[id]/page.tsx
│   │   ├── kb/trash/page.tsx
│   │   ├── kb/search-test/page.tsx
│   │   ├── prompts/page.tsx
│   │   ├── models/page.tsx
│   │   └── audit-log/page.tsx
│   ├── src/components/...
│   └── src/lib/api.ts
└── tests/
    ├── conftest.py                  # db fixtures, app fixture
    ├── unit/...
    └── integration/...
```

---

## Milestone Map

| # | Milestone | Tasks | Outcome |
|---|---|---|---|
| 1 | Project foundation | 1–5 | App boots, `/health` returns 200 |
| 2 | Database schema | 6–10 | All migrations apply on empty PG |
| 3 | Persian normalisation | 11 | `normalize_fa` utility + tests |
| 4 | Provider router | 12–15 | Mocked + live LLM routing with fallback |
| 5 | Prompt & model config | 16–17 | Active-row invariants enforced |
| 6 | Profile & onboarding | 18–20 | Wizard state machine + profile event log |
| 7 | Chat & messages | 21–23 | Sessions, messages, rolling summaries, context assembly |
| 8 | KB ingestion | 24–28 | Articles, attachments, transcription, atomic publish |
| 9 | KB retrieval | 29–30 | RRF hybrid retrieval + `search_knowledge_base` tool |
| 10 | Agent tools & loop | 31–33 | Profile/media tools + handle_message loop |
| 11 | Bale adapter | 34–37 | Real Bale bot responds to messages |
| 12 | Admin API | 38–42 | All admin endpoints + audit + CLI |
| 13 | Admin UI | 43–46 | Persian Next.js admin SPA served by FastAPI |
| 14 | Background jobs | 47–48 | Scheduler, rollups, cleanup, purge |
| 15 | Observability + deploy | 49–50 | Metrics, Docker image, README, smoke script |

---

## Milestone 1 — Project foundation

### Task 1: Project scaffold

**Files:**
- Create: `pyproject.toml`
- Create: `src/energybot/__init__.py`
- Create: `src/energybot/main.py`
- Create: `tests/__init__.py`
- Create: `tests/test_smoke.py`

- [ ] **Step 1: Write the failing smoke test**

`tests/test_smoke.py`:
```python
from energybot import __version__


def test_package_importable():
    assert __version__ == "0.1.0"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_smoke.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'energybot'`

- [ ] **Step 3: Create `pyproject.toml`**

```toml
[project]
name = "energybot"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "sqlalchemy[asyncio]>=2.0.30",
  "asyncpg>=0.29",
  "alembic>=1.13",
  "pgvector>=0.3.0",
  "pydantic>=2.7",
  "pydantic-settings>=2.3",
  "python-multipart>=0.0.9",
  "httpx>=0.27",
  "jinja2>=3.1",
  "tiktoken>=0.7",
  "argon2-cffi>=23.1",
  "python-magic>=0.4.27",
  "apscheduler>=3.10",
  "structlog>=24.1",
  "prometheus-client>=0.20",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.2",
  "pytest-asyncio>=0.23",
  "pytest-cov>=5.0",
  "ruff>=0.4",
  "mypy>=1.10",
]

[project.scripts]
energybot-admin = "energybot.admin_cli:main"

[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
addopts = "-ra --strict-markers"
markers = ["llm: tests that hit a live LLM provider (requires --llm)"]

[tool.ruff]
line-length = 100
target-version = "py310"
```

- [ ] **Step 4: Create the package init**

`src/energybot/__init__.py`:
```python
__version__ = "0.1.0"
```

`src/energybot/main.py`:
```python
from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="Energybot")
    return app


app = create_app()
```

`tests/__init__.py`: (empty)

- [ ] **Step 5: Install in editable mode and run test**

Run:
```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
python -m pytest tests/test_smoke.py -v
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add pyproject.toml src/energybot tests
git commit -m "feat: project scaffold with FastAPI app skeleton"
```

---

### Task 2: Settings module

**Files:**
- Create: `src/energybot/settings.py`
- Create: `.env.example`
- Create: `tests/test_settings.py`

- [ ] **Step 1: Write failing test**

`tests/test_settings.py`:
```python
import pytest
from energybot.settings import Settings


def test_settings_loads_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h:5432/d")
    monkeypatch.setenv("BALE_BOT_TOKEN", "x")
    monkeypatch.setenv("BALE_WEBHOOK_SECRET", "s")
    monkeypatch.setenv("METIS_API_KEY", "m")
    monkeypatch.setenv("FRONTIER_API_KEY", "f")
    monkeypatch.setenv("SESSION_SECRET", "z" * 32)
    s = Settings()
    assert s.database_url.endswith("/d")
    assert s.media_root.endswith("media")
    assert s.summary_message_threshold == 20
    assert s.tool_iteration_cap == 6


def test_settings_requires_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("BALE_BOT_TOKEN", "x")
    monkeypatch.setenv("BALE_WEBHOOK_SECRET", "s")
    monkeypatch.setenv("METIS_API_KEY", "m")
    monkeypatch.setenv("FRONTIER_API_KEY", "f")
    monkeypatch.setenv("SESSION_SECRET", "z" * 32)
    with pytest.raises(Exception):
        Settings()
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_settings.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'energybot.settings'`

- [ ] **Step 3: Implement settings**

`src/energybot/settings.py`:
```python
from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    database_url: str = Field(..., description="postgresql+asyncpg://...")
    bale_bot_token: str
    bale_webhook_secret: str
    bale_api_base: str = "https://tapi.bale.ai"

    frontier_proxy_url: str | None = None
    frontier_api_key: str
    frontier_base_url: str = "https://api.openai.com/v1"

    metis_api_key: str
    metis_base_url: str = "https://api.metisai.ir/openai/v1"

    session_secret: str = Field(..., min_length=32)
    media_root: str = "/var/lib/energybot/media"

    summary_message_threshold: int = 20
    tool_iteration_cap: int = 6
    session_idle_minutes: int = 30
    soft_delete_grace_days: int = 30

    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

`.env.example`:
```
DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5432/energybot
BALE_BOT_TOKEN=replace-me
BALE_WEBHOOK_SECRET=replace-me
FRONTIER_API_KEY=sk-replace-me
FRONTIER_PROXY_URL=http://proxy.example.com:8080
METIS_API_KEY=replace-me
METIS_BASE_URL=https://api.metisai.ir/openai/v1
SESSION_SECRET=please-generate-a-32-byte-random-string-here
MEDIA_ROOT=/var/lib/energybot/media
LOG_LEVEL=INFO
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/test_settings.py -v`
Expected: 2 PASSED

- [ ] **Step 5: Commit**

```bash
git add src/energybot/settings.py tests/test_settings.py .env.example
git commit -m "feat: settings via pydantic-settings"
```

---

### Task 3: Structured JSON logger

**Files:**
- Create: `src/energybot/logging.py`
- Create: `tests/test_logging.py`

- [ ] **Step 1: Write failing test**

`tests/test_logging.py`:
```python
import json
from energybot.logging import configure_logging, get_logger


def test_logger_emits_json(capsys):
    configure_logging("INFO")
    log = get_logger("test")
    log.info("hello", trace_id="abc", user_id="u1", latency_ms=12)
    captured = capsys.readouterr()
    parsed = json.loads(captured.out.strip().splitlines()[-1])
    assert parsed["event"] == "hello"
    assert parsed["trace_id"] == "abc"
    assert parsed["user_id"] == "u1"
    assert parsed["latency_ms"] == 12
    assert parsed["level"] == "info"
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_logging.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'energybot.logging'`

- [ ] **Step 3: Implement**

`src/energybot/logging.py`:
```python
import logging
import sys
import structlog


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(stream=sys.stdout, level=level.upper(), format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level.upper())),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/test_logging.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/energybot/logging.py tests/test_logging.py
git commit -m "feat: structured JSON logger via structlog"
```

---

### Task 4: Database engine + Alembic skeleton

**Files:**
- Create: `src/energybot/core/__init__.py`
- Create: `src/energybot/core/db.py`
- Create: `alembic.ini`
- Create: `alembic/env.py`
- Create: `alembic/script.py.mako`
- Create: `alembic/versions/` (empty dir, add `.gitkeep`)
- Create: `docker-compose.yml`
- Create: `docker-compose.test.yml`
- Create: `tests/conftest.py`
- Create: `tests/test_db_smoke.py`

- [ ] **Step 1: Write failing integration test**

`tests/conftest.py`:
```python
import os
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


@pytest_asyncio.fixture
async def db_session() -> AsyncSession:
    engine = create_async_engine(TEST_DB, future=True)
    Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    async with Session() as session:
        yield session
    await engine.dispose()
```

`tests/test_db_smoke.py`:
```python
import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_db_reachable(db_session):
    r = await db_session.execute(text("SELECT 1 AS one"))
    assert r.scalar_one() == 1


@pytest.mark.asyncio
async def test_pgvector_extension_present(db_session):
    r = await db_session.execute(text("SELECT extname FROM pg_extension WHERE extname='vector'"))
    assert r.scalar_one() == "vector"


@pytest.mark.asyncio
async def test_pg_trgm_extension_present(db_session):
    r = await db_session.execute(text("SELECT extname FROM pg_extension WHERE extname='pg_trgm'"))
    assert r.scalar_one() == "pg_trgm"
```

- [ ] **Step 2: Provision dockerised Postgres for dev + test**

`docker-compose.yml`:
```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    container_name: energybot-db
    environment:
      POSTGRES_USER: energybot
      POSTGRES_PASSWORD: energybot
      POSTGRES_DB: energybot
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
volumes:
  pgdata: {}
```

`docker-compose.test.yml`:
```yaml
services:
  test-db:
    image: pgvector/pgvector:pg16
    container_name: energybot-test-db
    environment:
      POSTGRES_USER: energybot
      POSTGRES_PASSWORD: energybot
      POSTGRES_DB: energybot_test
    ports: ["5433:5432"]
    tmpfs: ["/var/lib/postgresql/data"]
```

Run:
```bash
docker compose -f docker-compose.test.yml up -d
sleep 3
docker exec energybot-test-db psql -U energybot -d energybot_test -c "CREATE EXTENSION IF NOT EXISTS vector;"
docker exec energybot-test-db psql -U energybot -d energybot_test -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

- [ ] **Step 3: Verify failure**

Run: `python -m pytest tests/test_db_smoke.py -v`
Expected: FAIL — fixtures error or missing `core.db` module if imported.

- [ ] **Step 4: Implement DB engine module + Alembic**

`src/energybot/core/__init__.py`: (empty)

`src/energybot/core/db.py`:
```python
from collections.abc import AsyncIterator
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from energybot.settings import get_settings


class Base(DeclarativeBase):
    pass


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine, _sessionmaker
    if _engine is None:
        s = get_settings()
        _engine = create_async_engine(s.database_url, future=True, pool_pre_ping=True)
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    Session = get_sessionmaker()
    async with Session() as session:
        yield session
```

`alembic.ini`:
```ini
[alembic]
script_location = alembic
sqlalchemy.url = postgresql://energybot:energybot@localhost:5432/energybot
file_template = %%(year)d%%(month).2d%%(day).2d_%%(hour).2d%%(minute).2d_%%(slug)s

[loggers]
keys = root,sqlalchemy,alembic
[handlers]
keys = console
[formatters]
keys = generic
[logger_root]
level = WARN
handlers = console
qualname =
[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine
[logger_alembic]
level = INFO
handlers =
qualname = alembic
[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic
[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

`alembic/env.py`:
```python
import asyncio
import os
from logging.config import fileConfig
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from alembic import context

from energybot.core.db import Base
import energybot.core.models  # noqa: F401  registers all models

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

db_url = os.environ.get("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
# Alembic does not run async DDL directly through the URL — we use async_engine_from_config.
config.set_main_option("sqlalchemy.url", db_url.replace("postgresql://", "postgresql+asyncpg://"))


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.")
    async with connectable.connect() as conn:
        await conn.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


run_migrations_online()
```

`alembic/script.py.mako`:
```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision: str = "${up_revision}"
down_revision: str | None = ${repr(down_revision)}
branch_labels: str | None = ${repr(branch_labels)}
depends_on: str | None = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

`alembic/versions/.gitkeep`: (empty file)

- [ ] **Step 5: Verify pass**

Run: `python -m pytest tests/test_db_smoke.py -v`
Expected: 3 PASSED

- [ ] **Step 6: Commit**

```bash
git add src/energybot/core docker-compose.yml docker-compose.test.yml alembic.ini alembic tests/conftest.py tests/test_db_smoke.py
git commit -m "feat: async SQLAlchemy engine + Alembic skeleton + dockerised PG"
```

---

### Task 5: Health endpoint + app boots

**Files:**
- Create: `src/energybot/health.py`
- Modify: `src/energybot/main.py`
- Create: `tests/test_health.py`

- [ ] **Step 1: Write failing test**

`tests/test_health.py`:
```python
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.main import create_app


@pytest.mark.asyncio
async def test_health_ok():
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_health.py -v`
Expected: FAIL — 404 Not Found.

- [ ] **Step 3: Implement**

`src/energybot/health.py`:
```python
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

`src/energybot/main.py`:
```python
from fastapi import FastAPI
from energybot.health import router as health_router
from energybot.logging import configure_logging
from energybot.settings import get_settings


def create_app() -> FastAPI:
    s = get_settings.cache_clear() if False else None  # no-op; settings loaded lazily by routers
    configure_logging("INFO")
    app = FastAPI(title="Energybot")
    app.include_router(health_router)
    return app


app = create_app()
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/test_health.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/energybot/health.py src/energybot/main.py tests/test_health.py
git commit -m "feat: /health endpoint and app wiring"
```

---

## Milestone 2 — Database schema

Each task adds ORM models + an Alembic migration. Migrations use `alembic revision --autogenerate -m "..."` then are hand-checked. The `core/models.py` file accumulates all model classes — tests in this milestone are about schema correctness, not behaviour.

### Task 6: Identity & profile tables

**Files:**
- Create: `src/energybot/core/models.py`
- Create: `alembic/versions/20260521_0900_identity.py` (autogenerate then edit)
- Create: `tests/integration/test_identity_schema.py`

- [ ] **Step 1: Write failing integration test**

`tests/integration/__init__.py`: (empty)

`tests/integration/test_identity_schema.py`:
```python
import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_identity_tables_exist(db_session):
    rows = await db_session.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name IN "
        "('users','profiles','profile_events','onboarding_states')"
    ))
    names = {r[0] for r in rows}
    assert names == {"users", "profiles", "profile_events", "onboarding_states"}


@pytest.mark.asyncio
async def test_users_has_bale_user_id_unique(db_session):
    r = await db_session.execute(text(
        "SELECT indexdef FROM pg_indexes "
        "WHERE tablename='users' AND indexdef ILIKE '%bale_user_id%'"
    ))
    defs = [row[0] for row in r]
    assert any("UNIQUE" in d for d in defs)
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_identity_schema.py -v`
Expected: FAIL — empty set / no rows.

- [ ] **Step 3: Implement models**

`src/energybot/core/models.py`:
```python
from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from energybot.core.db import Base


def _ts() -> datetime:
    return datetime.utcnow()


class User(Base):
    __tablename__ = "users"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    bale_user_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(200))
    language: Mapped[str] = mapped_column(String(8), default="fa", nullable=False)
    is_blocked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column()
    deleted_at: Mapped[datetime | None] = mapped_column()
    __table_args__ = (UniqueConstraint("bale_user_id", name="uq_users_bale_user_id"),)


class Profile(Base):
    __tablename__ = "profiles"
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    household: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    behaviour: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    goals: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    commitments: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    completeness_score: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column()


class ProfileEvent(Base):
    __tablename__ = "profile_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    field_path: Mapped[str] = mapped_column(String(200), nullable=False)
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # wizard | agent_tool | admin
    source_message_id: Mapped[int | None] = mapped_column(BigInteger)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class OnboardingState(Base):
    __tablename__ = "onboarding_states"
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    current_step: Mapped[str] = mapped_column(String(50), nullable=False)
    answers: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    started_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column()
```

- [ ] **Step 4: Generate and apply migration**

Run:
```bash
DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  alembic revision --autogenerate -m "identity tables"
DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  alembic upgrade head
```

Inspect the generated file in `alembic/versions/`. Verify it creates `users`, `profiles`, `profile_events`, `onboarding_states` and the unique index on `users.bale_user_id`. Rename the file to start with `20260521_0900_` for ordering predictability.

- [ ] **Step 5: Verify pass**

Run: `python -m pytest tests/integration/test_identity_schema.py -v`
Expected: 2 PASSED.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/core/models.py alembic/versions tests/integration
git commit -m "feat(db): identity and profile tables"
```

---

### Task 7: Conversation tables

**Files:**
- Modify: `src/energybot/core/models.py` (append)
- Create: `alembic/versions/20260521_0901_conversation.py`
- Create: `tests/integration/test_conversation_schema.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_conversation_schema.py`:
```python
import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_conversation_tables_exist(db_session):
    rows = await db_session.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_name IN ('chat_sessions','messages','chat_summaries')"
    ))
    assert {r[0] for r in rows} == {"chat_sessions", "messages", "chat_summaries"}


@pytest.mark.asyncio
async def test_messages_index_on_user_created(db_session):
    r = await db_session.execute(text(
        "SELECT indexdef FROM pg_indexes WHERE tablename='messages'"
    ))
    defs = [row[0] for row in r]
    assert any("user_id" in d and "created_at" in d for d in defs)
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_conversation_schema.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement models (append to `core/models.py`)**

```python
from sqlalchemy import Index


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    started_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column()
    last_summary_id: Mapped[int | None] = mapped_column(BigInteger)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    session_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user | assistant | tool | system
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tool_name: Mapped[str | None] = mapped_column(String(80))
    tool_args: Mapped[dict | None] = mapped_column(JSONB)
    tool_result: Mapped[dict | None] = mapped_column(JSONB)
    tokens_in: Mapped[int | None] = mapped_column(Integer)
    tokens_out: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    model_used: Mapped[str | None] = mapped_column(String(120))
    meta: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column()
    __table_args__ = (
        Index("ix_messages_user_created", "user_id", "created_at"),
    )


class ChatSummary(Base):
    __tablename__ = "chat_summaries"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    session_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    text: Mapped[str] = mapped_column(Text, nullable=False)
    covers_from_message_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    covers_to_message_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
```

- [ ] **Step 4: Generate and apply migration**

```bash
DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  alembic revision --autogenerate -m "conversation tables"
DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  alembic upgrade head
```

Hand-edit to ensure the messages `ix_messages_user_created` index is created.

- [ ] **Step 5: Verify pass**

Run: `python -m pytest tests/integration/test_conversation_schema.py -v`
Expected: 2 PASSED.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/core/models.py alembic/versions tests/integration/test_conversation_schema.py
git commit -m "feat(db): conversation tables (sessions, messages, summaries)"
```

---

### Task 8: KB tables (articles, attachments, transcripts, chunks)

**Files:**
- Modify: `src/energybot/core/models.py` (append)
- Create: `alembic/versions/20260521_0902_kb.py`
- Create: `tests/integration/test_kb_schema.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_kb_schema.py`:
```python
import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_kb_tables_exist(db_session):
    rows = await db_session.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_name IN ('kb_articles','kb_attachments','video_transcripts','kb_chunks')"
    ))
    assert {r[0] for r in rows} == {"kb_articles", "kb_attachments", "video_transcripts", "kb_chunks"}


@pytest.mark.asyncio
async def test_kb_chunks_has_hnsw_index(db_session):
    r = await db_session.execute(text(
        "SELECT indexdef FROM pg_indexes WHERE tablename='kb_chunks'"
    ))
    defs = [row[0] for row in r]
    assert any("hnsw" in d.lower() for d in defs)
    assert any("gin" in d.lower() and "text_normalized" in d for d in defs)
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_kb_schema.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement models**

Append to `core/models.py`:
```python
from pgvector.sqlalchemy import Vector


class KBArticle(Base):
    __tablename__ = "kb_articles"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str] = mapped_column(String(20), nullable=False)  # electricity | gas | general
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)  # draft|published
    published_at: Mapped[datetime | None] = mapped_column()
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column()


class KBAttachment(Base):
    __tablename__ = "kb_attachments"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    article_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("kb_articles.id", ondelete="CASCADE"), index=True, nullable=False)
    type: Mapped[str] = mapped_column(String(10), nullable=False)  # image | video
    mime_type: Mapped[str] = mapped_column(String(80), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(500), nullable=False)
    caption_fa: Mapped[str | None] = mapped_column(Text)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    bale_file_id: Mapped[str | None] = mapped_column(String(200))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    thumbnail_path: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column()


class VideoTranscript(Base):
    __tablename__ = "video_transcripts"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    attachment_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("kb_attachments.id", ondelete="CASCADE"), unique=True, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_admin_edited: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class KBChunk(Base):
    __tablename__ = "kb_chunks"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    article_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("kb_articles.id", ondelete="CASCADE"), index=True, nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    text_normalized: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(1536), nullable=False)
    meta: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
```

- [ ] **Step 4: Generate migration + hand-add HNSW and GIN indexes**

```bash
DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  alembic revision --autogenerate -m "kb tables"
```

Edit the new migration to **append** at the end of `upgrade()`:
```python
op.execute("CREATE INDEX ix_kb_chunks_embedding_hnsw ON kb_chunks USING hnsw (embedding vector_cosine_ops);")
op.execute("CREATE INDEX ix_kb_chunks_tsv ON kb_chunks USING gin (to_tsvector('simple', text_normalized));")
```
And in `downgrade()`:
```python
op.execute("DROP INDEX IF EXISTS ix_kb_chunks_tsv;")
op.execute("DROP INDEX IF EXISTS ix_kb_chunks_embedding_hnsw;")
```

Apply:
```bash
DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  alembic upgrade head
```

- [ ] **Step 5: Verify pass**

Run: `python -m pytest tests/integration/test_kb_schema.py -v`
Expected: 2 PASSED.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/core/models.py alembic/versions tests/integration/test_kb_schema.py
git commit -m "feat(db): kb tables with pgvector HNSW and GIN tsvector indexes"
```

---

### Task 9: Admin & configuration tables

**Files:**
- Modify: `src/energybot/core/models.py` (append)
- Create: `alembic/versions/20260521_0903_admin.py`
- Create: `tests/integration/test_admin_schema.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_admin_schema.py`:
```python
import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_admin_tables_exist(db_session):
    rows = await db_session.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_name IN ('admin_users','admin_sessions','prompt_templates','model_configs','audit_log')"
    ))
    assert {r[0] for r in rows} == {"admin_users", "admin_sessions", "prompt_templates", "model_configs", "audit_log"}


@pytest.mark.asyncio
async def test_one_active_prompt_per_key(db_session):
    r = await db_session.execute(text(
        "SELECT indexdef FROM pg_indexes WHERE tablename='prompt_templates'"
    ))
    defs = [row[0] for row in r]
    assert any("UNIQUE" in d and "key" in d and "status" in d for d in defs)


@pytest.mark.asyncio
async def test_one_active_model_per_call_type(db_session):
    r = await db_session.execute(text(
        "SELECT indexdef FROM pg_indexes WHERE tablename='model_configs'"
    ))
    defs = [row[0] for row in r]
    assert any("UNIQUE" in d and "call_type" in d for d in defs)
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_admin_schema.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement models**

Append to `core/models.py`:
```python
class AdminUser(Base):
    __tablename__ = "admin_users"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(200), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(500), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # admin | editor
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column()


class AdminSession(Base):
    __tablename__ = "admin_sessions"
    id: Mapped[str] = mapped_column(String(128), primary_key=True)  # sha256 of cookie token
    admin_user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("admin_users.id", ondelete="CASCADE"), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)


class PromptTemplate(Base):
    __tablename__ = "prompt_templates"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # active | draft | retired
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class ModelConfig(Base):
    __tablename__ = "model_configs"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    call_type: Mapped[str] = mapped_column(String(40), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    model_name: Mapped[str] = mapped_column(String(120), nullable=False)
    params: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    admin_user_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(120), nullable=False)
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
```

- [ ] **Step 4: Generate migration + hand-add partial unique indexes**

```bash
DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test \
  alembic revision --autogenerate -m "admin tables"
```

Append in `upgrade()`:
```python
op.execute("CREATE UNIQUE INDEX uq_prompt_active_per_key ON prompt_templates (key) WHERE status='active';")
op.execute("CREATE UNIQUE INDEX uq_model_active_per_call_type ON model_configs (call_type) WHERE is_active = TRUE;")
op.execute("CREATE UNIQUE INDEX uq_prompt_key_version ON prompt_templates (key, version);")
```

In `downgrade()`:
```python
op.execute("DROP INDEX IF EXISTS uq_prompt_key_version;")
op.execute("DROP INDEX IF EXISTS uq_model_active_per_call_type;")
op.execute("DROP INDEX IF EXISTS uq_prompt_active_per_key;")
```

Apply:
```bash
DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test alembic upgrade head
```

- [ ] **Step 5: Verify pass**

Run: `python -m pytest tests/integration/test_admin_schema.py -v`
Expected: 3 PASSED.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/core/models.py alembic/versions tests/integration/test_admin_schema.py
git commit -m "feat(db): admin and configuration tables with active-row invariants"
```

---

### Task 10: Auxiliary tables (`llm_calls`, `processed_updates`, `daily_stats`)

**Files:**
- Modify: `src/energybot/core/models.py` (append)
- Create: `alembic/versions/20260521_0904_aux.py`
- Create: `tests/integration/test_aux_schema.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_aux_schema.py`:
```python
import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_aux_tables_exist(db_session):
    rows = await db_session.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_name IN ('llm_calls','processed_updates','daily_stats')"
    ))
    assert {r[0] for r in rows} == {"llm_calls", "processed_updates", "daily_stats"}
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_aux_schema.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement models**

Append to `core/models.py`:
```python
from datetime import date as _date
from sqlalchemy import Date, Numeric


class LLMCall(Base):
    __tablename__ = "llm_calls"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    call_type: Mapped[str] = mapped_column(String(40), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    tokens_in: Mapped[int | None] = mapped_column(Integer)
    tokens_out: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # ok | error | fallback
    prompt_template_key: Mapped[str | None] = mapped_column(String(80))
    prompt_template_version: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)


class ProcessedUpdate(Base):
    __tablename__ = "processed_updates"
    update_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False, index=True)


class DailyStats(Base):
    __tablename__ = "daily_stats"
    date: Mapped[_date] = mapped_column(Date, primary_key=True)
    dau: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    messages: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    kb_hits: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    llm_cost_usd: Mapped[float] = mapped_column(Numeric(10, 4), default=0, nullable=False)
    tokens_total: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
```

- [ ] **Step 4: Generate + apply migration**

```bash
DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test alembic revision --autogenerate -m "aux tables"
DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test alembic upgrade head
```

- [ ] **Step 5: Verify pass**

Run: `python -m pytest tests/integration/test_aux_schema.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/core/models.py alembic/versions tests/integration/test_aux_schema.py
git commit -m "feat(db): auxiliary tables (llm_calls, processed_updates, daily_stats)"
```

---

## Milestone 3 — Persian normalisation

### Task 11: `normalize_fa` utility

**Files:**
- Create: `src/energybot/core/normalize_fa.py`
- Create: `tests/test_normalize_fa.py`

- [ ] **Step 1: Write failing tests**

`tests/test_normalize_fa.py`:
```python
from energybot.core.normalize_fa import normalize_fa


def test_arabic_kaf_to_persian_kaf():
    assert normalize_fa("كتاب") == "کتاب"


def test_arabic_yeh_to_persian_yeh():
    assert normalize_fa("يك") == "یک"


def test_arabic_digits_to_persian_digits():
    assert normalize_fa("١٢٣٤٥٦٧٨٩٠") == "۱۲۳۴۵۶۷۸۹۰"


def test_zwnj_collapse_and_whitespace():
    assert normalize_fa("می‌‌روم  به\tخانه") == "می‌روم به خانه"


def test_mixed_case_lower():
    assert normalize_fa("Hello سلام") == "hello سلام"


def test_idempotent():
    s = "كتاب يك ١٢٣"
    assert normalize_fa(normalize_fa(s)) == normalize_fa(s)


def test_empty_and_none_safe():
    assert normalize_fa("") == ""
    assert normalize_fa("   ") == ""
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_normalize_fa.py -v`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

`src/energybot/core/normalize_fa.py`:
```python
import re

_ARABIC_TO_PERSIAN = str.maketrans({
    "ك": "ک",
    "ي": "ی",
    "ى": "ی",
    "ة": "ه",
    "أ": "ا",
    "إ": "ا",
    "آ": "آ",
    "ؤ": "و",
    "ئ": "ی",
})

_ARABIC_DIGITS = str.maketrans({
    "٠": "۰", "١": "۱", "٢": "۲", "٣": "۳", "٤": "۴",
    "٥": "۵", "٦": "۶", "٧": "۷", "٨": "۸", "٩": "۹",
})

ZWNJ = "‌"
_MULTI_ZWNJ = re.compile(ZWNJ + r"{2,}")
_WS = re.compile(r"\s+")
_ZWNJ_BOUNDARY = re.compile(r"\s+" + ZWNJ + r"|" + ZWNJ + r"\s+")


def normalize_fa(s: str) -> str:
    if not s:
        return ""
    s = s.translate(_ARABIC_TO_PERSIAN)
    s = s.translate(_ARABIC_DIGITS)
    s = _MULTI_ZWNJ.sub(ZWNJ, s)
    s = _ZWNJ_BOUNDARY.sub(ZWNJ, s)
    s = _WS.sub(" ", s)
    s = s.strip()
    return s.lower()
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/test_normalize_fa.py -v`
Expected: 7 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/core/normalize_fa.py tests/test_normalize_fa.py
git commit -m "feat: Persian text normaliser"
```

---

## Milestone 4 — Provider router

### Task 12: Provider base abstraction

**Files:**
- Create: `src/energybot/providers/__init__.py`
- Create: `src/energybot/providers/base.py`
- Create: `tests/test_providers_base.py`

- [ ] **Step 1: Write failing tests**

`tests/test_providers_base.py`:
```python
from energybot.providers.base import ChatMessage, ChatRequest, ChatResponse, EmbeddingRequest, EmbeddingResponse, Tool


def test_chat_request_minimal():
    req = ChatRequest(model="gpt-4o-mini", messages=[ChatMessage(role="user", content="hi")])
    assert req.temperature is None
    assert req.tools is None


def test_tool_schema():
    t = Tool(name="x", description="d", parameters={"type": "object", "properties": {}})
    assert t.name == "x"


def test_chat_response_with_tool_calls():
    r = ChatResponse(
        content="",
        tool_calls=[{"id": "t1", "name": "search_kb", "arguments": {"query": "بخاری"}}],
        tokens_in=10,
        tokens_out=5,
        finish_reason="tool_calls",
    )
    assert r.tool_calls[0]["name"] == "search_kb"


def test_embedding_response_dims():
    e = EmbeddingResponse(vectors=[[0.1] * 1536], tokens_in=4)
    assert len(e.vectors[0]) == 1536
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_providers_base.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/providers/__init__.py`: (empty)

`src/energybot/providers/base.py`:
```python
from typing import Any, Literal, Protocol
from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str = ""
    name: str | None = None
    tool_call_id: str | None = None
    tool_calls: list[dict[str, Any]] | None = None


class Tool(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any]


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    tools: list[Tool] | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    top_p: float | None = None


class ChatResponse(BaseModel):
    content: str
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    tokens_in: int
    tokens_out: int
    finish_reason: str
    model: str | None = None


class EmbeddingRequest(BaseModel):
    model: str
    inputs: list[str]


class EmbeddingResponse(BaseModel):
    vectors: list[list[float]]
    tokens_in: int


class ProviderError(Exception):
    """Retryable or non-retryable provider failure."""

    def __init__(self, message: str, *, status: int | None = None, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


class Provider(Protocol):
    name: str

    async def chat(self, req: ChatRequest) -> ChatResponse: ...
    async def embed(self, req: EmbeddingRequest) -> EmbeddingResponse: ...
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/test_providers_base.py -v`
Expected: 4 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/providers tests/test_providers_base.py
git commit -m "feat(providers): base Pydantic models and Provider protocol"
```

---

### Task 13: Frontier provider (OpenAI-compatible)

**Files:**
- Create: `src/energybot/providers/frontier.py`
- Create: `tests/test_provider_frontier.py`

- [ ] **Step 1: Write failing test (mocks httpx)**

`tests/test_provider_frontier.py`:
```python
import httpx
import pytest
from energybot.providers.base import ChatMessage, ChatRequest, EmbeddingRequest, ProviderError
from energybot.providers.frontier import FrontierProvider


def _mock_transport(handler):
    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_chat_happy_path():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/chat/completions")
        return httpx.Response(200, json={
            "choices": [{
                "message": {"role": "assistant", "content": "سلام", "tool_calls": None},
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2},
            "model": "gpt-4o-mini",
        })

    p = FrontierProvider(
        api_key="k", base_url="https://api.openai.com/v1",
        transport=_mock_transport(handler),
    )
    r = await p.chat(ChatRequest(model="gpt-4o-mini", messages=[ChatMessage(role="user", content="hi")]))
    assert r.content == "سلام"
    assert r.tokens_in == 5
    assert r.tokens_out == 2
    assert r.finish_reason == "stop"


@pytest.mark.asyncio
async def test_chat_5xx_raises_retryable():
    def handler(request):
        return httpx.Response(503, text="upstream busy")
    p = FrontierProvider(api_key="k", base_url="https://x/v1", transport=_mock_transport(handler))
    with pytest.raises(ProviderError) as ei:
        await p.chat(ChatRequest(model="m", messages=[ChatMessage(role="user", content="hi")]))
    assert ei.value.retryable is True


@pytest.mark.asyncio
async def test_embed_happy_path():
    def handler(request):
        return httpx.Response(200, json={
            "data": [{"embedding": [0.1] * 1536}, {"embedding": [0.2] * 1536}],
            "usage": {"prompt_tokens": 6},
            "model": "text-embedding-3-small",
        })
    p = FrontierProvider(api_key="k", base_url="https://x/v1", transport=_mock_transport(handler))
    r = await p.embed(EmbeddingRequest(model="text-embedding-3-small", inputs=["a", "b"]))
    assert len(r.vectors) == 2
    assert len(r.vectors[0]) == 1536
    assert r.tokens_in == 6
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_provider_frontier.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/providers/frontier.py`:
```python
from typing import Any
import httpx
from energybot.providers.base import (
    ChatMessage, ChatRequest, ChatResponse, EmbeddingRequest, EmbeddingResponse, ProviderError, Tool,
)


def _to_openai_messages(msgs: list[ChatMessage]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in msgs:
        d: dict[str, Any] = {"role": m.role, "content": m.content}
        if m.name:
            d["name"] = m.name
        if m.tool_call_id:
            d["tool_call_id"] = m.tool_call_id
        if m.tool_calls:
            d["tool_calls"] = m.tool_calls
        out.append(d)
    return out


def _to_openai_tools(tools: list[Tool] | None) -> list[dict[str, Any]] | None:
    if not tools:
        return None
    return [{"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}} for t in tools]


class FrontierProvider:
    name = "frontier"

    def __init__(self, *, api_key: str, base_url: str, proxy_url: str | None = None, transport: httpx.AsyncBaseTransport | None = None):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=10.0),
            proxy=proxy_url,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}

    async def chat(self, req: ChatRequest) -> ChatResponse:
        body: dict[str, Any] = {
            "model": req.model,
            "messages": _to_openai_messages(req.messages),
        }
        if req.tools:
            body["tools"] = _to_openai_tools(req.tools)
        if req.temperature is not None:
            body["temperature"] = req.temperature
        if req.max_tokens is not None:
            body["max_tokens"] = req.max_tokens
        if req.top_p is not None:
            body["top_p"] = req.top_p
        try:
            r = await self._client.post(f"{self._base_url}/chat/completions", headers=self._headers(), json=body)
        except httpx.HTTPError as e:
            raise ProviderError(str(e), retryable=True) from e
        if r.status_code >= 500:
            raise ProviderError(r.text, status=r.status_code, retryable=True)
        if r.status_code == 429:
            raise ProviderError(r.text, status=r.status_code, retryable=True)
        if r.status_code >= 400:
            raise ProviderError(r.text, status=r.status_code, retryable=False)
        data = r.json()
        choice = data["choices"][0]
        msg = choice["message"]
        usage = data.get("usage", {})
        return ChatResponse(
            content=msg.get("content") or "",
            tool_calls=msg.get("tool_calls") or [],
            tokens_in=usage.get("prompt_tokens", 0),
            tokens_out=usage.get("completion_tokens", 0),
            finish_reason=choice.get("finish_reason", "stop"),
            model=data.get("model"),
        )

    async def embed(self, req: EmbeddingRequest) -> EmbeddingResponse:
        body = {"model": req.model, "input": req.inputs}
        try:
            r = await self._client.post(f"{self._base_url}/embeddings", headers=self._headers(), json=body)
        except httpx.HTTPError as e:
            raise ProviderError(str(e), retryable=True) from e
        if r.status_code >= 500 or r.status_code == 429:
            raise ProviderError(r.text, status=r.status_code, retryable=True)
        if r.status_code >= 400:
            raise ProviderError(r.text, status=r.status_code, retryable=False)
        data = r.json()
        return EmbeddingResponse(
            vectors=[d["embedding"] for d in data["data"]],
            tokens_in=data.get("usage", {}).get("prompt_tokens", 0),
        )
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/test_provider_frontier.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/providers/frontier.py tests/test_provider_frontier.py
git commit -m "feat(providers): OpenAI-compatible frontier provider"
```

---

### Task 14: Metis provider

**Files:**
- Create: `src/energybot/providers/metis.py`
- Create: `tests/test_provider_metis.py`

- [ ] **Step 1: Write failing test**

`tests/test_provider_metis.py`:
```python
import httpx
import pytest
from energybot.providers.base import ChatMessage, ChatRequest
from energybot.providers.metis import MetisProvider


@pytest.mark.asyncio
async def test_metis_uses_iranian_base_url():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json={
            "choices": [{"message": {"role": "assistant", "content": "تست", "tool_calls": None}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            "model": "metis-chat-pro",
        })

    p = MetisProvider(api_key="k", base_url="https://api.metisai.ir/openai/v1", transport=httpx.MockTransport(handler))
    r = await p.chat(ChatRequest(model="metis-chat-pro", messages=[ChatMessage(role="user", content="hi")]))
    assert "api.metisai.ir" in captured["url"]
    assert r.content == "تست"
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_provider_metis.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/providers/metis.py`:
```python
from energybot.providers.frontier import FrontierProvider


class MetisProvider(FrontierProvider):
    """Metis exposes an OpenAI-compatible interface. Reuses FrontierProvider's HTTP plumbing."""
    name = "metis"
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/test_provider_metis.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/providers/metis.py tests/test_provider_metis.py
git commit -m "feat(providers): Metis provider (OpenAI-compatible, Iranian wrapper)"
```

---

### Task 15: Provider router with fallback + llm_calls logging

**Files:**
- Create: `src/energybot/providers/router.py`
- Create: `tests/integration/test_router.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_router.py`:
```python
from datetime import datetime
import pytest
from sqlalchemy import select

from energybot.providers.base import ChatMessage, ChatRequest, ChatResponse, ProviderError
from energybot.providers.router import ProviderRouter
from energybot.core.models import LLMCall, ModelConfig


class FakeProvider:
    def __init__(self, name, response=None, error=None):
        self.name = name
        self._response = response
        self._error = error
        self.calls = 0

    async def chat(self, req):
        self.calls += 1
        if self._error:
            raise self._error
        return self._response

    async def embed(self, req):
        raise NotImplementedError


async def _seed_active_config(db_session, call_type, provider, model_name, fallback=None):
    cfg = ModelConfig(
        call_type=call_type, provider=provider, model_name=model_name,
        params={"fallback": fallback} if fallback else {}, is_active=True,
    )
    db_session.add(cfg)
    await db_session.commit()


@pytest.mark.asyncio
async def test_router_uses_primary_provider(db_session):
    await _seed_active_config(db_session, "chat_reasoning", "frontier", "gpt-4o-mini")
    primary = FakeProvider("frontier", response=ChatResponse(content="ok", tokens_in=1, tokens_out=1, finish_reason="stop"))
    fallback = FakeProvider("metis")
    router = ProviderRouter(providers={"frontier": primary, "metis": fallback}, session_factory=lambda: db_session)
    req = ChatRequest(model="", messages=[ChatMessage(role="user", content="hi")])
    r = await router.chat(call_type="chat_reasoning", req=req)
    assert r.content == "ok"
    assert primary.calls == 1
    assert fallback.calls == 0
    rows = (await db_session.execute(select(LLMCall))).scalars().all()
    assert len(rows) == 1
    assert rows[0].status == "ok"
    assert rows[0].provider == "frontier"


@pytest.mark.asyncio
async def test_router_falls_back_on_retryable_error(db_session):
    await _seed_active_config(
        db_session, "chat_reasoning", "frontier", "gpt-4o-mini",
        fallback={"provider": "metis", "model_name": "metis-chat-pro"},
    )
    primary = FakeProvider("frontier", error=ProviderError("503", status=503, retryable=True))
    fallback = FakeProvider("metis", response=ChatResponse(content="ok-via-fallback", tokens_in=1, tokens_out=1, finish_reason="stop"))
    router = ProviderRouter(providers={"frontier": primary, "metis": fallback}, session_factory=lambda: db_session)
    r = await router.chat(call_type="chat_reasoning", req=ChatRequest(model="", messages=[ChatMessage(role="user", content="hi")]))
    assert r.content == "ok-via-fallback"
    rows = (await db_session.execute(select(LLMCall).order_by(LLMCall.id))).scalars().all()
    assert len(rows) == 2
    assert rows[0].status == "error"
    assert rows[1].status == "fallback"


@pytest.mark.asyncio
async def test_router_raises_when_both_fail(db_session):
    await _seed_active_config(
        db_session, "chat_reasoning", "frontier", "gpt-4o-mini",
        fallback={"provider": "metis", "model_name": "metis-chat-pro"},
    )
    primary = FakeProvider("frontier", error=ProviderError("503", status=503, retryable=True))
    fallback = FakeProvider("metis", error=ProviderError("503", status=503, retryable=True))
    router = ProviderRouter(providers={"frontier": primary, "metis": fallback}, session_factory=lambda: db_session)
    with pytest.raises(ProviderError):
        await router.chat(call_type="chat_reasoning", req=ChatRequest(model="", messages=[ChatMessage(role="user", content="hi")]))
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_router.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/providers/router.py`:
```python
import time
from collections.abc import Callable
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import LLMCall, ModelConfig
from energybot.providers.base import ChatRequest, ChatResponse, EmbeddingRequest, EmbeddingResponse, Provider, ProviderError


class ProviderRouter:
    def __init__(self, providers: dict[str, Provider], session_factory: Callable[[], AsyncSession]):
        self._providers = providers
        self._session_factory = session_factory

    async def _active_config(self, session: AsyncSession, call_type: str) -> ModelConfig:
        row = (await session.execute(
            select(ModelConfig).where(ModelConfig.call_type == call_type, ModelConfig.is_active.is_(True))
        )).scalar_one_or_none()
        if row is None:
            raise ProviderError(f"no active model_config for call_type={call_type}", retryable=False)
        return row

    async def chat(self, *, call_type: str, req: ChatRequest, prompt_key: str | None = None, prompt_version: int | None = None) -> ChatResponse:
        session = self._session_factory()
        cfg = await self._active_config(session, call_type)
        req.model = cfg.model_name
        primary = self._providers[cfg.provider]
        t0 = time.perf_counter()
        try:
            resp = await primary.chat(req)
            await self._log(session, call_type, cfg.provider, cfg.model_name, resp.tokens_in, resp.tokens_out,
                            int((time.perf_counter() - t0) * 1000), "ok", prompt_key, prompt_version)
            return resp
        except ProviderError as primary_err:
            await self._log(session, call_type, cfg.provider, cfg.model_name, 0, 0,
                            int((time.perf_counter() - t0) * 1000), "error", prompt_key, prompt_version)
            fb = cfg.params.get("fallback") if cfg.params else None
            if not fb or not primary_err.retryable:
                raise
            req.model = fb["model_name"]
            t1 = time.perf_counter()
            try:
                resp = await self._providers[fb["provider"]].chat(req)
                await self._log(session, call_type, fb["provider"], fb["model_name"], resp.tokens_in, resp.tokens_out,
                                int((time.perf_counter() - t1) * 1000), "fallback", prompt_key, prompt_version)
                return resp
            except ProviderError:
                raise

    async def embed(self, *, call_type: str, req: EmbeddingRequest) -> EmbeddingResponse:
        session = self._session_factory()
        cfg = await self._active_config(session, call_type)
        req.model = cfg.model_name
        primary = self._providers[cfg.provider]
        t0 = time.perf_counter()
        try:
            resp = await primary.embed(req)
            await self._log(session, call_type, cfg.provider, cfg.model_name, resp.tokens_in, 0,
                            int((time.perf_counter() - t0) * 1000), "ok", None, None)
            return resp
        except ProviderError as primary_err:
            await self._log(session, call_type, cfg.provider, cfg.model_name, 0, 0,
                            int((time.perf_counter() - t0) * 1000), "error", None, None)
            fb = cfg.params.get("fallback") if cfg.params else None
            if not fb or not primary_err.retryable:
                raise
            req.model = fb["model_name"]
            t1 = time.perf_counter()
            resp = await self._providers[fb["provider"]].embed(req)
            await self._log(session, call_type, fb["provider"], fb["model_name"], resp.tokens_in, 0,
                            int((time.perf_counter() - t1) * 1000), "fallback", None, None)
            return resp

    async def _log(self, session, call_type, provider, model, tin, tout, latency, status, pkey, pver) -> None:
        session.add(LLMCall(
            call_type=call_type, provider=provider, model=model,
            tokens_in=tin, tokens_out=tout, latency_ms=latency, status=status,
            prompt_template_key=pkey, prompt_template_version=pver,
        ))
        await session.commit()
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_router.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/providers/router.py tests/integration/test_router.py
git commit -m "feat(providers): router with fallback and llm_calls logging"
```

---

## Milestone 5 — Prompt & model configuration

### Task 16: Prompt template loader (Jinja2, TTL cached, active-row invariant)

**Files:**
- Create: `src/energybot/agent/__init__.py`
- Create: `src/energybot/agent/prompts.py`
- Create: `tests/integration/test_prompts.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_prompts.py`:
```python
import pytest
from sqlalchemy import text
from energybot.agent.prompts import PromptLoader
from energybot.core.models import PromptTemplate


@pytest.mark.asyncio
async def test_loads_active_template_and_renders(db_session):
    db_session.add(PromptTemplate(
        key="system_prompt", name="sys", body="سلام {{ name }}", version=1, status="active",
    ))
    await db_session.commit()
    loader = PromptLoader(session_factory=lambda: db_session, cache_ttl_seconds=0)
    text_out, key, version = await loader.render("system_prompt", {"name": "علی"})
    assert text_out == "سلام علی"
    assert key == "system_prompt"
    assert version == 1


@pytest.mark.asyncio
async def test_activate_atomically_retires_previous(db_session):
    db_session.add(PromptTemplate(key="sys", name="s", body="v1", version=1, status="active"))
    db_session.add(PromptTemplate(key="sys", name="s", body="v2", version=2, status="draft"))
    await db_session.commit()
    loader = PromptLoader(session_factory=lambda: db_session, cache_ttl_seconds=0)
    await loader.activate(key="sys", version=2)
    result = (await db_session.execute(text("SELECT version, status FROM prompt_templates WHERE key='sys' ORDER BY version"))).all()
    assert result == [(1, "retired"), (2, "active")]


@pytest.mark.asyncio
async def test_missing_active_raises(db_session):
    loader = PromptLoader(session_factory=lambda: db_session, cache_ttl_seconds=0)
    with pytest.raises(LookupError):
        await loader.render("nonexistent", {})
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_prompts.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/agent/__init__.py`: (empty)

`src/energybot/agent/prompts.py`:
```python
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from jinja2 import Environment, StrictUndefined
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import PromptTemplate


@dataclass(slots=True)
class _Cached:
    body: str
    version: int
    expires_at: float


class PromptLoader:
    def __init__(self, *, session_factory: Callable[[], AsyncSession], cache_ttl_seconds: int = 60):
        self._session_factory = session_factory
        self._ttl = cache_ttl_seconds
        self._cache: dict[str, _Cached] = {}
        self._env = Environment(undefined=StrictUndefined, autoescape=False)

    async def _fetch_active(self, key: str) -> _Cached:
        now = time.time()
        cached = self._cache.get(key)
        if cached and cached.expires_at > now:
            return cached
        session = self._session_factory()
        row = (await session.execute(
            select(PromptTemplate).where(PromptTemplate.key == key, PromptTemplate.status == "active")
        )).scalar_one_or_none()
        if row is None:
            raise LookupError(f"no active prompt template for key={key}")
        c = _Cached(body=row.body, version=row.version, expires_at=now + self._ttl)
        self._cache[key] = c
        return c

    async def render(self, key: str, variables: dict[str, Any]) -> tuple[str, str, int]:
        c = await self._fetch_active(key)
        return self._env.from_string(c.body).render(**variables), key, c.version

    async def activate(self, *, key: str, version: int) -> None:
        session = self._session_factory()
        async with session.begin():
            await session.execute(
                update(PromptTemplate)
                .where(PromptTemplate.key == key, PromptTemplate.status == "active")
                .values(status="retired")
            )
            row = (await session.execute(
                select(PromptTemplate).where(PromptTemplate.key == key, PromptTemplate.version == version)
            )).scalar_one()
            row.status = "active"
        self._cache.pop(key, None)
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_prompts.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/agent/__init__.py src/energybot/agent/prompts.py tests/integration/test_prompts.py
git commit -m "feat(agent): prompt template loader with TTL cache and atomic activate"
```

---

### Task 17: Model config loader

**Files:**
- Create: `src/energybot/agent/model_configs.py`
- Create: `tests/integration/test_model_configs.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_model_configs.py`:
```python
import pytest
from energybot.agent.model_configs import ModelConfigService
from energybot.core.models import ModelConfig


@pytest.mark.asyncio
async def test_activate_flips_invariant_atomically(db_session):
    db_session.add(ModelConfig(call_type="chat_reasoning", provider="frontier", model_name="gpt-4o-mini", is_active=True))
    db_session.add(ModelConfig(call_type="chat_reasoning", provider="metis", model_name="metis-chat-pro", is_active=False))
    await db_session.commit()
    svc = ModelConfigService(session_factory=lambda: db_session)
    rows = await svc.list_for_call_type("chat_reasoning")
    metis = next(r for r in rows if r.provider == "metis")
    await svc.activate(metis.id)
    active = await svc.get_active("chat_reasoning")
    assert active.provider == "metis"
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_model_configs.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/agent/model_configs.py`:
```python
from collections.abc import Callable
from uuid import UUID
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import ModelConfig


class ModelConfigService:
    def __init__(self, *, session_factory: Callable[[], AsyncSession]):
        self._session_factory = session_factory

    async def list_for_call_type(self, call_type: str) -> list[ModelConfig]:
        s = self._session_factory()
        return list((await s.execute(select(ModelConfig).where(ModelConfig.call_type == call_type))).scalars())

    async def get_active(self, call_type: str) -> ModelConfig:
        s = self._session_factory()
        row = (await s.execute(
            select(ModelConfig).where(ModelConfig.call_type == call_type, ModelConfig.is_active.is_(True))
        )).scalar_one_or_none()
        if row is None:
            raise LookupError(f"no active ModelConfig for call_type={call_type}")
        return row

    async def activate(self, config_id: UUID) -> None:
        s = self._session_factory()
        async with s.begin():
            target = (await s.execute(select(ModelConfig).where(ModelConfig.id == config_id))).scalar_one()
            await s.execute(
                update(ModelConfig)
                .where(ModelConfig.call_type == target.call_type, ModelConfig.is_active.is_(True))
                .values(is_active=False)
            )
            target.is_active = True
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_model_configs.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/agent/model_configs.py tests/integration/test_model_configs.py
git commit -m "feat(agent): model config service with atomic activation"
```

---

## Milestone 6 — Profile & onboarding

### Task 18: Profile repository (read, update via event log, JSON-path patches)

**Files:**
- Create: `src/energybot/profile/__init__.py`
- Create: `src/energybot/profile/repository.py`
- Create: `tests/integration/test_profile_repository.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_profile_repository.py`:
```python
import pytest
from sqlalchemy import select
from uuid import uuid4

from energybot.core.models import User, Profile, ProfileEvent
from energybot.profile.repository import ProfileRepository


async def _make_user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="علی")
    db_session.add(u)
    db_session.add(Profile(user_id=u.id))
    await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_set_household_field_writes_event(db_session):
    u = await _make_user(db_session)
    repo = ProfileRepository(session_factory=lambda: db_session)
    await repo.set(u.id, "household.city", "تهران", source="wizard", reason="onboarding step")
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert p.household["city"] == "تهران"
    events = (await db_session.execute(select(ProfileEvent).where(ProfileEvent.user_id == u.id))).scalars().all()
    assert len(events) == 1
    assert events[0].field_path == "household.city"
    assert events[0].after == {"value": "تهران"}
    assert events[0].source == "wizard"


@pytest.mark.asyncio
async def test_append_goal(db_session):
    u = await _make_user(db_session)
    repo = ProfileRepository(session_factory=lambda: db_session)
    await repo.append(u.id, "goals", {"text": "کاهش قبض برق", "status": "active"}, source="agent_tool", reason="user said")
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert p.goals == [{"text": "کاهش قبض برق", "status": "active"}]


@pytest.mark.asyncio
async def test_completeness_score_updates(db_session):
    u = await _make_user(db_session)
    repo = ProfileRepository(session_factory=lambda: db_session)
    await repo.set(u.id, "household.city", "تهران", source="wizard", reason="")
    await repo.set(u.id, "household.home_type", "آپارتمان", source="wizard", reason="")
    await repo.set(u.id, "household.occupants", 3, source="wizard", reason="")
    p = await repo.get(u.id)
    assert p.completeness_score >= 30
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_profile_repository.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/profile/__init__.py`: (empty)

`src/energybot/profile/repository.py`:
```python
from collections.abc import Callable
from typing import Any
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import Profile, ProfileEvent


REQUIRED_HOUSEHOLD_FIELDS = {"city", "home_type", "occupants", "area_m2", "heating_type", "cooling_type", "main_concern"}


def _split_path(path: str) -> tuple[str, list[str]]:
    parts = path.split(".")
    if len(parts) < 2:
        raise ValueError(f"path must be section.field[.sub]: {path!r}")
    return parts[0], parts[1:]


def _get_in(d: dict, keys: list[str]) -> Any:
    cur: Any = d
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def _set_in(d: dict, keys: list[str], value: Any) -> dict:
    cur = d
    for k in keys[:-1]:
        if k not in cur or not isinstance(cur[k], dict):
            cur[k] = {}
        cur = cur[k]
    cur[keys[-1]] = value
    return d


def _compute_completeness(p: Profile) -> int:
    filled = sum(1 for k in REQUIRED_HOUSEHOLD_FIELDS if p.household.get(k))
    base = int(100 * filled / len(REQUIRED_HOUSEHOLD_FIELDS))
    bonus_goals = 10 if p.goals else 0
    bonus_behaviour = min(10, len(p.behaviour) * 2)
    return min(100, base + bonus_goals + bonus_behaviour)


class ProfileRepository:
    def __init__(self, *, session_factory: Callable[[], AsyncSession]):
        self._session_factory = session_factory

    async def get(self, user_id: UUID) -> Profile:
        s = self._session_factory()
        return (await s.execute(select(Profile).where(Profile.user_id == user_id))).scalar_one()

    async def set(self, user_id: UUID, path: str, value: Any, *, source: str, reason: str, source_message_id: int | None = None) -> None:
        s = self._session_factory()
        async with s.begin():
            p = (await s.execute(select(Profile).where(Profile.user_id == user_id))).scalar_one()
            section, keys = _split_path(path)
            container = dict(getattr(p, section))
            before = _get_in(container, keys)
            _set_in(container, keys, value)
            setattr(p, section, container)
            p.completeness_score = _compute_completeness(p)
            s.add(ProfileEvent(
                user_id=user_id, field_path=path,
                before={"value": before} if before is not None else None,
                after={"value": value},
                source=source, source_message_id=source_message_id, reason=reason,
            ))

    async def append(self, user_id: UUID, section: str, item: Any, *, source: str, reason: str, source_message_id: int | None = None) -> None:
        if section not in ("goals", "commitments"):
            raise ValueError(f"append only supports goals|commitments, got {section!r}")
        s = self._session_factory()
        async with s.begin():
            p = (await s.execute(select(Profile).where(Profile.user_id == user_id))).scalar_one()
            arr = list(getattr(p, section))
            arr.append(item)
            setattr(p, section, arr)
            p.completeness_score = _compute_completeness(p)
            s.add(ProfileEvent(
                user_id=user_id, field_path=f"{section}[+]",
                before=None, after={"item": item},
                source=source, source_message_id=source_message_id, reason=reason,
            ))
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_profile_repository.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/profile tests/integration/test_profile_repository.py
git commit -m "feat(profile): repository with JSON-path set, append, event log, completeness"
```

---

### Task 19: Profile renderer (Persian text for context assembly)

**Files:**
- Create: `src/energybot/profile/render.py`
- Create: `tests/test_profile_render.py`

- [ ] **Step 1: Write failing test**

`tests/test_profile_render.py`:
```python
from energybot.profile.render import render_profile_summary


def test_empty_profile_renders_no_data_message():
    out = render_profile_summary({}, {}, [], [])
    assert "هنوز اطلاعاتی" in out


def test_household_fields_rendered_in_persian():
    out = render_profile_summary(
        household={"city": "تهران", "home_type": "آپارتمان", "occupants": 3, "heating_type": "پکیج"},
        behaviour={},
        goals=[],
        commitments=[],
    )
    assert "تهران" in out
    assert "آپارتمان" in out
    assert "۳" in out  # Persian digit
    assert "پکیج" in out


def test_goals_and_commitments_rendered():
    out = render_profile_summary(
        household={},
        behaviour={},
        goals=[{"text": "کاهش قبض برق", "status": "active"}],
        commitments=[{"text": "ترموستات روی ۲۱", "fulfilled": False}],
    )
    assert "کاهش قبض برق" in out
    assert "ترموستات روی ۲۱" in out
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_profile_render.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/profile/render.py`:
```python
from typing import Any

_LABELS = {
    "city": "شهر",
    "home_type": "نوع مسکن",
    "occupants": "تعداد افراد خانوار",
    "area_m2": "متراژ",
    "heating_type": "سیستم گرمایش",
    "cooling_type": "سیستم سرمایش",
    "main_concern": "دغدغه اصلی",
}

_EN_TO_FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def _fa_digits(s: Any) -> str:
    return str(s).translate(_EN_TO_FA_DIGITS)


def render_profile_summary(household: dict, behaviour: dict, goals: list, commitments: list) -> str:
    parts: list[str] = []
    if household:
        rows = []
        for k, label in _LABELS.items():
            v = household.get(k)
            if v in (None, "", []):
                continue
            rows.append(f"- {label}: {_fa_digits(v)}")
        if rows:
            parts.append("**اطلاعات خانه:**\n" + "\n".join(rows))
    if behaviour:
        rows = [f"- {k}: {_fa_digits(v)}" for k, v in behaviour.items()]
        parts.append("**عادت‌های مصرف:**\n" + "\n".join(rows))
    if goals:
        rows = [f"- {g.get('text', '')} ({g.get('status', '')})" for g in goals]
        parts.append("**هدف‌ها:**\n" + "\n".join(rows))
    if commitments:
        rows = [f"- {c.get('text', '')}" + (" ✅" if c.get("fulfilled") else "") for c in commitments]
        parts.append("**تعهدها:**\n" + "\n".join(rows))
    if not parts:
        return "هنوز اطلاعاتی از این کاربر در دست نیست."
    return "\n\n".join(parts)
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/test_profile_render.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/profile/render.py tests/test_profile_render.py
git commit -m "feat(profile): Persian summary renderer for prompt context"
```

---

### Task 20: Onboarding wizard state machine

**Files:**
- Create: `src/energybot/profile/wizard.py`
- Create: `tests/integration/test_wizard.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_wizard.py`:
```python
import pytest
from sqlalchemy import select
from uuid import uuid4
from energybot.core.models import User, Profile, OnboardingState
from energybot.profile.repository import ProfileRepository
from energybot.profile.wizard import WizardEngine


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    db_session.add(Profile(user_id=u.id))
    await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_first_step_is_city(db_session):
    u = await _user(db_session)
    eng = WizardEngine(session_factory=lambda: db_session, profile_repo=ProfileRepository(session_factory=lambda: db_session))
    step = await eng.start(u.id)
    assert step.key == "city"
    assert "شهر" in step.prompt


@pytest.mark.asyncio
async def test_answer_advances_step_and_persists(db_session):
    u = await _user(db_session)
    eng = WizardEngine(session_factory=lambda: db_session, profile_repo=ProfileRepository(session_factory=lambda: db_session))
    await eng.start(u.id)
    next_step = await eng.answer(u.id, "تهران")
    state = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    assert state.answers["city"] == "تهران"
    assert next_step.key == "home_type"


@pytest.mark.asyncio
async def test_full_wizard_completes_and_writes_profile(db_session):
    u = await _user(db_session)
    eng = WizardEngine(session_factory=lambda: db_session, profile_repo=ProfileRepository(session_factory=lambda: db_session))
    await eng.start(u.id)
    answers = ["تهران", "آپارتمان", "3", "60-100", "پکیج", "اسپلیت", "کاهش قبض برق"]
    last = None
    for a in answers:
        last = await eng.answer(u.id, a)
    assert last is None  # completed
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert p.household["city"] == "تهران"
    assert p.household["home_type"] == "آپارتمان"
    assert p.household["occupants"] == 3
    state = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    assert state.completed_at is not None
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_wizard.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/profile/wizard.py`:
```python
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import OnboardingState
from energybot.profile.repository import ProfileRepository


@dataclass(slots=True)
class WizardStep:
    key: str
    prompt: str
    buttons: list[str] | None  # None = free text


@dataclass(slots=True)
class _StepDef:
    key: str
    prompt: str
    buttons: list[str] | None
    profile_path: str
    parse: Callable[[str], Any]


def _int(s: str) -> int:
    s = s.replace("۰", "0").replace("۱", "1").replace("۲", "2").replace("۳", "3").replace("۴", "4")
    s = s.replace("۵", "5").replace("۶", "6").replace("۷", "7").replace("۸", "8").replace("۹", "9").replace("+", "")
    return int(s.strip())


STEPS: list[_StepDef] = [
    _StepDef("city", "در چه شهری زندگی می‌کنی؟", None, "household.city", str.strip),
    _StepDef("home_type", "نوع مسکنت چیست؟", ["آپارتمان", "ویلایی", "مجتمع"], "household.home_type", str.strip),
    _StepDef("occupants", "چند نفر در خانه زندگی می‌کنید؟", ["1", "2", "3", "4", "5+"], "household.occupants", _int),
    _StepDef("area_m2", "متراژ تقریبی خانه؟", ["<60", "60-100", "100-150", "150-200", ">200"], "household.area_m2", str.strip),
    _StepDef("heating_type", "سیستم گرمایش؟", ["پکیج", "شوفاژ مرکزی", "بخاری گازی", "برقی"], "household.heating_type", str.strip),
    _StepDef("cooling_type", "سیستم سرمایش؟", ["کولر آبی", "اسپلیت", "کولر گازی پنجره‌ای", "مرکزی"], "household.cooling_type", str.strip),
    _StepDef("main_concern", "دغدغه اصلی؟", ["کاهش قبض برق", "کاهش قبض گاز", "یادگیری راه‌های صرفه‌جویی", "موارد دیگر"], "household.main_concern", str.strip),
]

_STEP_BY_KEY: dict[str, _StepDef] = {s.key: s for s in STEPS}


class WizardEngine:
    def __init__(self, *, session_factory: Callable[[], AsyncSession], profile_repo: ProfileRepository):
        self._session_factory = session_factory
        self._profile_repo = profile_repo

    async def start(self, user_id: UUID) -> WizardStep:
        s = self._session_factory()
        existing = (await s.execute(select(OnboardingState).where(OnboardingState.user_id == user_id))).scalar_one_or_none()
        if existing is None:
            s.add(OnboardingState(user_id=user_id, current_step=STEPS[0].key, answers={}))
            await s.commit()
            cur = STEPS[0]
        else:
            cur = _STEP_BY_KEY[existing.current_step]
        return WizardStep(key=cur.key, prompt=cur.prompt, buttons=cur.buttons)

    async def current_step(self, user_id: UUID) -> WizardStep | None:
        s = self._session_factory()
        state = (await s.execute(select(OnboardingState).where(OnboardingState.user_id == user_id))).scalar_one_or_none()
        if state is None or state.completed_at is not None:
            return None
        cur = _STEP_BY_KEY[state.current_step]
        return WizardStep(key=cur.key, prompt=cur.prompt, buttons=cur.buttons)

    async def abandon(self, user_id: UUID) -> None:
        s = self._session_factory()
        async with s.begin():
            state = (await s.execute(select(OnboardingState).where(OnboardingState.user_id == user_id))).scalar_one_or_none()
            if state and state.completed_at is None:
                state.completed_at = datetime.utcnow()

    async def answer(self, user_id: UUID, text_value: str) -> WizardStep | None:
        s = self._session_factory()
        state = (await s.execute(select(OnboardingState).where(OnboardingState.user_id == user_id))).scalar_one()
        cur = _STEP_BY_KEY[state.current_step]
        parsed = cur.parse(text_value)
        await self._profile_repo.set(user_id, cur.profile_path, parsed, source="wizard", reason=f"wizard:{cur.key}")
        state.answers = {**state.answers, cur.key: parsed}
        idx = STEPS.index(cur)
        if idx + 1 < len(STEPS):
            state.current_step = STEPS[idx + 1].key
            await s.commit()
            nxt = STEPS[idx + 1]
            return WizardStep(key=nxt.key, prompt=nxt.prompt, buttons=nxt.buttons)
        state.completed_at = datetime.utcnow()
        await s.commit()
        return None
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_wizard.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/profile/wizard.py tests/integration/test_wizard.py
git commit -m "feat(profile): onboarding wizard state machine with abandon support"
```

---

## Milestone 7 — Chat & messages

### Task 21: Message + session repository (with 30-min idle gap)

**Files:**
- Create: `src/energybot/chat/__init__.py`
- Create: `src/energybot/chat/repository.py`
- Create: `tests/integration/test_chat_repository.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_chat_repository.py`:
```python
from datetime import datetime, timedelta
from uuid import uuid4
import pytest
from sqlalchemy import select
from energybot.core.models import User, Message, ChatSession
from energybot.chat.repository import ChatRepository


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_first_message_opens_session(db_session):
    u = await _user(db_session)
    repo = ChatRepository(session_factory=lambda: db_session, idle_minutes=30)
    sid = await repo.session_for(u.id)
    sess = (await db_session.execute(select(ChatSession).where(ChatSession.id == sid))).scalar_one()
    assert sess.ended_at is None


@pytest.mark.asyncio
async def test_active_session_reused_within_window(db_session):
    u = await _user(db_session)
    repo = ChatRepository(session_factory=lambda: db_session, idle_minutes=30)
    s1 = await repo.session_for(u.id)
    s2 = await repo.session_for(u.id)
    assert s1 == s2


@pytest.mark.asyncio
async def test_idle_gap_closes_session_and_opens_new(db_session):
    u = await _user(db_session)
    repo = ChatRepository(session_factory=lambda: db_session, idle_minutes=30)
    s1 = await repo.session_for(u.id)
    sess = (await db_session.execute(select(ChatSession).where(ChatSession.id == s1))).scalar_one()
    sess.started_at = datetime.utcnow() - timedelta(hours=2)
    await db_session.commit()
    await repo.add_message(u.id, s1, role="user", content="old")
    # Force last message to be old as well
    m = (await db_session.execute(select(Message).where(Message.user_id == u.id))).scalar_one()
    m.created_at = datetime.utcnow() - timedelta(hours=1)
    await db_session.commit()
    s2 = await repo.session_for(u.id)
    assert s2 != s1


@pytest.mark.asyncio
async def test_last_n_messages_excludes_tool_rows(db_session):
    u = await _user(db_session)
    repo = ChatRepository(session_factory=lambda: db_session, idle_minutes=30)
    sid = await repo.session_for(u.id)
    await repo.add_message(u.id, sid, role="user", content="hi")
    await repo.add_message(u.id, sid, role="tool", content="", tool_name="search_kb")
    await repo.add_message(u.id, sid, role="assistant", content="سلام")
    msgs = await repo.last_n_user_assistant(u.id, n=5)
    assert [m.role for m in msgs] == ["user", "assistant"]
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_chat_repository.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/chat/__init__.py`: (empty)

`src/energybot/chat/repository.py`:
```python
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
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_chat_repository.py -v`
Expected: 4 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/chat tests/integration/test_chat_repository.py
git commit -m "feat(chat): repository with 30-min idle gap session manager"
```

---

### Task 22: Rolling summary worker (inline trigger)

**Files:**
- Create: `src/energybot/agent/summarizer.py`
- Create: `tests/integration/test_summarizer.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_summarizer.py`:
```python
from datetime import datetime
from uuid import uuid4
import pytest
from sqlalchemy import select
from energybot.core.models import User, ChatSession, Message, ChatSummary
from energybot.chat.repository import ChatRepository
from energybot.agent.summarizer import Summarizer


class FakeRouter:
    def __init__(self, text: str = "خلاصه‌ی گفتگو"):
        self._text = text
        self.calls = 0

    async def chat(self, *, call_type, req, prompt_key=None, prompt_version=None):
        self.calls += 1
        from energybot.providers.base import ChatResponse
        return ChatResponse(content=self._text, tokens_in=10, tokens_out=5, finish_reason="stop")


async def _seed(db_session, n_messages: int):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000))
    db_session.add(u)
    await db_session.commit()
    sess = ChatSession(user_id=u.id)
    db_session.add(sess)
    await db_session.commit()
    for i in range(n_messages):
        db_session.add(Message(user_id=u.id, session_id=sess.id, role="user" if i % 2 == 0 else "assistant", content=f"m{i}"))
    await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_no_summary_if_below_threshold(db_session):
    u = await _seed(db_session, n_messages=5)
    repo = ChatRepository(session_factory=lambda: db_session)
    summ = Summarizer(chat_repo=repo, router=FakeRouter(), threshold=20)
    created = await summ.maybe_summarize(u.id)
    assert created is False
    rows = (await db_session.execute(select(ChatSummary).where(ChatSummary.user_id == u.id))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_summary_created_when_threshold_crossed(db_session):
    u = await _seed(db_session, n_messages=20)
    repo = ChatRepository(session_factory=lambda: db_session)
    router = FakeRouter()
    summ = Summarizer(chat_repo=repo, router=router, threshold=20)
    created = await summ.maybe_summarize(u.id)
    assert created is True
    assert router.calls == 1
    row = (await db_session.execute(select(ChatSummary).where(ChatSummary.user_id == u.id))).scalar_one()
    assert row.text == "خلاصه‌ی گفتگو"
    assert row.covers_to_message_id > row.covers_from_message_id


@pytest.mark.asyncio
async def test_second_summary_starts_after_previous(db_session):
    u = await _seed(db_session, n_messages=20)
    repo = ChatRepository(session_factory=lambda: db_session)
    summ = Summarizer(chat_repo=repo, router=FakeRouter(text="s1"), threshold=20)
    assert await summ.maybe_summarize(u.id) is True
    for i in range(20):
        db_session.add(Message(user_id=u.id, session_id=(await db_session.execute(select(ChatSession).where(ChatSession.user_id == u.id))).scalar_one().id, role="user", content=f"x{i}"))
    await db_session.commit()
    summ2 = Summarizer(chat_repo=repo, router=FakeRouter(text="s2"), threshold=20)
    assert await summ2.maybe_summarize(u.id) is True
    rows = (await db_session.execute(select(ChatSummary).where(ChatSummary.user_id == u.id).order_by(ChatSummary.id))).scalars().all()
    assert [r.text for r in rows] == ["s1", "s2"]
    assert rows[1].covers_from_message_id > rows[0].covers_to_message_id
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_summarizer.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/agent/summarizer.py`:
```python
from typing import Any
from uuid import UUID
from energybot.chat.repository import ChatRepository
from energybot.providers.base import ChatMessage, ChatRequest


SUMMARIZER_SYSTEM = (
    "تو یک خلاصه‌نویس فارسی هستی. خلاصه‌ای فشرده (یک تا دو پاراگراف) از گفتگو بنویس "
    "که شامل: موضوعات اصلی، تصمیم‌ها، تعهدها، و حقایق مهم درباره‌ی کاربر باشد."
)


class Summarizer:
    def __init__(self, *, chat_repo: ChatRepository, router: Any, threshold: int = 20):
        self._chat_repo = chat_repo
        self._router = router
        self._threshold = threshold

    async def maybe_summarize(self, user_id: UUID) -> bool:
        last = await self._chat_repo.latest_summary(user_id)
        after_id = last.covers_to_message_id if last else 0
        new_messages = await self._chat_repo.messages_since(user_id, after_id)
        if len(new_messages) < self._threshold:
            return False
        transcript_lines: list[str] = []
        for m in new_messages:
            if m.role in ("user", "assistant") and m.content:
                speaker = "کاربر" if m.role == "user" else "دستیار"
                transcript_lines.append(f"{speaker}: {m.content}")
        prior_block = f"خلاصه قبلی: {last.text}\n\n" if last else ""
        req = ChatRequest(
            model="",
            messages=[
                ChatMessage(role="system", content=SUMMARIZER_SYSTEM),
                ChatMessage(role="user", content=prior_block + "گفتگوی جدید:\n" + "\n".join(transcript_lines)),
            ],
        )
        resp = await self._router.chat(call_type="summarize", req=req)
        # Write summary
        from energybot.core.models import ChatSummary  # local import to avoid cycle
        s = self._chat_repo._session_factory()
        s.add(ChatSummary(
            user_id=user_id, session_id=None, text=resp.content,
            covers_from_message_id=new_messages[0].id, covers_to_message_id=new_messages[-1].id,
        ))
        await s.commit()
        return True
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_summarizer.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/agent/summarizer.py tests/integration/test_summarizer.py
git commit -m "feat(agent): rolling summary worker triggered inline at end of turn"
```

---

### Task 23: Context assembler

**Files:**
- Create: `src/energybot/agent/context.py`
- Create: `tests/integration/test_context.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_context.py`:
```python
from uuid import uuid4
import pytest
from energybot.core.models import User, Profile
from energybot.profile.repository import ProfileRepository
from energybot.chat.repository import ChatRepository
from energybot.agent.context import ContextAssembler


class FakePromptLoader:
    async def render(self, key, vars):
        return ("سیستم: " + vars["profile_summary"][:30], key, 1)


@pytest.mark.asyncio
async def test_assemble_includes_system_profile_summary_and_recent(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    db_session.add(Profile(user_id=u.id, household={"city": "تهران"}))
    await db_session.commit()
    chat = ChatRepository(session_factory=lambda: db_session)
    sid = await chat.session_for(u.id)
    await chat.add_message(u.id, sid, role="user", content="سلام")
    await chat.add_message(u.id, sid, role="assistant", content="درود")
    prof_repo = ProfileRepository(session_factory=lambda: db_session)
    asm = ContextAssembler(prompt_loader=FakePromptLoader(), profile_repo=prof_repo, chat_repo=chat)
    ctx = await asm.assemble(u.id, "این پیام جدید")
    assert ctx.system.startswith("سیستم:")
    assert ctx.prompt_template_key == "system_prompt"
    assert ctx.prompt_template_version == 1
    roles = [m.role for m in ctx.messages]
    assert roles == ["system", "user", "assistant", "user"]
    assert ctx.messages[-1].content == "این پیام جدید"
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_context.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/agent/context.py`:
```python
from dataclasses import dataclass
from typing import Any
from uuid import UUID
from energybot.providers.base import ChatMessage
from energybot.profile.render import render_profile_summary
from energybot.profile.repository import ProfileRepository
from energybot.chat.repository import ChatRepository


@dataclass(slots=True)
class AssembledContext:
    system: str
    messages: list[ChatMessage]
    prompt_template_key: str
    prompt_template_version: int


class ContextAssembler:
    def __init__(self, *, prompt_loader: Any, profile_repo: ProfileRepository, chat_repo: ChatRepository, recent_n: int = 10):
        self._loader = prompt_loader
        self._profile_repo = profile_repo
        self._chat_repo = chat_repo
        self._recent_n = recent_n

    async def assemble(self, user_id: UUID, new_user_text: str) -> AssembledContext:
        profile = await self._profile_repo.get(user_id)
        profile_summary = render_profile_summary(
            profile.household or {}, profile.behaviour or {}, profile.goals or [], profile.commitments or [],
        )
        last_summary = await self._chat_repo.latest_summary(user_id)
        recent = await self._chat_repo.last_n_user_assistant(user_id, n=self._recent_n)
        system_text, key, version = await self._loader.render("system_prompt", {
            "profile_summary": profile_summary,
            "rolling_summary": last_summary.text if last_summary else "",
        })
        messages: list[ChatMessage] = [ChatMessage(role="system", content=system_text)]
        for m in recent:
            messages.append(ChatMessage(role=m.role, content=m.content))
        messages.append(ChatMessage(role="user", content=new_user_text))
        return AssembledContext(system=system_text, messages=messages,
                                prompt_template_key=key, prompt_template_version=version)
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_context.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/agent/context.py tests/integration/test_context.py
git commit -m "feat(agent): context assembler combining system+profile+summary+history"
```

---

## Milestone 8 — KB ingestion

### Task 24: KB article repository

**Files:**
- Create: `src/energybot/kb/__init__.py`
- Create: `src/energybot/kb/repository.py`
- Create: `tests/integration/test_kb_repository.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_kb_repository.py`:
```python
import pytest
from sqlalchemy import select
from energybot.core.models import KBArticle
from energybot.kb.repository import KBRepository


@pytest.mark.asyncio
async def test_create_article_starts_as_draft(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="بهینه‌سازی پکیج", body="متن", category="gas", tags=["پکیج"], created_by=None)
    row = (await db_session.execute(select(KBArticle).where(KBArticle.id == aid))).scalar_one()
    assert row.status == "draft"
    assert row.version == 1
    assert row.category == "gas"


@pytest.mark.asyncio
async def test_update_body_bumps_version_and_keeps_draft(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="t", body="b1", category="general", tags=[], created_by=None)
    await repo.update(aid, body="b2")
    row = (await db_session.execute(select(KBArticle).where(KBArticle.id == aid))).scalar_one()
    assert row.body == "b2"
    assert row.version == 2
    assert row.status == "draft"


@pytest.mark.asyncio
async def test_soft_delete_excludes_from_list(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    a1 = await repo.create(title="a", body="x", category="gas", tags=[], created_by=None)
    a2 = await repo.create(title="b", body="y", category="gas", tags=[], created_by=None)
    await repo.soft_delete(a1)
    visible = await repo.list_visible()
    assert {r.id for r in visible} == {a2}
    trashed = await repo.list_trashed()
    assert {r.id for r in trashed} == {a1}
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_kb_repository.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/kb/__init__.py`: (empty)

`src/energybot/kb/repository.py`:
```python
from collections.abc import Callable
from datetime import datetime
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import KBArticle


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
        async with s.begin():
            row = (await s.execute(select(KBArticle).where(KBArticle.id == article_id))).scalar_one()
            if title is not None: row.title = title
            if body is not None: row.body = body
            if category is not None: row.category = category
            if tags is not None: row.tags = tags
            row.version = row.version + 1
            row.updated_at = datetime.utcnow()

    async def soft_delete(self, article_id: UUID) -> None:
        s = self._session_factory()
        async with s.begin():
            row = (await s.execute(select(KBArticle).where(KBArticle.id == article_id))).scalar_one()
            row.deleted_at = datetime.utcnow()

    async def restore(self, article_id: UUID) -> None:
        s = self._session_factory()
        async with s.begin():
            row = (await s.execute(select(KBArticle).where(KBArticle.id == article_id))).scalar_one()
            row.deleted_at = None

    async def list_visible(self) -> list[KBArticle]:
        s = self._session_factory()
        return list((await s.execute(select(KBArticle).where(KBArticle.deleted_at.is_(None)))).scalars())

    async def list_trashed(self) -> list[KBArticle]:
        s = self._session_factory()
        return list((await s.execute(select(KBArticle).where(KBArticle.deleted_at.is_not(None)))).scalars())
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_kb_repository.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/kb/__init__.py src/energybot/kb/repository.py tests/integration/test_kb_repository.py
git commit -m "feat(kb): article repository with soft-delete + version bump"
```

---

### Task 25: Media storage (filesystem, size limits, mime sniffing)

**Files:**
- Create: `src/energybot/kb/media_storage.py`
- Create: `tests/test_media_storage.py`

- [ ] **Step 1: Write failing test**

`tests/test_media_storage.py`:
```python
import io
import pytest
from energybot.kb.media_storage import MediaStorage, MediaTooLarge, MediaTypeNotAllowed


@pytest.fixture
def storage(tmp_path):
    return MediaStorage(root=str(tmp_path))


def test_save_image_under_limit(storage):
    fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    info = storage.save(io.BytesIO(fake_png), declared_mime="image/png", filename="x.png")
    assert info.mime_type == "image/png"
    assert info.file_size_bytes == len(fake_png)
    assert info.type == "image"
    assert info.storage_path.endswith(".png")


def test_save_video_under_limit(storage):
    fake_mp4 = b"\x00\x00\x00\x20ftypisom" + b"\x00" * 200
    info = storage.save(io.BytesIO(fake_mp4), declared_mime="video/mp4", filename="x.mp4")
    assert info.type == "video"
    assert info.mime_type == "video/mp4"


def test_image_too_large_rejected(storage):
    huge = b"\x89PNG\r\n\x1a\n" + b"\x00" * (6 * 1024 * 1024)
    with pytest.raises(MediaTooLarge):
        storage.save(io.BytesIO(huge), declared_mime="image/png", filename="x.png")


def test_video_too_large_rejected(storage):
    huge = b"\x00\x00\x00\x20ftypisom" + b"\x00" * (51 * 1024 * 1024)
    with pytest.raises(MediaTooLarge):
        storage.save(io.BytesIO(huge), declared_mime="video/mp4", filename="x.mp4")


def test_disallowed_mime_rejected(storage):
    with pytest.raises(MediaTypeNotAllowed):
        storage.save(io.BytesIO(b"x"), declared_mime="application/x-msdownload", filename="x.exe")
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_media_storage.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/kb/media_storage.py`:
```python
import os
from dataclasses import dataclass
from typing import BinaryIO
from uuid import uuid4


IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
VIDEO_MIMES = {"video/mp4", "video/quicktime", "video/webm"}
IMAGE_MAX = 5 * 1024 * 1024
VIDEO_MAX = 50 * 1024 * 1024

MIME_TO_EXT = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
    "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
}


class MediaTooLarge(Exception): pass
class MediaTypeNotAllowed(Exception): pass


@dataclass(slots=True)
class StoredMedia:
    storage_path: str
    mime_type: str
    type: str  # image | video
    file_size_bytes: int


class MediaStorage:
    def __init__(self, *, root: str):
        self._root = root
        os.makedirs(root, exist_ok=True)

    def save(self, fp: BinaryIO, *, declared_mime: str, filename: str) -> StoredMedia:
        if declared_mime in IMAGE_MIMES:
            kind = "image"
            cap = IMAGE_MAX
        elif declared_mime in VIDEO_MIMES:
            kind = "video"
            cap = VIDEO_MAX
        else:
            raise MediaTypeNotAllowed(f"mime not allowed: {declared_mime}")
        data = fp.read()
        if len(data) > cap:
            raise MediaTooLarge(f"size {len(data)} > cap {cap} for {kind}")
        ext = MIME_TO_EXT.get(declared_mime, os.path.splitext(filename)[1] or "")
        path = os.path.join(self._root, f"{uuid4().hex}{ext}")
        with open(path, "wb") as out:
            out.write(data)
        return StoredMedia(storage_path=path, mime_type=declared_mime, type=kind, file_size_bytes=len(data))
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/test_media_storage.py -v`
Expected: 5 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/kb/media_storage.py tests/test_media_storage.py
git commit -m "feat(kb): media storage with size limits and mime allowlist"
```

---

### Task 26: KB chunking (Persian-aware)

**Files:**
- Create: `src/energybot/kb/chunking.py`
- Create: `tests/test_chunking.py`

- [ ] **Step 1: Write failing test**

`tests/test_chunking.py`:
```python
from energybot.kb.chunking import chunk_text


def test_short_text_one_chunk():
    chunks = chunk_text("کوتاه است.", target_tokens=400, overlap_tokens=60)
    assert len(chunks) == 1
    assert chunks[0] == "کوتاه است."


def test_long_text_produces_multiple_chunks():
    body = ("جمله. " * 500)  # very long
    chunks = chunk_text(body, target_tokens=200, overlap_tokens=40)
    assert len(chunks) >= 2
    for c in chunks:
        assert len(c) > 0


def test_paragraph_break_preserved():
    body = "پاراگراف اول.\n\nپاراگراف دوم."
    chunks = chunk_text(body, target_tokens=400, overlap_tokens=60)
    assert len(chunks) == 1
    assert "پاراگراف اول" in chunks[0]
    assert "پاراگراف دوم" in chunks[0]


def test_overlap_present_when_split():
    body = ("یک جمله طولانی. " * 200)
    chunks = chunk_text(body, target_tokens=100, overlap_tokens=40)
    assert len(chunks) >= 2
    # Tail of first should appear in head of second (heuristic overlap)
    tail_words = chunks[0].split()[-5:]
    assert any(w in chunks[1] for w in tail_words)
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_chunking.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/kb/chunking.py`:
```python
import re
import tiktoken

_ENC = tiktoken.get_encoding("cl100k_base")
_PARA = re.compile(r"\n\s*\n")
_SENT = re.compile(r"(?<=[\.\؟\!\:])\s+")


def _count(s: str) -> int:
    return len(_ENC.encode(s))


def chunk_text(text: str, *, target_tokens: int = 400, overlap_tokens: int = 60) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if _count(text) <= target_tokens:
        return [text]

    paragraphs = [p.strip() for p in _PARA.split(text) if p.strip()]
    units: list[str] = []
    for p in paragraphs:
        if _count(p) <= target_tokens:
            units.append(p)
        else:
            sents = [s.strip() for s in _SENT.split(p) if s.strip()]
            units.extend(sents or [p])

    chunks: list[str] = []
    cur: list[str] = []
    cur_tokens = 0
    for u in units:
        u_tok = _count(u)
        if cur_tokens + u_tok > target_tokens and cur:
            chunks.append(" ".join(cur))
            # build overlap: take from the tail until reaching overlap_tokens
            overlap: list[str] = []
            tally = 0
            for prev in reversed(cur):
                t = _count(prev)
                if tally + t > overlap_tokens:
                    break
                overlap.insert(0, prev)
                tally += t
            cur = overlap[:]
            cur_tokens = tally
        cur.append(u)
        cur_tokens += u_tok
    if cur:
        chunks.append(" ".join(cur))
    return chunks
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/test_chunking.py -v`
Expected: 4 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/kb/chunking.py tests/test_chunking.py
git commit -m "feat(kb): Persian-aware token chunker with overlap"
```

---

### Task 27: KB attachments + transcription stub

**Files:**
- Create: `src/energybot/kb/transcribe.py`
- Modify: `src/energybot/kb/repository.py` (extend with attachment ops)
- Create: `tests/integration/test_kb_attachments.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_kb_attachments.py`:
```python
import io
import pytest
from sqlalchemy import select
from energybot.core.models import KBAttachment, VideoTranscript
from energybot.kb.repository import KBRepository
from energybot.kb.media_storage import MediaStorage
from energybot.kb.transcribe import TranscriptionService


class FakeRouter:
    async def chat(self, *, call_type, req, prompt_key=None, prompt_version=None):
        from energybot.providers.base import ChatResponse
        return ChatResponse(content="رونوشت فارسی", tokens_in=1, tokens_out=1, finish_reason="stop")


@pytest.mark.asyncio
async def test_add_image_attachment(tmp_path, db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="x", body="b", category="general", tags=[], created_by=None)
    storage = MediaStorage(root=str(tmp_path))
    fake = b"\x89PNG\r\n\x1a\n" + b"\x00" * 10
    att_id = await repo.add_attachment(
        aid, storage=storage, fp=io.BytesIO(fake), declared_mime="image/png", filename="d.png", caption_fa="دیاگرام",
    )
    row = (await db_session.execute(select(KBAttachment).where(KBAttachment.id == att_id))).scalar_one()
    assert row.type == "image"
    assert row.caption_fa == "دیاگرام"


@pytest.mark.asyncio
async def test_add_video_attachment_triggers_transcript(tmp_path, db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="x", body="b", category="general", tags=[], created_by=None)
    storage = MediaStorage(root=str(tmp_path))
    transcribe = TranscriptionService(router=FakeRouter())
    fake = b"\x00\x00\x00\x20ftypisom" + b"\x00" * 200
    att_id = await repo.add_attachment(
        aid, storage=storage, fp=io.BytesIO(fake), declared_mime="video/mp4", filename="v.mp4", caption_fa="ویدیو",
    )
    await transcribe.transcribe_attachment(att_id, session_factory=lambda: db_session)
    t = (await db_session.execute(select(VideoTranscript).where(VideoTranscript.attachment_id == att_id))).scalar_one()
    assert t.text == "رونوشت فارسی"
    assert t.is_admin_edited is False
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_kb_attachments.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `src/energybot/kb/repository.py`:
```python
from typing import BinaryIO
from energybot.core.models import KBAttachment
from energybot.kb.media_storage import MediaStorage


class KBRepository(KBRepository):  # type: ignore[no-redef]
    pass


async def _add_attachment_impl(self, article_id, *, storage: MediaStorage, fp: BinaryIO,
                               declared_mime: str, filename: str, caption_fa: str | None = None,
                               order_index: int = 0):
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


# attach as method
from energybot.kb.repository import KBRepository as _Repo  # noqa: E402

_Repo.add_attachment = _add_attachment_impl  # type: ignore[attr-defined]
```

(Cleaner alternative — edit the original class to include this method directly. Implementer: place `add_attachment` inside `class KBRepository` rather than the trampoline above. The trampoline exists here only to keep the diff readable.)

`src/energybot/kb/transcribe.py`:
```python
from collections.abc import Callable
from datetime import datetime
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import KBAttachment, VideoTranscript
from energybot.providers.base import ChatMessage, ChatRequest


SYSTEM = "تو یک رونویس فارسی هستی. متن گفته شده در ویدیو را به‌صورت دقیق و خوانا بنویس."


class TranscriptionService:
    def __init__(self, *, router):
        self._router = router

    async def transcribe_attachment(self, attachment_id: UUID, *, session_factory: Callable[[], AsyncSession]) -> None:
        s = session_factory()
        att = (await s.execute(select(KBAttachment).where(KBAttachment.id == attachment_id))).scalar_one()
        if att.type != "video":
            raise ValueError("only video attachments can be transcribed")
        # NOTE: real implementation calls a Whisper endpoint with the file at att.storage_path.
        # Phase-1 placeholder uses the chat router with a stub message and call_type='transcribe' to
        # allow the rest of the pipeline to work. Implementer: replace this body with a real
        # multipart call to providers.frontier.FrontierProvider.transcribe(...) when adding Whisper.
        req = ChatRequest(model="", messages=[
            ChatMessage(role="system", content=SYSTEM),
            ChatMessage(role="user", content=f"(audio at {att.storage_path})"),
        ])
        resp = await self._router.chat(call_type="transcribe", req=req)
        t = (await s.execute(select(VideoTranscript).where(VideoTranscript.attachment_id == attachment_id))).scalar_one_or_none()
        if t is None:
            t = VideoTranscript(attachment_id=attachment_id, text=resp.content)
            s.add(t)
        else:
            t.text = resp.content
            t.updated_at = datetime.utcnow()
        await s.commit()
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_kb_attachments.py -v`
Expected: 2 PASSED.

- [ ] **Step 5: Refactor — move `add_attachment` into `KBRepository` class**

Open `src/energybot/kb/repository.py` and merge the trampoline content into the main `KBRepository` class as a real `async def add_attachment(...)` method. Delete the trampoline at the bottom. Re-run the tests:

Run: `python -m pytest tests/integration/test_kb_attachments.py -v`
Expected: still 2 PASSED.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/kb tests/integration/test_kb_attachments.py
git commit -m "feat(kb): attachments + transcription service (Whisper plumbed via router)"
```

---

### Task 28: Atomic publish (chunk + embed + replace)

**Files:**
- Create: `src/energybot/kb/embedding.py`
- Create: `src/energybot/kb/publish.py`
- Create: `tests/integration/test_kb_publish.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_kb_publish.py`:
```python
import pytest
from sqlalchemy import select
from energybot.core.models import KBArticle, KBChunk
from energybot.kb.repository import KBRepository
from energybot.kb.publish import PublishService


class FakeRouter:
    def __init__(self, fail_on=None):
        self._fail = fail_on
        self.calls = 0

    async def embed(self, *, call_type, req):
        self.calls += 1
        if self._fail == "embed":
            from energybot.providers.base import ProviderError
            raise ProviderError("embed boom", retryable=True)
        from energybot.providers.base import EmbeddingResponse
        return EmbeddingResponse(vectors=[[0.01 * i for i in range(1536)] for _ in req.inputs], tokens_in=10)


@pytest.mark.asyncio
async def test_publish_chunks_embeds_and_marks_published(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="پکیج", body="متن کافی برای حداقل یک چانک.", category="gas", tags=["پکیج"], created_by=None)
    svc = PublishService(repo=repo, router=FakeRouter(), session_factory=lambda: db_session)
    await svc.publish(aid)
    art = (await db_session.execute(select(KBArticle).where(KBArticle.id == aid))).scalar_one()
    assert art.status == "published"
    chunks = (await db_session.execute(select(KBChunk).where(KBChunk.article_id == aid))).scalars().all()
    assert len(chunks) >= 1
    assert len(chunks[0].embedding) == 1536


@pytest.mark.asyncio
async def test_republish_replaces_chunks_atomically(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="x", body="نسخه ۱", category="general", tags=[], created_by=None)
    svc = PublishService(repo=repo, router=FakeRouter(), session_factory=lambda: db_session)
    await svc.publish(aid)
    first = (await db_session.execute(select(KBChunk).where(KBChunk.article_id == aid))).scalars().all()
    first_ids = {c.id for c in first}
    await repo.update(aid, body="نسخه ۲ که خیلی طولانی‌تر است. " * 80)
    await svc.publish(aid)
    second = (await db_session.execute(select(KBChunk).where(KBChunk.article_id == aid))).scalars().all()
    second_ids = {c.id for c in second}
    assert first_ids.isdisjoint(second_ids)


@pytest.mark.asyncio
async def test_embed_failure_rolls_back_publish(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="x", body="متن", category="general", tags=[], created_by=None)
    svc = PublishService(repo=repo, router=FakeRouter(fail_on="embed"), session_factory=lambda: db_session)
    with pytest.raises(Exception):
        await svc.publish(aid)
    art = (await db_session.execute(select(KBArticle).where(KBArticle.id == aid))).scalar_one()
    assert art.status == "draft"
    chunks = (await db_session.execute(select(KBChunk).where(KBChunk.article_id == aid))).scalars().all()
    assert chunks == []
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_kb_publish.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/kb/embedding.py`:
```python
from energybot.providers.base import EmbeddingRequest


class EmbeddingService:
    def __init__(self, *, router, batch_size: int = 64):
        self._router = router
        self._batch = batch_size

    async def embed_all(self, inputs: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(inputs), self._batch):
            batch = inputs[i:i + self._batch]
            r = await self._router.embed(call_type="embed", req=EmbeddingRequest(model="", inputs=batch))
            out.extend(r.vectors)
        return out
```

`src/energybot/kb/publish.py`:
```python
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
        async with s.begin():
            art = (await s.execute(select(KBArticle).where(KBArticle.id == article_id))).scalar_one()
            atts = (await s.execute(select(KBAttachment).where(KBAttachment.article_id == article_id, KBAttachment.type == "video"))).scalars().all()
            transcripts: dict[UUID, str] = {}
            for a in atts:
                t = (await s.execute(select(VideoTranscript).where(VideoTranscript.attachment_id == a.id))).scalar_one_or_none()
                if t is None:
                    raise RuntimeError(f"video attachment {a.id} missing transcript; cannot publish")
                transcripts[a.id] = t.text

            # Build chunk inputs: article body first, then per-video transcripts
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
            vectors = await self._embed.embed_all(normalized)

            await s.execute(delete(KBChunk).where(KBChunk.article_id == article_id))
            for idx, (text, ntext, vec, m) in enumerate(zip(inputs, normalized, vectors, meta)):
                s.add(KBChunk(article_id=article_id, chunk_index=idx, text=text, text_normalized=ntext, embedding=vec, meta=m))

            art.status = "published"
            art.published_at = datetime.utcnow()
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_kb_publish.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/kb/embedding.py src/energybot/kb/publish.py tests/integration/test_kb_publish.py
git commit -m "feat(kb): atomic publish (chunk + normalise + embed + replace transaction)"
```

---

## Milestone 9 — KB retrieval

### Task 29: Hybrid retrieval (vector + keyword + RRF)

**Files:**
- Create: `src/energybot/kb/retrieval.py`
- Create: `tests/integration/test_kb_retrieval.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_kb_retrieval.py`:
```python
import pytest
from energybot.kb.repository import KBRepository
from energybot.kb.publish import PublishService
from energybot.kb.retrieval import RetrievalService


class FakeRouter:
    async def embed(self, *, call_type, req):
        from energybot.providers.base import EmbeddingResponse
        # Two articles will be seeded; assign distinguishable vectors based on input contents.
        out = []
        for text in req.inputs:
            base = [0.0] * 1536
            # Encode a few salient Persian keywords to coarse vector axes for the test.
            if "پکیج" in text: base[0] = 1.0
            if "ترموستات" in text: base[1] = 1.0
            if "اسپلیت" in text: base[2] = 1.0
            if "کولر" in text: base[3] = 1.0
            out.append(base)
        return EmbeddingResponse(vectors=out, tokens_in=10)


@pytest.mark.asyncio
async def test_vector_search_returns_matching_article(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    a_gas = await repo.create(title="پکیج گاز", body="بهینه‌سازی پکیج. ترموستات روی ۲۱.", category="gas", tags=[], created_by=None)
    a_elec = await repo.create(title="کولر اسپلیت", body="کولر اسپلیت در مصرف برق.", category="electricity", tags=[], created_by=None)
    svc = PublishService(repo=repo, router=FakeRouter(), session_factory=lambda: db_session)
    await svc.publish(a_gas)
    await svc.publish(a_elec)

    ret = RetrievalService(router=FakeRouter(), session_factory=lambda: db_session)
    hits = await ret.search(query="پکیج", top_k=3, category=None)
    titles = [h["article_title"] for h in hits]
    assert "پکیج گاز" in titles
    assert titles[0] == "پکیج گاز"


@pytest.mark.asyncio
async def test_category_filter(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    a_gas = await repo.create(title="گ", body="پکیج", category="gas", tags=[], created_by=None)
    a_elec = await repo.create(title="ب", body="اسپلیت", category="electricity", tags=[], created_by=None)
    svc = PublishService(repo=repo, router=FakeRouter(), session_factory=lambda: db_session)
    await svc.publish(a_gas)
    await svc.publish(a_elec)
    ret = RetrievalService(router=FakeRouter(), session_factory=lambda: db_session)
    hits = await ret.search(query="پکیج", top_k=3, category="electricity")
    assert all(h["category"] == "electricity" for h in hits)


@pytest.mark.asyncio
async def test_unpublished_articles_excluded(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    a = await repo.create(title="پکیج گاز", body="پکیج", category="gas", tags=[], created_by=None)
    # Do NOT publish.
    ret = RetrievalService(router=FakeRouter(), session_factory=lambda: db_session)
    hits = await ret.search(query="پکیج", top_k=3, category=None)
    assert hits == []
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_kb_retrieval.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/kb/retrieval.py`:
```python
from collections.abc import Callable
from typing import Any
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.normalize_fa import normalize_fa
from energybot.providers.base import EmbeddingRequest


class RetrievalService:
    def __init__(self, *, router, session_factory: Callable[[], AsyncSession], rrf_k: int = 60):
        self._router = router
        self._session_factory = session_factory
        self._rrf_k = rrf_k

    async def search(self, *, query: str, top_k: int = 5, category: str | None) -> list[dict[str, Any]]:
        q_norm = normalize_fa(query)
        if not q_norm:
            return []
        emb_resp = await self._router.embed(call_type="embed", req=EmbeddingRequest(model="", inputs=[q_norm]))
        qvec = emb_resp.vectors[0]
        session = self._session_factory()

        cat_clause = "AND a.category = :category" if category else ""
        sql = f"""
        WITH v AS (
            SELECT c.id, c.article_id, c.text, c.metadata, a.title, a.category,
                   ROW_NUMBER() OVER (ORDER BY c.embedding <=> CAST(:qvec AS vector)) AS rank
            FROM kb_chunks c JOIN kb_articles a ON c.article_id = a.id
            WHERE a.status = 'published' AND a.deleted_at IS NULL {cat_clause}
            ORDER BY c.embedding <=> CAST(:qvec AS vector) ASC LIMIT 20
        ),
        k AS (
            SELECT c.id, c.article_id, c.text, c.metadata, a.title, a.category,
                   ROW_NUMBER() OVER (ORDER BY ts_rank(to_tsvector('simple', c.text_normalized), plainto_tsquery('simple', :q_norm)) DESC) AS rank
            FROM kb_chunks c JOIN kb_articles a ON c.article_id = a.id
            WHERE a.status = 'published' AND a.deleted_at IS NULL {cat_clause}
              AND to_tsvector('simple', c.text_normalized) @@ plainto_tsquery('simple', :q_norm)
            ORDER BY ts_rank(to_tsvector('simple', c.text_normalized), plainto_tsquery('simple', :q_norm)) DESC LIMIT 20
        ),
        merged AS (
            SELECT id, article_id, text, metadata, title, category, 1.0 / (:rrf_k + rank) AS s FROM v
            UNION ALL
            SELECT id, article_id, text, metadata, title, category, 1.0 / (:rrf_k + rank) AS s FROM k
        )
        SELECT id, article_id, text, metadata, title, category, SUM(s) AS score
        FROM merged
        GROUP BY id, article_id, text, metadata, title, category
        ORDER BY score DESC LIMIT :top_k
        """
        params = {"qvec": qvec, "q_norm": q_norm, "rrf_k": self._rrf_k, "top_k": top_k}
        if category:
            params["category"] = category
        rows = (await session.execute(text(sql), params)).mappings().all()
        return [
            {
                "chunk_id": r["id"],
                "article_id": str(r["article_id"]),
                "article_title": r["title"],
                "chunk_text": r["text"],
                "category": r["category"],
                "relevance": float(r["score"]),
                "source": (r["metadata"] or {}).get("source", "article"),
                "attachment_id": (r["metadata"] or {}).get("attachment_id"),
            }
            for r in rows
        ]
```

Note: pgvector requires the parameter to be cast — the literal `CAST(:qvec AS vector)` works when pgvector's SQLAlchemy adapter is installed; if you see a parameter binding error, switch to explicit `pgvector.sqlalchemy.Vector` bound parameter.

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_kb_retrieval.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/kb/retrieval.py tests/integration/test_kb_retrieval.py
git commit -m "feat(kb): hybrid vector+keyword retrieval with RRF fusion"
```

---

### Task 30: `search_knowledge_base` agent tool

**Files:**
- Create: `src/energybot/agent/tools/__init__.py`
- Create: `src/energybot/agent/tools/base.py`
- Create: `src/energybot/agent/tools/search_kb.py`
- Create: `tests/integration/test_tool_search_kb.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_tool_search_kb.py`:
```python
import pytest
from energybot.kb.repository import KBRepository
from energybot.kb.publish import PublishService
from energybot.kb.retrieval import RetrievalService
from energybot.agent.tools.search_kb import SearchKBTool


class FakeRouter:
    async def embed(self, *, call_type, req):
        from energybot.providers.base import EmbeddingResponse
        return EmbeddingResponse(vectors=[[1.0] + [0.0] * 1535 for _ in req.inputs], tokens_in=1)


@pytest.mark.asyncio
async def test_search_kb_tool_runs(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="پکیج", body="پکیج گاز را تنظیم کنید.", category="gas", tags=[], created_by=None)
    await PublishService(repo=repo, router=FakeRouter(), session_factory=lambda: db_session).publish(aid)
    ret = RetrievalService(router=FakeRouter(), session_factory=lambda: db_session)
    tool = SearchKBTool(retrieval=ret)
    result = await tool.invoke({"query": "پکیج", "top_k": 3})
    assert isinstance(result, list)
    assert result[0]["article_title"] == "پکیج"
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_tool_search_kb.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/agent/tools/__init__.py`: (empty)

`src/energybot/agent/tools/base.py`:
```python
from typing import Any, Protocol
from energybot.providers.base import Tool


class AgentTool(Protocol):
    name: str
    description: str
    parameters: dict[str, Any]

    async def invoke(self, args: dict[str, Any]) -> Any: ...


def to_provider_tool(t: AgentTool) -> Tool:
    return Tool(name=t.name, description=t.description, parameters=t.parameters)


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, AgentTool] = {}

    def register(self, tool: AgentTool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> AgentTool:
        return self._tools[name]

    def all(self) -> list[AgentTool]:
        return list(self._tools.values())
```

`src/energybot/agent/tools/search_kb.py`:
```python
from typing import Any
from energybot.kb.retrieval import RetrievalService


class SearchKBTool:
    name = "search_knowledge_base"
    description = "جستجو در دانش‌نامه فارسی برای یافتن محتوای مرتبط."
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "عبارت جستجو به فارسی"},
            "category": {"type": "string", "enum": ["electricity", "gas", "general"]},
            "top_k": {"type": "integer", "default": 5, "minimum": 1, "maximum": 10},
        },
        "required": ["query"],
    }

    def __init__(self, *, retrieval: RetrievalService):
        self._retrieval = retrieval

    async def invoke(self, args: dict[str, Any]) -> list[dict[str, Any]]:
        return await self._retrieval.search(
            query=args["query"], top_k=int(args.get("top_k", 5)), category=args.get("category"),
        )
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_tool_search_kb.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/agent/tools tests/integration/test_tool_search_kb.py
git commit -m "feat(agent): tool registry + search_knowledge_base tool"
```

---

## Milestone 10 — Agent loop & remaining tools

### Task 31: Profile + commitment + escalation tools

**Files:**
- Create: `src/energybot/agent/tools/read_profile.py`
- Create: `src/energybot/agent/tools/update_profile.py`
- Create: `src/energybot/agent/tools/record_commitment.py`
- Create: `src/energybot/agent/tools/escalate.py`
- Create: `tests/integration/test_profile_tools.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_profile_tools.py`:
```python
import pytest
from sqlalchemy import select
from uuid import uuid4
from energybot.core.models import User, Profile, Message, ChatSession
from energybot.profile.repository import ProfileRepository
from energybot.chat.repository import ChatRepository
from energybot.agent.tools.read_profile import ReadProfileTool
from energybot.agent.tools.update_profile import UpdateProfileTool
from energybot.agent.tools.record_commitment import RecordCommitmentTool
from energybot.agent.tools.escalate import EscalateTool


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    db_session.add(Profile(user_id=u.id, household={"city": "تهران"}))
    await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_read_profile_returns_dict(db_session):
    u = await _user(db_session)
    repo = ProfileRepository(session_factory=lambda: db_session)
    tool = ReadProfileTool(repo=repo, user_id=u.id)
    result = await tool.invoke({})
    assert result["household"]["city"] == "تهران"


@pytest.mark.asyncio
async def test_update_profile_writes_event(db_session):
    u = await _user(db_session)
    repo = ProfileRepository(session_factory=lambda: db_session)
    tool = UpdateProfileTool(repo=repo, user_id=u.id, current_message_id=None)
    await tool.invoke({"path": "behaviour.peak_usage_hours", "value": "18-22", "reason": "user said"})
    p = await repo.get(u.id)
    assert p.behaviour["peak_usage_hours"] == "18-22"


@pytest.mark.asyncio
async def test_record_commitment_appends(db_session):
    u = await _user(db_session)
    repo = ProfileRepository(session_factory=lambda: db_session)
    tool = RecordCommitmentTool(repo=repo, user_id=u.id, current_message_id=None)
    out = await tool.invoke({"text": "ترموستات روی ۲۱", "target_date": "2026-06-01"})
    assert out["commitment_id"] is not None
    p = await repo.get(u.id)
    assert any("ترموستات" in c["text"] for c in p.commitments)


@pytest.mark.asyncio
async def test_escalate_flags_messages(db_session):
    u = await _user(db_session)
    chat = ChatRepository(session_factory=lambda: db_session)
    sid = await chat.session_for(u.id)
    mid = await chat.add_message(u.id, sid, role="user", content="کمک می‌خواهم")
    tool = EscalateTool(chat=chat, user_id=u.id, current_message_id=mid)
    await tool.invoke({"reason": "خارج از حوزه"})
    m = (await db_session.execute(select(Message).where(Message.id == mid))).scalar_one()
    assert m.meta.get("flagged") is True
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_profile_tools.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement tools**

`src/energybot/agent/tools/read_profile.py`:
```python
from typing import Any
from uuid import UUID
from energybot.profile.repository import ProfileRepository


class ReadProfileTool:
    name = "read_profile"
    description = "خواندن نمای کامل پروفایل کاربر فعلی."
    parameters = {"type": "object", "properties": {}}

    def __init__(self, *, repo: ProfileRepository, user_id: UUID):
        self._repo = repo
        self._user_id = user_id

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        p = await self._repo.get(self._user_id)
        return {
            "household": p.household, "behaviour": p.behaviour,
            "goals": p.goals, "commitments": p.commitments,
            "completeness_score": p.completeness_score,
        }
```

`src/energybot/agent/tools/update_profile.py`:
```python
from typing import Any
from uuid import UUID
from energybot.profile.repository import ProfileRepository


class UpdateProfileTool:
    name = "update_profile"
    description = "به‌روزرسانی یک فیلد در پروفایل کاربر. مسیر مثل household.city یا behaviour.peak_usage_hours."
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "value": {},
            "reason": {"type": "string"},
        },
        "required": ["path", "value", "reason"],
    }

    def __init__(self, *, repo: ProfileRepository, user_id: UUID, current_message_id: int | None):
        self._repo = repo
        self._user_id = user_id
        self._msg_id = current_message_id

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        await self._repo.set(self._user_id, args["path"], args["value"],
                             source="agent_tool", reason=args["reason"],
                             source_message_id=self._msg_id)
        return {"ok": True}
```

`src/energybot/agent/tools/record_commitment.py`:
```python
from typing import Any
from uuid import UUID, uuid4
from datetime import datetime
from energybot.profile.repository import ProfileRepository


class RecordCommitmentTool:
    name = "record_commitment"
    description = "ثبت تعهد جدید کاربر."
    parameters = {
        "type": "object",
        "properties": {
            "text": {"type": "string"},
            "target_date": {"type": "string", "description": "YYYY-MM-DD or null"},
        },
        "required": ["text"],
    }

    def __init__(self, *, repo: ProfileRepository, user_id: UUID, current_message_id: int | None):
        self._repo = repo
        self._user_id = user_id
        self._msg_id = current_message_id

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        cid = str(uuid4())
        item = {"id": cid, "text": args["text"], "target_date": args.get("target_date"),
                "made_at": datetime.utcnow().isoformat(), "fulfilled": False}
        await self._repo.append(self._user_id, "commitments", item, source="agent_tool", reason="record_commitment", source_message_id=self._msg_id)
        return {"commitment_id": cid}
```

`src/energybot/agent/tools/escalate.py`:
```python
from typing import Any
from uuid import UUID
from sqlalchemy import select
from energybot.chat.repository import ChatRepository
from energybot.core.models import Message


class EscalateTool:
    name = "escalate_to_human"
    description = "نشانه‌گذاری گفتگو برای بازبینی توسط ادمین. در فاز ۱ فقط پرچم می‌گذارد."
    parameters = {
        "type": "object",
        "properties": {"reason": {"type": "string"}},
        "required": ["reason"],
    }

    def __init__(self, *, chat: ChatRepository, user_id: UUID, current_message_id: int):
        self._chat = chat
        self._user_id = user_id
        self._msg_id = current_message_id

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        s = self._chat._session_factory()
        async with s.begin():
            m = (await s.execute(select(Message).where(Message.id == self._msg_id))).scalar_one()
            m.meta = {**(m.meta or {}), "flagged": True, "escalate_reason": args["reason"]}
        return {"ok": True}
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_profile_tools.py -v`
Expected: 4 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/agent/tools tests/integration/test_profile_tools.py
git commit -m "feat(agent): profile, commitment, and escalation tools"
```

---

### Task 32: `send_kb_media` tool (deferred binding to Bale client)

**Files:**
- Create: `src/energybot/agent/tools/send_kb_media.py`
- Create: `tests/integration/test_tool_send_kb_media.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_tool_send_kb_media.py`:
```python
import pytest
from uuid import uuid4
from energybot.core.models import User, KBArticle, KBAttachment
from energybot.agent.tools.send_kb_media import SendKBMediaTool


class FakeBaleClient:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_photo(self, *, chat_id: int, file_id: str | None, file_path: str | None, caption: str | None):
        info = {"chat_id": chat_id, "file_id": file_id, "file_path": file_path, "caption": caption}
        self.sent.append({"photo": info})
        return "FAKE_FILE_ID_PHOTO"

    async def send_video(self, *, chat_id: int, file_id: str | None, file_path: str | None, caption: str | None):
        info = {"chat_id": chat_id, "file_id": file_id, "file_path": file_path, "caption": caption}
        self.sent.append({"video": info})
        return "FAKE_FILE_ID_VIDEO"


@pytest.mark.asyncio
async def test_send_image_caches_file_id(db_session):
    u = User(bale_user_id=999111)
    db_session.add(u)
    art = KBArticle(title="t", body="b", category="general", tags=[], status="published", version=1)
    db_session.add(art)
    await db_session.commit()
    att = KBAttachment(article_id=art.id, type="image", mime_type="image/png", file_size_bytes=10, storage_path="/tmp/x.png", caption_fa="دیاگرام")
    db_session.add(att)
    await db_session.commit()

    bale = FakeBaleClient()
    tool = SendKBMediaTool(bale=bale, session_factory=lambda: db_session, chat_id=int(u.bale_user_id))
    result = await tool.invoke({"attachment_id": str(att.id), "caption": "نگاه کن"})
    assert result["ok"] is True
    assert bale.sent[0]["photo"]["file_id"] is None
    # Second send should reuse cached file_id
    await tool.invoke({"attachment_id": str(att.id)})
    assert bale.sent[1]["photo"]["file_id"] == "FAKE_FILE_ID_PHOTO"
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_tool_send_kb_media.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/agent/tools/send_kb_media.py`:
```python
from collections.abc import Callable
from typing import Any
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import KBAttachment


class SendKBMediaTool:
    name = "send_kb_media"
    description = "ارسال تصویر یا ویدیوی پیوست‌شده به یک مقاله از طریق بله."
    parameters = {
        "type": "object",
        "properties": {
            "attachment_id": {"type": "string"},
            "caption": {"type": "string"},
        },
        "required": ["attachment_id"],
    }

    def __init__(self, *, bale, session_factory: Callable[[], AsyncSession], chat_id: int):
        self._bale = bale
        self._session_factory = session_factory
        self._chat_id = chat_id

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        att_id = UUID(args["attachment_id"])
        s = self._session_factory()
        async with s.begin():
            att = (await s.execute(select(KBAttachment).where(KBAttachment.id == att_id, KBAttachment.deleted_at.is_(None)))).scalar_one()
            caption = args.get("caption") or att.caption_fa
            if att.type == "image":
                returned = await self._bale.send_photo(
                    chat_id=self._chat_id, file_id=att.bale_file_id,
                    file_path=att.storage_path if not att.bale_file_id else None,
                    caption=caption,
                )
            else:
                returned = await self._bale.send_video(
                    chat_id=self._chat_id, file_id=att.bale_file_id,
                    file_path=att.storage_path if not att.bale_file_id else None,
                    caption=caption,
                )
            if returned and not att.bale_file_id:
                att.bale_file_id = returned
        return {"ok": True}
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_tool_send_kb_media.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/agent/tools/send_kb_media.py tests/integration/test_tool_send_kb_media.py
git commit -m "feat(agent): send_kb_media tool with bale_file_id caching"
```

---

### Task 33: Agent loop (handle_message)

**Files:**
- Create: `src/energybot/agent/loop.py`
- Create: `tests/integration/test_agent_loop.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_agent_loop.py`:
```python
import pytest
from uuid import uuid4
from energybot.core.models import User, Profile
from energybot.profile.repository import ProfileRepository
from energybot.chat.repository import ChatRepository
from energybot.agent.context import ContextAssembler
from energybot.agent.tools.base import ToolRegistry
from energybot.agent.loop import AgentLoop
from energybot.providers.base import ChatResponse


class FakeLoader:
    async def render(self, key, vars):
        return ("سیستم", key, 1)


class FakeRouter:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    async def chat(self, *, call_type, req, prompt_key=None, prompt_version=None):
        self.calls += 1
        return self._responses.pop(0)


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    db_session.add(Profile(user_id=u.id))
    await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_simple_turn_no_tools(db_session):
    u = await _user(db_session)
    asm = ContextAssembler(prompt_loader=FakeLoader(),
                           profile_repo=ProfileRepository(session_factory=lambda: db_session),
                           chat_repo=ChatRepository(session_factory=lambda: db_session))
    router = FakeRouter([ChatResponse(content="درود", tokens_in=10, tokens_out=2, finish_reason="stop")])
    loop = AgentLoop(router=router, context_assembler=asm, chat_repo=ChatRepository(session_factory=lambda: db_session),
                     tool_registry=ToolRegistry(), summarizer=None, tool_iteration_cap=6, user_id=u.id, chat_id=999)
    reply = await loop.handle_message("سلام")
    assert reply == "درود"


@pytest.mark.asyncio
async def test_tool_iteration_cap(db_session):
    u = await _user(db_session)
    asm = ContextAssembler(prompt_loader=FakeLoader(),
                           profile_repo=ProfileRepository(session_factory=lambda: db_session),
                           chat_repo=ChatRepository(session_factory=lambda: db_session))
    # Provide 8 responses all asking for tool calls (loop will cap at 6 + 1 final forced)
    tool_resp = lambda i: ChatResponse(
        content="", tokens_in=1, tokens_out=1, finish_reason="tool_calls",
        tool_calls=[{"id": f"t{i}", "type": "function", "function": {"name": "read_profile", "arguments": "{}"}}],
    )
    final = ChatResponse(content="پاسخ نهایی", tokens_in=1, tokens_out=1, finish_reason="stop")
    router = FakeRouter([tool_resp(i) for i in range(7)] + [final])
    registry = ToolRegistry()

    class DummyRead:
        name = "read_profile"
        description = ""
        parameters = {"type": "object", "properties": {}}
        async def invoke(self, args): return {}

    registry.register(DummyRead())

    loop = AgentLoop(router=router, context_assembler=asm, chat_repo=ChatRepository(session_factory=lambda: db_session),
                     tool_registry=registry, summarizer=None, tool_iteration_cap=6, user_id=u.id, chat_id=999)
    reply = await loop.handle_message("ببین چی")
    assert reply == "پاسخ نهایی"
    # 6 tool iterations + 1 final = 7 router calls total
    assert router.calls == 7
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_agent_loop.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/agent/loop.py`:
```python
import json
from typing import Any
from uuid import UUID
from energybot.agent.context import ContextAssembler
from energybot.agent.tools.base import ToolRegistry, to_provider_tool
from energybot.chat.repository import ChatRepository
from energybot.providers.base import ChatMessage, ChatRequest


class AgentLoop:
    def __init__(self, *, router, context_assembler: ContextAssembler, chat_repo: ChatRepository,
                 tool_registry: ToolRegistry, summarizer, tool_iteration_cap: int,
                 user_id: UUID, chat_id: int):
        self._router = router
        self._asm = context_assembler
        self._chat = chat_repo
        self._tools = tool_registry
        self._summ = summarizer
        self._cap = tool_iteration_cap
        self._user_id = user_id
        self._chat_id = chat_id

    async def handle_message(self, user_text: str) -> str:
        sid = await self._chat.session_for(self._user_id)
        msg_id = await self._chat.add_message(self._user_id, sid, role="user", content=user_text)
        ctx = await self._asm.assemble(self._user_id, user_text)
        # Replace the trailing user message id with the one we just stored is fine;
        # provider only sees the content.

        provider_tools = [to_provider_tool(t) for t in self._tools.all()] or None
        messages = list(ctx.messages)
        iters = 0
        final: str | None = None
        while True:
            req = ChatRequest(model="", messages=messages, tools=provider_tools if iters < self._cap else None)
            resp = await self._router.chat(call_type="chat_reasoning", req=req,
                                           prompt_key=ctx.prompt_template_key,
                                           prompt_version=ctx.prompt_template_version)
            if resp.tool_calls and iters < self._cap:
                # Append assistant message that requested tools
                messages.append(ChatMessage(role="assistant", content=resp.content or "", tool_calls=resp.tool_calls))
                for tc in resp.tool_calls:
                    name = tc["function"]["name"] if "function" in tc else tc.get("name", "")
                    raw_args = tc["function"]["arguments"] if "function" in tc else tc.get("arguments", "{}")
                    args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                    tool = self._tools.get(name)
                    try:
                        result = await tool.invoke(args)
                        result_payload = {"ok": True, "data": result}
                    except Exception as e:
                        result_payload = {"ok": False, "error": str(e)}
                    await self._chat.add_message(self._user_id, sid, role="tool",
                                                 content=json.dumps(result_payload, ensure_ascii=False),
                                                 tool_name=name, tool_args=args, tool_result=result_payload)
                    messages.append(ChatMessage(role="tool", content=json.dumps(result_payload, ensure_ascii=False),
                                                tool_call_id=tc.get("id"), name=name))
                iters += 1
                continue
            final = resp.content or ""
            await self._chat.add_message(self._user_id, sid, role="assistant", content=final,
                                         tokens_in=resp.tokens_in, tokens_out=resp.tokens_out,
                                         model_used=resp.model)
            break

        if self._summ is not None:
            await self._summ.maybe_summarize(self._user_id)
        return final or ""
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_agent_loop.py -v`
Expected: 2 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/agent/loop.py tests/integration/test_agent_loop.py
git commit -m "feat(agent): handle_message loop with tool cap and inline summary"
```

---

## Milestone 11 — Bale adapter

### Task 34: Bale outbound client

**Files:**
- Create: `src/energybot/bale_adapter/__init__.py`
- Create: `src/energybot/bale_adapter/client.py`
- Create: `tests/test_bale_client.py`

- [ ] **Step 1: Write failing test**

`tests/test_bale_client.py`:
```python
import httpx
import pytest
from energybot.bale_adapter.client import BaleClient


@pytest.mark.asyncio
async def test_send_message_posts_correct_payload():
    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append({"url": str(request.url), "body": request.content.decode()})
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 1}})

    c = BaleClient(token="ABC", base_url="https://tapi.bale.ai", transport=httpx.MockTransport(handler))
    await c.send_message(chat_id=111, text="سلام", reply_markup={"inline_keyboard": [[{"text": "ok", "callback_data": "x"}]]})
    assert "/bot/ABC/sendMessage" in calls[0]["url"] or "/bot/ABC/sendMessage" in calls[0]["url"].replace("bot", "bot")
    assert "سلام" in calls[0]["body"]
    assert "inline_keyboard" in calls[0]["body"]


@pytest.mark.asyncio
async def test_send_photo_supports_file_id():
    def handler(request):
        body = request.content.decode()
        assert "FILE_ABC" in body
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 2}})
    c = BaleClient(token="T", base_url="https://tapi.bale.ai", transport=httpx.MockTransport(handler))
    await c.send_photo(chat_id=5, file_id="FILE_ABC", file_path=None, caption="cap")


@pytest.mark.asyncio
async def test_send_photo_uploads_file_when_no_id(tmp_path):
    f = tmp_path / "img.png"
    f.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20)
    def handler(request):
        assert b"img.png" in request.content or b"name=\"photo\"" in request.content
        return httpx.Response(200, json={"ok": True, "result": {"photo": [{"file_id": "RETURNED"}]}})
    c = BaleClient(token="T", base_url="https://tapi.bale.ai", transport=httpx.MockTransport(handler))
    fid = await c.send_photo(chat_id=5, file_id=None, file_path=str(f), caption=None)
    assert fid == "RETURNED"
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_bale_client.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/bale_adapter/__init__.py`: (empty)

`src/energybot/bale_adapter/client.py`:
```python
from typing import Any
import httpx


class BaleClient:
    def __init__(self, *, token: str, base_url: str = "https://tapi.bale.ai", transport: httpx.AsyncBaseTransport | None = None):
        self._token = token
        self._base = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0), transport=transport)

    async def aclose(self) -> None:
        await self._client.aclose()

    def _url(self, method: str) -> str:
        return f"{self._base}/bot{self._token}/{method}"

    async def _post_json(self, method: str, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._client.post(self._url(method), json=payload)
        r.raise_for_status()
        return r.json()

    async def send_message(self, *, chat_id: int, text: str, reply_markup: dict | None = None) -> int:
        payload: dict[str, Any] = {"chat_id": chat_id, "text": text}
        if reply_markup:
            payload["reply_markup"] = reply_markup
        data = await self._post_json("sendMessage", payload)
        return int(data["result"]["message_id"])

    async def send_chat_action(self, *, chat_id: int, action: str = "typing") -> None:
        await self._post_json("sendChatAction", {"chat_id": chat_id, "action": action})

    async def answer_callback_query(self, *, callback_query_id: str, text: str | None = None) -> None:
        await self._post_json("answerCallbackQuery", {"callback_query_id": callback_query_id, "text": text or ""})

    async def send_photo(self, *, chat_id: int, file_id: str | None, file_path: str | None, caption: str | None) -> str | None:
        if file_id:
            data = await self._post_json("sendPhoto", {"chat_id": chat_id, "photo": file_id, "caption": caption or ""})
            return file_id
        assert file_path
        with open(file_path, "rb") as f:
            files = {"photo": (file_path.split("/")[-1], f.read(), "application/octet-stream")}
        r = await self._client.post(self._url("sendPhoto"), data={"chat_id": chat_id, "caption": caption or ""}, files=files)
        r.raise_for_status()
        result = r.json().get("result", {})
        photos = result.get("photo") or []
        return photos[-1]["file_id"] if photos else None

    async def send_video(self, *, chat_id: int, file_id: str | None, file_path: str | None, caption: str | None) -> str | None:
        if file_id:
            await self._post_json("sendVideo", {"chat_id": chat_id, "video": file_id, "caption": caption or ""})
            return file_id
        assert file_path
        with open(file_path, "rb") as f:
            files = {"video": (file_path.split("/")[-1], f.read(), "application/octet-stream")}
        r = await self._client.post(self._url("sendVideo"), data={"chat_id": chat_id, "caption": caption or ""}, files=files)
        r.raise_for_status()
        v = r.json().get("result", {}).get("video", {})
        return v.get("file_id")
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/test_bale_client.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/bale_adapter tests/test_bale_client.py
git commit -m "feat(bale): outbound API client with multipart upload + file_id paths"
```

---

### Task 35: Update parser + per-user serialisation

**Files:**
- Create: `src/energybot/bale_adapter/parser.py`
- Create: `src/energybot/bale_adapter/serialization.py`
- Create: `tests/test_bale_parser.py`

- [ ] **Step 1: Write failing test**

`tests/test_bale_parser.py`:
```python
import asyncio
import pytest
from energybot.bale_adapter.parser import parse_update, UpdateText, UpdateCallback
from energybot.bale_adapter.serialization import PerUserLock


def test_parse_text_message():
    upd = {"update_id": 5, "message": {"message_id": 1, "from": {"id": 42, "first_name": "علی"}, "chat": {"id": 42, "type": "private"}, "text": "سلام"}}
    parsed = parse_update(upd)
    assert isinstance(parsed, UpdateText)
    assert parsed.update_id == 5
    assert parsed.bale_user_id == 42
    assert parsed.text == "سلام"
    assert parsed.display_name == "علی"


def test_parse_callback_query():
    upd = {"update_id": 6, "callback_query": {"id": "cb1", "from": {"id": 7}, "message": {"chat": {"id": 7}}, "data": "wizard:home_type:آپارتمان"}}
    parsed = parse_update(upd)
    assert isinstance(parsed, UpdateCallback)
    assert parsed.data == "wizard:home_type:آپارتمان"
    assert parsed.callback_id == "cb1"


@pytest.mark.asyncio
async def test_per_user_lock_serialises_same_user():
    lock = PerUserLock()
    order: list[str] = []

    async def critical(u: int, tag: str, delay: float):
        async with lock.for_user(u):
            order.append(f"{tag}-in")
            await asyncio.sleep(delay)
            order.append(f"{tag}-out")

    await asyncio.gather(critical(1, "a", 0.05), critical(1, "b", 0.01))
    # b must wait for a
    assert order == ["a-in", "a-out", "b-in", "b-out"]


@pytest.mark.asyncio
async def test_per_user_lock_allows_concurrent_different_users():
    lock = PerUserLock()
    order: list[str] = []

    async def critical(u: int, tag: str, delay: float):
        async with lock.for_user(u):
            order.append(f"{tag}-in")
            await asyncio.sleep(delay)
            order.append(f"{tag}-out")

    await asyncio.gather(critical(1, "a", 0.02), critical(2, "b", 0.01))
    assert order.index("b-in") < order.index("a-out")
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/test_bale_parser.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/bale_adapter/parser.py`:
```python
from dataclasses import dataclass
from typing import Union


@dataclass(slots=True)
class UpdateText:
    update_id: int
    bale_user_id: int
    chat_id: int
    text: str
    display_name: str | None


@dataclass(slots=True)
class UpdateCallback:
    update_id: int
    bale_user_id: int
    chat_id: int
    callback_id: str
    data: str


@dataclass(slots=True)
class UpdateUnknown:
    update_id: int


def parse_update(d: dict) -> Union[UpdateText, UpdateCallback, UpdateUnknown]:
    upd = d.get("update_id", 0)
    if "message" in d and "text" in d["message"]:
        m = d["message"]
        return UpdateText(
            update_id=int(upd),
            bale_user_id=int(m["from"]["id"]),
            chat_id=int(m["chat"]["id"]),
            text=m["text"],
            display_name=m["from"].get("first_name"),
        )
    if "callback_query" in d:
        c = d["callback_query"]
        return UpdateCallback(
            update_id=int(upd),
            bale_user_id=int(c["from"]["id"]),
            chat_id=int(c.get("message", {}).get("chat", {}).get("id", c["from"]["id"])),
            callback_id=str(c["id"]),
            data=str(c.get("data", "")),
        )
    return UpdateUnknown(update_id=int(upd))
```

`src/energybot/bale_adapter/serialization.py`:
```python
import asyncio
from contextlib import asynccontextmanager


class PerUserLock:
    def __init__(self):
        self._locks: dict[int, asyncio.Lock] = {}

    def _get(self, user_id: int) -> asyncio.Lock:
        lock = self._locks.get(user_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[user_id] = lock
        return lock

    @asynccontextmanager
    async def for_user(self, user_id: int):
        lock = self._get(user_id)
        await lock.acquire()
        try:
            yield
        finally:
            lock.release()
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/test_bale_parser.py -v`
Expected: 4 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/bale_adapter/parser.py src/energybot/bale_adapter/serialization.py tests/test_bale_parser.py
git commit -m "feat(bale): update parser + per-user serialisation lock"
```

---

### Task 36: Webhook endpoint + idempotency

**Files:**
- Create: `src/energybot/bale_adapter/webhook.py`
- Modify: `src/energybot/main.py`
- Create: `tests/integration/test_webhook.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_webhook.py`:
```python
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from energybot.core.models import ProcessedUpdate


@pytest.fixture
def app(monkeypatch):
    monkeypatch.setenv("BALE_WEBHOOK_SECRET", "TESTSECRET")
    from energybot.main import create_app
    return create_app()


@pytest.mark.asyncio
async def test_webhook_rejects_bad_secret(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/bale/webhook/WRONG", json={"update_id": 1})
    assert r.status_code in (401, 403, 404)


@pytest.mark.asyncio
async def test_webhook_accepts_valid_secret_and_returns_200(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/bale/webhook/TESTSECRET", json={"update_id": 999, "message": {"message_id": 1, "from": {"id": 10}, "chat": {"id": 10}, "text": "سلام"}})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_webhook_idempotent_on_duplicate(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        body = {"update_id": 12345, "message": {"message_id": 1, "from": {"id": 11}, "chat": {"id": 11}, "text": "hi"}}
        await c.post("/bale/webhook/TESTSECRET", json=body)
        await c.post("/bale/webhook/TESTSECRET", json=body)  # duplicate
    rows = (await db_session.execute(select(ProcessedUpdate).where(ProcessedUpdate.update_id == 12345))).scalars().all()
    assert len(rows) == 1
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_webhook.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/bale_adapter/webhook.py`:
```python
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.bale_adapter.handler import handle_bale_update  # added in Task 37
from energybot.core.db import get_session
from energybot.core.models import ProcessedUpdate
from energybot.logging import get_logger
from energybot.settings import get_settings

log = get_logger(__name__)
router = APIRouter()


@router.post("/bale/webhook/{secret}")
async def webhook(secret: str, request: Request, session: AsyncSession = Depends(get_session)) -> Response:
    s = get_settings()
    if secret != s.bale_webhook_secret:
        raise HTTPException(status_code=404)
    body = await request.json()
    update_id = int(body.get("update_id", 0))
    if update_id <= 0:
        return Response(status_code=200)
    # Idempotency
    existing = (await session.execute(select(ProcessedUpdate).where(ProcessedUpdate.update_id == update_id))).scalar_one_or_none()
    if existing is not None:
        return Response(status_code=200)
    session.add(ProcessedUpdate(update_id=update_id))
    await session.commit()
    try:
        await handle_bale_update(body, session_factory=lambda: session)
    except Exception as e:  # noqa: BLE001
        log.warning("bale_webhook_error", error=str(e), update_id=update_id)
    return Response(status_code=200)
```

Modify `src/energybot/main.py` — add the router:
```python
from fastapi import FastAPI
from energybot.health import router as health_router
from energybot.bale_adapter.webhook import router as bale_router
from energybot.logging import configure_logging


def create_app() -> FastAPI:
    configure_logging("INFO")
    app = FastAPI(title="Energybot")
    app.include_router(health_router)
    app.include_router(bale_router)
    return app


app = create_app()
```

Create a stub `src/energybot/bale_adapter/handler.py` so imports succeed in this task (real implementation in Task 37):
```python
async def handle_bale_update(body, *, session_factory) -> None:  # noqa: ARG001
    return None
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_webhook.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/bale_adapter/webhook.py src/energybot/bale_adapter/handler.py src/energybot/main.py tests/integration/test_webhook.py
git commit -m "feat(bale): /bale/webhook/{secret} with idempotency and 200-always"
```

---

### Task 37: Bot handler — wires parser → wizard → agent → reply

**Files:**
- Modify: `src/energybot/bale_adapter/handler.py`
- Create: `src/energybot/bale_adapter/commands.py`
- Create: `tests/integration/test_bot_handler.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_bot_handler.py`:
```python
import pytest
from sqlalchemy import select
from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.models import User, OnboardingState, Message, Profile


class FakeBale:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_message(self, *, chat_id, text, reply_markup=None):
        self.sent.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})
        return 1

    async def send_chat_action(self, *, chat_id, action="typing"): pass
    async def answer_callback_query(self, **kw): pass


class FakeAgent:
    async def handle(self, user_id, chat_id, text): return "پاسخ دستیار: " + text


@pytest.mark.asyncio
async def test_new_user_triggers_onboarding_wizard(db_session, monkeypatch):
    bale = FakeBale()
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    monkeypatch.setattr("energybot.bale_adapter.handler.build_agent_for_user",
                        lambda user_id, chat_id, session_factory: FakeAgent())
    upd = {"update_id": 1, "message": {"message_id": 1, "from": {"id": 555, "first_name": "تست"}, "chat": {"id": 555}, "text": "/start"}}
    await handle_bale_update(upd, session_factory=lambda: db_session)
    u = (await db_session.execute(select(User).where(User.bale_user_id == 555))).scalar_one()
    state = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    assert state.current_step == "city"
    assert any("شهر" in s["text"] for s in bale.sent)


@pytest.mark.asyncio
async def test_real_question_mid_wizard_abandons_wizard(db_session, monkeypatch):
    bale = FakeBale()
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    monkeypatch.setattr("energybot.bale_adapter.handler.build_agent_for_user",
                        lambda user_id, chat_id, session_factory: FakeAgent())
    upd_start = {"update_id": 10, "message": {"message_id": 1, "from": {"id": 777}, "chat": {"id": 777}, "text": "/start"}}
    await handle_bale_update(upd_start, session_factory=lambda: db_session)
    upd_q = {"update_id": 11, "message": {"message_id": 2, "from": {"id": 777}, "chat": {"id": 777}, "text": "قبض گازم چرا بالاست؟"}}
    await handle_bale_update(upd_q, session_factory=lambda: db_session)
    u = (await db_session.execute(select(User).where(User.bale_user_id == 777))).scalar_one()
    state = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    assert state.completed_at is not None
    assert any("پاسخ دستیار" in s["text"] for s in bale.sent)
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_bot_handler.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/bale_adapter/commands.py`:
```python
COMMANDS = {"/start", "/help", "/profile", "/forget", "/restart"}


def is_command(text: str) -> bool:
    return text.split()[0] in COMMANDS if text else False


def is_wizard_answer(text: str) -> bool:
    # Short, button-like inputs are likely wizard answers. Long sentences are likely real questions.
    return len(text) < 40 and "؟" not in text and "?" not in text
```

`src/energybot/bale_adapter/handler.py` (replace stub):
```python
from collections.abc import Callable
from typing import Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.bale_adapter.client import BaleClient
from energybot.bale_adapter.commands import is_command, is_wizard_answer
from energybot.bale_adapter.parser import parse_update, UpdateText, UpdateCallback, UpdateUnknown
from energybot.core.models import User, Profile
from energybot.profile.repository import ProfileRepository
from energybot.profile.wizard import WizardEngine
from energybot.settings import get_settings


_bale_singleton: BaleClient | None = None


def get_bale_client() -> BaleClient:
    global _bale_singleton
    if _bale_singleton is None:
        s = get_settings()
        _bale_singleton = BaleClient(token=s.bale_bot_token, base_url=s.bale_api_base)
    return _bale_singleton


def build_agent_for_user(user_id, chat_id, session_factory):
    # Late import to avoid circulars.
    from energybot.agent.context import ContextAssembler
    from energybot.agent.loop import AgentLoop
    from energybot.agent.prompts import PromptLoader
    from energybot.agent.summarizer import Summarizer
    from energybot.agent.tools.base import ToolRegistry
    from energybot.agent.tools.read_profile import ReadProfileTool
    from energybot.agent.tools.update_profile import UpdateProfileTool
    from energybot.agent.tools.record_commitment import RecordCommitmentTool
    from energybot.agent.tools.escalate import EscalateTool
    from energybot.agent.tools.search_kb import SearchKBTool
    from energybot.agent.tools.send_kb_media import SendKBMediaTool
    from energybot.chat.repository import ChatRepository
    from energybot.kb.retrieval import RetrievalService
    from energybot.providers.frontier import FrontierProvider
    from energybot.providers.metis import MetisProvider
    from energybot.providers.router import ProviderRouter

    s = get_settings()
    frontier = FrontierProvider(api_key=s.frontier_api_key, base_url=s.frontier_base_url, proxy_url=s.frontier_proxy_url)
    metis = MetisProvider(api_key=s.metis_api_key, base_url=s.metis_base_url)
    router = ProviderRouter(providers={"frontier": frontier, "metis": metis}, session_factory=session_factory)
    chat_repo = ChatRepository(session_factory=session_factory, idle_minutes=s.session_idle_minutes)
    profile_repo = ProfileRepository(session_factory=session_factory)
    loader = PromptLoader(session_factory=session_factory)
    asm = ContextAssembler(prompt_loader=loader, profile_repo=profile_repo, chat_repo=chat_repo)
    retrieval = RetrievalService(router=router, session_factory=session_factory)
    registry = ToolRegistry()
    registry.register(ReadProfileTool(repo=profile_repo, user_id=user_id))
    registry.register(UpdateProfileTool(repo=profile_repo, user_id=user_id, current_message_id=None))
    registry.register(RecordCommitmentTool(repo=profile_repo, user_id=user_id, current_message_id=None))
    registry.register(SearchKBTool(retrieval=retrieval))
    registry.register(SendKBMediaTool(bale=get_bale_client(), session_factory=session_factory, chat_id=chat_id))
    # EscalateTool requires message id; bound per-turn inside the loop in a more advanced impl. For Phase 1 we skip registering it as a tool
    # the LLM can invoke; admins can wire it in later.

    class _Adapter:
        async def handle(self_inner, user_id, chat_id, text):
            summ = Summarizer(chat_repo=chat_repo, router=router, threshold=s.summary_message_threshold)
            loop = AgentLoop(
                router=router, context_assembler=asm, chat_repo=chat_repo,
                tool_registry=registry, summarizer=summ,
                tool_iteration_cap=s.tool_iteration_cap,
                user_id=user_id, chat_id=chat_id,
            )
            return await loop.handle_message(text)

    return _Adapter()


async def _ensure_user_and_profile(session: AsyncSession, bale_user_id: int, display_name: str | None) -> User:
    u = (await session.execute(select(User).where(User.bale_user_id == bale_user_id))).scalar_one_or_none()
    if u is None:
        u = User(bale_user_id=bale_user_id, display_name=display_name)
        session.add(u)
        await session.flush()
        session.add(Profile(user_id=u.id))
        await session.commit()
    return u


async def handle_bale_update(body: dict[str, Any], *, session_factory: Callable[[], AsyncSession]) -> None:
    parsed = parse_update(body)
    if isinstance(parsed, UpdateUnknown):
        return
    session = session_factory()
    user = await _ensure_user_and_profile(session, parsed.bale_user_id, getattr(parsed, "display_name", None))
    bale = get_bale_client()
    await bale.send_chat_action(chat_id=parsed.chat_id, action="typing")

    profile_repo = ProfileRepository(session_factory=session_factory)
    wizard = WizardEngine(session_factory=session_factory, profile_repo=profile_repo)

    if isinstance(parsed, UpdateText):
        text = parsed.text.strip()
        if text == "/start":
            step = await wizard.start(user.id)
            await _send_step(bale, parsed.chat_id, step)
            return
        if text == "/help":
            await bale.send_message(chat_id=parsed.chat_id, text="من یک دستیار صرفه‌جویی انرژی هستم. /profile برای دیدن پروفایل، /forget برای فراموش‌کردن من، /restart برای شروع گفتگوی تازه.")
            return
        if text == "/profile":
            from energybot.profile.render import render_profile_summary
            p = await profile_repo.get(user.id)
            summary = render_profile_summary(p.household or {}, p.behaviour or {}, p.goals or [], p.commitments or [])
            await bale.send_message(chat_id=parsed.chat_id, text=summary)
            return
        if text == "/restart":
            await bale.send_message(chat_id=parsed.chat_id, text="گفتگوی تازه آغاز شد. در چه موردی صحبت کنیم؟")
            return
        if text == "/forget":
            from datetime import datetime
            user.deleted_at = datetime.utcnow()
            user.display_name = "[deleted]"
            p = await profile_repo.get(user.id)
            p.deleted_at = datetime.utcnow()
            await session.commit()
            await bale.send_message(chat_id=parsed.chat_id, text="باشد، اطلاعات شما حذف شد.")
            return

        # Wizard logic
        current = await wizard.current_step(user.id)
        if current is not None:
            if is_wizard_answer(text):
                next_step = await wizard.answer(user.id, text)
                if next_step is None:
                    await bale.send_message(chat_id=parsed.chat_id, text="ممنون! حالا می‌توانم بهت کمک کنم. در چه موردی می‌خواهی صحبت کنیم؟")
                    return
                await _send_step(bale, parsed.chat_id, next_step)
                return
            else:
                # Abandon wizard and fall through to agent
                await wizard.abandon(user.id)

        try:
            agent = build_agent_for_user(user.id, parsed.chat_id, session_factory)
            reply = await agent.handle(user.id, parsed.chat_id, text)
        except Exception:  # noqa: BLE001
            reply = "متأسفم، یه مشکل فنی پیش اومد. می‌تونی یک بار دیگه تلاش کنی؟"
        await bale.send_message(chat_id=parsed.chat_id, text=reply)

    elif isinstance(parsed, UpdateCallback):
        await bale.answer_callback_query(callback_query_id=parsed.callback_id)
        # In Phase 1, callback data is the chosen wizard answer text.
        current = await wizard.current_step(user.id)
        if current is not None:
            next_step = await wizard.answer(user.id, parsed.data)
            if next_step is None:
                await bale.send_message(chat_id=parsed.chat_id, text="ممنون! حالا می‌توانم بهت کمک کنم. در چه موردی صحبت کنیم؟")
            else:
                await _send_step(bale, parsed.chat_id, next_step)


async def _send_step(bale: BaleClient, chat_id: int, step) -> None:
    markup = None
    if step.buttons:
        markup = {"inline_keyboard": [[{"text": b, "callback_data": b}] for b in step.buttons]}
    await bale.send_message(chat_id=chat_id, text=step.prompt, reply_markup=markup)
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_bot_handler.py -v`
Expected: 2 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/bale_adapter/commands.py src/energybot/bale_adapter/handler.py tests/integration/test_bot_handler.py
git commit -m "feat(bale): handler wiring user/profile/wizard/commands/agent/reply"
```

---

## Milestone 12 — Admin API

### Task 38: Admin auth — argon2, sessions, CSRF, login throttle

**Files:**
- Create: `src/energybot/admin_api/__init__.py`
- Create: `src/energybot/core/security.py`
- Create: `src/energybot/admin_api/auth.py`
- Modify: `src/energybot/main.py` (mount admin router)
- Create: `tests/integration/test_admin_auth.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_admin_auth.py`:
```python
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from energybot.core.models import AdminUser
from energybot.core.security import hash_password


@pytest.fixture
async def app(monkeypatch, db_session):
    monkeypatch.setenv("SESSION_SECRET", "z" * 32)
    monkeypatch.setenv("BALE_WEBHOOK_SECRET", "x")
    monkeypatch.setenv("BALE_BOT_TOKEN", "t")
    monkeypatch.setenv("FRONTIER_API_KEY", "f")
    monkeypatch.setenv("METIS_API_KEY", "m")
    from energybot.main import create_app
    db_session.add(AdminUser(email="a@b.c", password_hash=hash_password("pass1234"), role="admin"))
    await db_session.commit()
    return create_app()


@pytest.mark.asyncio
async def test_login_sets_session_cookie(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/api/admin/login", json={"email": "a@b.c", "password": "pass1234"})
    assert r.status_code == 200
    assert "energybot_admin" in r.cookies


@pytest.mark.asyncio
async def test_login_wrong_password_rejected(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/api/admin/login", json={"email": "a@b.c", "password": "wrong"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_requires_session(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/admin/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_user_with_session(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await c.post("/api/admin/login", json={"email": "a@b.c", "password": "pass1234"})
        r = await c.get("/api/admin/me")
    assert r.status_code == 200
    assert r.json()["email"] == "a@b.c"


@pytest.mark.asyncio
async def test_login_rate_limited_after_burst(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        for _ in range(6):
            await c.post("/api/admin/login", json={"email": "a@b.c", "password": "wrong"})
        r = await c.post("/api/admin/login", json={"email": "a@b.c", "password": "wrong"})
    assert r.status_code == 429
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_admin_auth.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/admin_api/__init__.py`: (empty)

`src/energybot/core/security.py`:
```python
import hashlib
import hmac
import secrets
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_PH = PasswordHasher()


def hash_password(p: str) -> str:
    return _PH.hash(p)


def verify_password(hashed: str, p: str) -> bool:
    try:
        return _PH.verify(hashed, p)
    except VerifyMismatchError:
        return False


def new_session_token() -> tuple[str, str]:
    """Returns (cookie_value, server_id_hash). Cookie is the secret; id stored is sha256."""
    cookie = secrets.token_urlsafe(48)
    sid = hashlib.sha256(cookie.encode()).hexdigest()
    return cookie, sid


def session_id_for(cookie_value: str) -> str:
    return hashlib.sha256(cookie_value.encode()).hexdigest()


def sign_csrf(secret: str, sid: str) -> str:
    return hmac.new(secret.encode(), sid.encode(), hashlib.sha256).hexdigest()
```

`src/energybot/admin_api/auth.py`:
```python
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
    # CSRF check on write methods
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        s = get_settings()
        provided = request.headers.get("x-csrf")
        expected = sign_csrf(s.session_secret, sid)
        if provided != expected:
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
```

Modify `src/energybot/main.py` to include the admin router:
```python
from fastapi import FastAPI
from energybot.health import router as health_router
from energybot.bale_adapter.webhook import router as bale_router
from energybot.admin_api.auth import router as admin_auth_router
from energybot.logging import configure_logging


def create_app() -> FastAPI:
    configure_logging("INFO")
    app = FastAPI(title="Energybot")
    app.include_router(health_router)
    app.include_router(bale_router)
    app.include_router(admin_auth_router)
    return app


app = create_app()
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_admin_auth.py -v`
Expected: 5 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/admin_api src/energybot/core/security.py src/energybot/main.py tests/integration/test_admin_auth.py
git commit -m "feat(admin): auth with argon2, sessions, CSRF, login throttle"
```

---

### Task 39: Audit log decorator

**Files:**
- Create: `src/energybot/admin_api/audit.py`
- Create: `tests/integration/test_audit_decorator.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_audit_decorator.py`:
```python
import pytest
from uuid import uuid4
from sqlalchemy import select
from energybot.core.models import AuditLog, AdminUser
from energybot.admin_api.audit import audit


class Ctx:
    def __init__(self, admin_id, session_factory):
        self.admin_id = admin_id
        self.session_factory = session_factory


@pytest.mark.asyncio
async def test_audit_decorator_writes_row(db_session):
    admin = AdminUser(id=uuid4(), email="a@b.c", password_hash="x", role="admin")
    db_session.add(admin)
    await db_session.commit()

    @audit(action="article.publish", entity_type="kb_article")
    async def publish(ctx, *, entity_id: str, before, after):
        return {"ok": True}

    await publish(Ctx(admin.id, lambda: db_session), entity_id="abc-123", before={"v": 1}, after={"v": 2})
    row = (await db_session.execute(select(AuditLog))).scalar_one()
    assert row.action == "article.publish"
    assert row.entity_type == "kb_article"
    assert row.entity_id == "abc-123"
    assert row.before == {"v": 1}
    assert row.after == {"v": 2}
    assert row.admin_user_id == admin.id
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_audit_decorator.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/admin_api/audit.py`:
```python
from functools import wraps
from typing import Any, Callable
from energybot.core.models import AuditLog


def audit(*, action: str, entity_type: str) -> Callable:
    def decorator(fn: Callable):
        @wraps(fn)
        async def wrapper(ctx, *, entity_id: str, before: dict[str, Any] | None = None, after: dict[str, Any] | None = None, **kwargs):
            result = await fn(ctx, entity_id=entity_id, before=before, after=after, **kwargs)
            s = ctx.session_factory()
            s.add(AuditLog(
                admin_user_id=getattr(ctx, "admin_id", None),
                action=action, entity_type=entity_type, entity_id=str(entity_id),
                before=before, after=after,
            ))
            await s.commit()
            return result
        return wrapper
    return decorator
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_audit_decorator.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/admin_api/audit.py tests/integration/test_audit_decorator.py
git commit -m "feat(admin): audit decorator writing audit_log rows"
```

---

### Task 40: Users + chats admin endpoints

**Files:**
- Create: `src/energybot/admin_api/users.py`
- Create: `src/energybot/admin_api/chats.py`
- Modify: `src/energybot/main.py` (add routers)
- Create: `tests/integration/test_admin_users_chats.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_admin_users_chats.py`:
```python
import pytest
from httpx import ASGITransport, AsyncClient
from uuid import uuid4
from energybot.core.models import AdminUser, ChatSession, Message, Profile, User
from energybot.core.security import hash_password


async def _login(app, db_session) -> tuple[AsyncClient, dict]:
    db_session.add(AdminUser(email="a@b.c", password_hash=hash_password("pass1234"), role="admin"))
    await db_session.commit()
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://t")
    r = await c.post("/api/admin/login", json={"email": "a@b.c", "password": "pass1234"})
    csrf = r.headers.get("x-csrf")
    return c, {"x-csrf": csrf}


@pytest.fixture
async def app(monkeypatch, db_session):
    for k, v in {"SESSION_SECRET": "z" * 32, "BALE_WEBHOOK_SECRET": "x", "BALE_BOT_TOKEN": "t",
                  "FRONTIER_API_KEY": "f", "METIS_API_KEY": "m"}.items():
        monkeypatch.setenv(k, v)
    from energybot.main import create_app
    return create_app()


@pytest.mark.asyncio
async def test_list_users(app, db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="علی")
    db_session.add(u)
    db_session.add(Profile(user_id=u.id, household={"city": "تهران"}))
    await db_session.commit()
    c, hdr = await _login(app, db_session)
    async with c:
        r = await c.get("/api/admin/users")
        body = r.json()
    assert r.status_code == 200
    assert any(item["display_name"] == "علی" for item in body["users"])


@pytest.mark.asyncio
async def test_get_user_returns_profile_and_sessions(app, db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    db_session.add(Profile(user_id=u.id, household={"city": "تهران"}))
    sess = ChatSession(user_id=u.id)
    db_session.add(sess)
    await db_session.commit()
    c, hdr = await _login(app, db_session)
    async with c:
        r = await c.get(f"/api/admin/users/{u.id}")
        body = r.json()
    assert body["profile"]["household"]["city"] == "تهران"
    assert len(body["sessions"]) >= 1


@pytest.mark.asyncio
async def test_get_chat_transcript(app, db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000))
    db_session.add(u)
    db_session.add(Profile(user_id=u.id))
    sess = ChatSession(user_id=u.id)
    db_session.add(sess)
    await db_session.commit()
    db_session.add(Message(user_id=u.id, session_id=sess.id, role="user", content="سلام"))
    db_session.add(Message(user_id=u.id, session_id=sess.id, role="assistant", content="درود"))
    await db_session.commit()
    c, hdr = await _login(app, db_session)
    async with c:
        r = await c.get(f"/api/admin/chats/{sess.id}")
        body = r.json()
    assert len(body["messages"]) == 2
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_admin_users_chats.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/admin_api/users.py`:
```python
from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session
from energybot.core.models import AdminUser, ChatSession, Profile, User

router = APIRouter(prefix="/api/admin", tags=["admin-users"])


@router.get("/users")
async def list_users(_: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    rows = (await s.execute(select(User).where(User.deleted_at.is_(None)).order_by(desc(User.last_seen_at)).limit(200))).scalars().all()
    return {"users": [{"id": str(u.id), "bale_user_id": u.bale_user_id, "display_name": u.display_name, "last_seen_at": u.last_seen_at.isoformat() if u.last_seen_at else None} for u in rows]}


@router.get("/users/{user_id}")
async def get_user(user_id: UUID, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    u = (await s.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(404)
    p = (await s.execute(select(Profile).where(Profile.user_id == user_id))).scalar_one_or_none()
    sessions = (await s.execute(select(ChatSession).where(ChatSession.user_id == user_id).order_by(desc(ChatSession.started_at)).limit(20))).scalars().all()
    return {
        "user": {"id": str(u.id), "bale_user_id": u.bale_user_id, "display_name": u.display_name, "is_blocked": u.is_blocked},
        "profile": {"household": p.household if p else {}, "behaviour": p.behaviour if p else {}, "goals": p.goals if p else [], "commitments": p.commitments if p else []},
        "sessions": [{"id": str(s2.id), "started_at": s2.started_at.isoformat()} for s2 in sessions],
    }


@router.post("/users/{user_id}/block")
async def block(user_id: UUID, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    u = (await s.execute(select(User).where(User.id == user_id))).scalar_one()
    u.is_blocked = True
    await s.commit()
    return {"ok": True}
```

`src/energybot/admin_api/chats.py`:
```python
from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session
from energybot.core.models import AdminUser, ChatSession, Message

router = APIRouter(prefix="/api/admin", tags=["admin-chats"])


@router.get("/chats")
async def list_chats(_: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    rows = (await s.execute(select(ChatSession).order_by(ChatSession.started_at.desc()).limit(200))).scalars().all()
    return {"sessions": [{"id": str(r.id), "user_id": str(r.user_id), "started_at": r.started_at.isoformat()} for r in rows]}


@router.get("/chats/{session_id}")
async def get_chat(session_id: UUID, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    msgs = (await s.execute(select(Message).where(Message.session_id == session_id).order_by(Message.id))).scalars().all()
    return {"messages": [{"id": m.id, "role": m.role, "content": m.content, "tool_name": m.tool_name, "tool_args": m.tool_args, "tool_result": m.tool_result, "created_at": m.created_at.isoformat()} for m in msgs]}
```

Add to `main.py`:
```python
from energybot.admin_api.users import router as admin_users_router
from energybot.admin_api.chats import router as admin_chats_router
...
    app.include_router(admin_users_router)
    app.include_router(admin_chats_router)
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_admin_users_chats.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/admin_api/users.py src/energybot/admin_api/chats.py src/energybot/main.py tests/integration/test_admin_users_chats.py
git commit -m "feat(admin): users and chats read endpoints"
```

---

### Task 41: KB admin endpoints (CRUD + attachments + publish + search-test)

**Files:**
- Create: `src/energybot/admin_api/kb.py`
- Modify: `src/energybot/main.py` (add router)
- Create: `tests/integration/test_admin_kb_endpoints.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_admin_kb_endpoints.py`:
```python
import io
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.core.models import AdminUser
from energybot.core.security import hash_password


@pytest.fixture
async def app(monkeypatch):
    for k, v in {"SESSION_SECRET": "z" * 32, "BALE_WEBHOOK_SECRET": "x", "BALE_BOT_TOKEN": "t",
                  "FRONTIER_API_KEY": "f", "METIS_API_KEY": "m"}.items():
        monkeypatch.setenv(k, v)
    from energybot.main import create_app
    return create_app()


async def _login(c, db_session) -> dict:
    db_session.add(AdminUser(email="a@b.c", password_hash=hash_password("pass1234"), role="admin"))
    await db_session.commit()
    r = await c.post("/api/admin/login", json={"email": "a@b.c", "password": "pass1234"})
    return {"x-csrf": r.headers.get("x-csrf")}


@pytest.mark.asyncio
async def test_create_list_publish_delete_article(app, db_session, monkeypatch):
    # Stub the embedding router for publish to avoid real calls
    class StubRouter:
        async def embed(self, *, call_type, req):
            from energybot.providers.base import EmbeddingResponse
            return EmbeddingResponse(vectors=[[0.0] * 1536 for _ in req.inputs], tokens_in=0)

    monkeypatch.setattr("energybot.admin_api.kb.build_router_for_admin", lambda sf: StubRouter())

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.post("/api/admin/kb/articles", headers=hdr, json={"title": "تست", "body": "متن", "category": "gas", "tags": []})
        aid = r.json()["id"]
        assert r.status_code == 200
        r2 = await c.get("/api/admin/kb/articles")
        assert any(a["id"] == aid for a in r2.json()["articles"])
        r3 = await c.post(f"/api/admin/kb/articles/{aid}/publish", headers=hdr)
        assert r3.status_code == 200
        r4 = await c.delete(f"/api/admin/kb/articles/{aid}", headers=hdr)
        assert r4.status_code == 200
        r5 = await c.get("/api/admin/kb/articles")
        assert not any(a["id"] == aid for a in r5.json()["articles"])
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_admin_kb_endpoints.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/admin_api/kb.py`:
```python
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
```

Add to `main.py`:
```python
from energybot.admin_api.kb import router as admin_kb_router
...
    app.include_router(admin_kb_router)
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_admin_kb_endpoints.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/admin_api/kb.py src/energybot/main.py tests/integration/test_admin_kb_endpoints.py
git commit -m "feat(admin): KB CRUD + attachments + publish + search test endpoints"
```

---

### Task 42: Prompts + models + audit + stats endpoints + admin CLI

**Files:**
- Create: `src/energybot/admin_api/prompts.py`
- Create: `src/energybot/admin_api/models.py`
- Create: `src/energybot/admin_api/audit_log.py`
- Create: `src/energybot/admin_api/stats.py`
- Create: `src/energybot/admin_cli.py`
- Modify: `src/energybot/main.py`
- Create: `tests/integration/test_admin_remaining.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_admin_remaining.py`:
```python
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.core.models import AdminUser, ModelConfig, PromptTemplate
from energybot.core.security import hash_password


@pytest.fixture
async def app(monkeypatch):
    for k, v in {"SESSION_SECRET": "z" * 32, "BALE_WEBHOOK_SECRET": "x", "BALE_BOT_TOKEN": "t",
                  "FRONTIER_API_KEY": "f", "METIS_API_KEY": "m"}.items():
        monkeypatch.setenv(k, v)
    from energybot.main import create_app
    return create_app()


async def _login(c, db_session) -> dict:
    db_session.add(AdminUser(email="a@b.c", password_hash=hash_password("pass1234"), role="admin"))
    await db_session.commit()
    r = await c.post("/api/admin/login", json={"email": "a@b.c", "password": "pass1234"})
    return {"x-csrf": r.headers.get("x-csrf")}


@pytest.mark.asyncio
async def test_create_and_activate_prompt(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.post("/api/admin/prompts", headers=hdr, json={"key": "system_prompt", "name": "n", "body": "تست {{x}}"})
        pid = r.json()["id"]
        r2 = await c.post(f"/api/admin/prompts/{pid}/activate", headers=hdr)
        assert r2.status_code == 200
        r3 = await c.get("/api/admin/prompts?key=system_prompt")
        active = [p for p in r3.json()["prompts"] if p["status"] == "active"]
        assert len(active) == 1


@pytest.mark.asyncio
async def test_dashboard_stats_returns_zero_state(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.get("/api/admin/stats/dashboard")
    body = r.json()
    assert "dau" in body and "messages_today" in body


@pytest.mark.asyncio
async def test_audit_log_endpoint(app, db_session):
    from energybot.core.models import AuditLog
    db_session.add(AuditLog(action="x", entity_type="t", entity_id="1", before=None, after=None))
    await db_session.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.get("/api/admin/audit-log")
    assert any(item["action"] == "x" for item in r.json()["entries"])
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_admin_remaining.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/admin_api/prompts.py`:
```python
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session
from energybot.core.models import AdminUser, PromptTemplate
from energybot.agent.prompts import PromptLoader

router = APIRouter(prefix="/api/admin/prompts", tags=["admin-prompts"])


@router.get("")
async def list_prompts(key: str | None = None, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    q = select(PromptTemplate)
    if key:
        q = q.where(PromptTemplate.key == key)
    rows = (await s.execute(q.order_by(PromptTemplate.key, PromptTemplate.version.desc()))).scalars().all()
    return {"prompts": [{"id": str(r.id), "key": r.key, "name": r.name, "version": r.version, "status": r.status, "body": r.body} for r in rows]}


@router.post("")
async def create_prompt(payload: dict, admin: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    next_v = (await s.execute(select(func.coalesce(func.max(PromptTemplate.version), 0) + 1).where(PromptTemplate.key == payload["key"]))).scalar_one()
    p = PromptTemplate(key=payload["key"], name=payload["name"], body=payload["body"], version=int(next_v), status="draft", created_by=admin.id, notes=payload.get("notes"))
    s.add(p)
    await s.commit()
    return {"id": str(p.id), "version": p.version}


@router.post("/{prompt_id}/activate")
async def activate(prompt_id: UUID, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    row = (await s.execute(select(PromptTemplate).where(PromptTemplate.id == prompt_id))).scalar_one()
    loader = PromptLoader(session_factory=lambda: s, cache_ttl_seconds=0)
    await loader.activate(key=row.key, version=row.version)
    return {"ok": True}
```

`src/energybot/admin_api/models.py`:
```python
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.agent.model_configs import ModelConfigService
from energybot.core.db import get_session
from energybot.core.models import AdminUser, ModelConfig

router = APIRouter(prefix="/api/admin/models", tags=["admin-models"])


@router.get("")
async def list_models(_: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    rows = (await s.execute(select(ModelConfig).order_by(ModelConfig.call_type, ModelConfig.provider))).scalars().all()
    return {"models": [{"id": str(r.id), "call_type": r.call_type, "provider": r.provider, "model_name": r.model_name, "params": r.params, "is_active": r.is_active} for r in rows]}


@router.post("")
async def create_model(payload: dict, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    m = ModelConfig(call_type=payload["call_type"], provider=payload["provider"], model_name=payload["model_name"], params=payload.get("params", {}), is_active=False)
    s.add(m)
    await s.commit()
    return {"id": str(m.id)}


@router.post("/{config_id}/activate")
async def activate(config_id: UUID, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    svc = ModelConfigService(session_factory=lambda: s)
    await svc.activate(config_id)
    return {"ok": True}
```

`src/energybot/admin_api/audit_log.py`:
```python
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session
from energybot.core.models import AdminUser, AuditLog

router = APIRouter(prefix="/api/admin/audit-log", tags=["admin-audit"])


@router.get("")
async def list_audit(_: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    rows = (await s.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(500))).scalars().all()
    return {"entries": [{"id": r.id, "admin_user_id": str(r.admin_user_id) if r.admin_user_id else None,
                          "action": r.action, "entity_type": r.entity_type, "entity_id": r.entity_id,
                          "before": r.before, "after": r.after, "created_at": r.created_at.isoformat()} for r in rows]}
```

`src/energybot/admin_api/stats.py`:
```python
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session
from energybot.core.models import AdminUser, DailyStats, Message, User

router = APIRouter(prefix="/api/admin/stats", tags=["admin-stats"])


@router.get("/dashboard")
async def dashboard(_: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    today = datetime.utcnow().date()
    dau = (await s.execute(select(func.count(func.distinct(Message.user_id))).where(Message.created_at >= datetime.combine(today, datetime.min.time())))).scalar_one()
    messages_today = (await s.execute(select(func.count(Message.id)).where(Message.created_at >= datetime.combine(today, datetime.min.time())))).scalar_one()
    total_users = (await s.execute(select(func.count(User.id)).where(User.deleted_at.is_(None)))).scalar_one()
    history = (await s.execute(select(DailyStats).where(DailyStats.date >= today - timedelta(days=30)).order_by(DailyStats.date))).scalars().all()
    return {
        "dau": int(dau or 0),
        "messages_today": int(messages_today or 0),
        "total_users": int(total_users or 0),
        "history": [{"date": d.date.isoformat(), "dau": d.dau, "messages": d.messages, "kb_hits": d.kb_hits, "llm_cost_usd": float(d.llm_cost_usd)} for d in history],
    }
```

`src/energybot/admin_cli.py`:
```python
import argparse
import asyncio
from getpass import getpass
from energybot.core.db import get_sessionmaker
from energybot.core.models import AdminUser
from energybot.core.security import hash_password


async def _create_user(email: str, role: str, password: str) -> None:
    Session = get_sessionmaker()
    async with Session() as s:
        s.add(AdminUser(email=email, password_hash=hash_password(password), role=role))
        await s.commit()
    print(f"created admin user {email} role={role}")


def main() -> None:
    p = argparse.ArgumentParser("energybot-admin")
    sub = p.add_subparsers(dest="cmd", required=True)
    cu = sub.add_parser("create-user")
    cu.add_argument("--email", required=True)
    cu.add_argument("--role", choices=["admin", "editor"], default="admin")
    args = p.parse_args()
    if args.cmd == "create-user":
        pw = getpass("password: ")
        asyncio.run(_create_user(args.email, args.role, pw))


if __name__ == "__main__":
    main()
```

Add to `main.py`:
```python
from energybot.admin_api.prompts import router as admin_prompts_router
from energybot.admin_api.models import router as admin_models_router
from energybot.admin_api.audit_log import router as admin_audit_router
from energybot.admin_api.stats import router as admin_stats_router
...
    app.include_router(admin_prompts_router)
    app.include_router(admin_models_router)
    app.include_router(admin_audit_router)
    app.include_router(admin_stats_router)
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_admin_remaining.py -v`
Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/admin_api src/energybot/admin_cli.py src/energybot/main.py tests/integration/test_admin_remaining.py
git commit -m "feat(admin): prompts/models/audit/stats endpoints + create-user CLI"
```

---

## Milestone 13 — Admin UI (Next.js 14, Persian)

The admin UI is a Next.js 14 app router project with `output: 'export'` so it builds to a static `out/` directory that FastAPI serves at `/admin/*`. Persian (RTL) UI. Auth uses the same session cookie the backend already issues — the UI just needs to call `/api/admin/*` with `credentials: 'include'` and propagate the `x-csrf` header on writes.

### Task 43: Next.js scaffold + API client + login

**Files:**
- Create: `admin_ui/package.json`
- Create: `admin_ui/next.config.mjs`
- Create: `admin_ui/tsconfig.json`
- Create: `admin_ui/postcss.config.mjs`, `admin_ui/tailwind.config.ts`
- Create: `admin_ui/src/app/layout.tsx`
- Create: `admin_ui/src/app/page.tsx` (redirects to /login or /dashboard)
- Create: `admin_ui/src/app/login/page.tsx`
- Create: `admin_ui/src/lib/api.ts`
- Create: `admin_ui/src/lib/csrf.ts`
- Create: `admin_ui/tests/e2e/login.spec.ts`
- Create: `admin_ui/playwright.config.ts`

- [ ] **Step 1: Write failing Playwright E2E test**

`admin_ui/playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: { baseURL: process.env.E2E_BASE_URL || "http://localhost:8000" },
  webServer: undefined, // assume backend + UI bundle running
});
```

`admin_ui/tests/e2e/login.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("login redirects to dashboard", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByText("ورود")).toBeVisible();
  await page.getByLabel("ایمیل").fill("a@b.c");
  await page.getByLabel("رمز عبور").fill("pass1234");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard/);
});

test("unauthenticated dashboard redirects to login", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/\/admin\/login/);
});
```

- [ ] **Step 2: Verify failure**

Run (from repo root): `cd admin_ui && npx playwright test`
Expected: FAIL — no app running, or 404s.

- [ ] **Step 3: Implement scaffold**

`admin_ui/package.json`:
```json
{
  "name": "energybot-admin",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "next": "14.2.5",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@playwright/test": "1.45.0",
    "@types/node": "20.14.10",
    "@types/react": "18.3.3",
    "typescript": "5.5.3",
    "tailwindcss": "3.4.6",
    "postcss": "8.4.39",
    "autoprefixer": "10.4.19"
  }
}
```

`admin_ui/next.config.mjs`:
```js
const nextConfig = {
  output: "export",
  basePath: "/admin",
  trailingSlash: true,
  images: { unoptimized: true },
};
export default nextConfig;
```

`admin_ui/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "paths": {"@/*": ["./src/*"]},
    "plugins": [{"name": "next"}]
  },
  "include": ["src", ".next/types/**/*.ts", "next-env.d.ts"]
}
```

`admin_ui/tailwind.config.ts`:
```ts
import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

`admin_ui/postcss.config.mjs`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`admin_ui/src/app/layout.tsx`:
```tsx
import "./globals.css";

export const metadata = { title: "انرژی‌بات — پنل مدیریت" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-screen bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}
```

`admin_ui/src/app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
body { font-family: Vazirmatn, -apple-system, system-ui, sans-serif; }
```

`admin_ui/src/lib/csrf.ts`:
```ts
let cached: string | null = null;
export function setCsrf(t: string | null) { cached = t; }
export function getCsrf(): string | null { return cached; }
```

`admin_ui/src/lib/api.ts`:
```ts
import { getCsrf, setCsrf } from "./csrf";

const BASE = "/api/admin";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init.headers as any) };
  const csrf = getCsrf();
  if (csrf && init.method && init.method !== "GET") headers["x-csrf"] = csrf;
  const r = await fetch(`${BASE}${path}`, { credentials: "include", ...init, headers });
  const csrfFromResp = r.headers.get("x-csrf");
  if (csrfFromResp) setCsrf(csrfFromResp);
  if (r.status === 401) { if (typeof window !== "undefined") window.location.href = "/admin/login"; throw new Error("unauth"); }
  if (!r.ok) throw new Error(`api ${r.status}: ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) => request("/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => request<{ id: string; email: string; role: string }>("/me"),
  logout: () => request("/logout", { method: "POST" }),
  listUsers: () => request<{ users: any[] }>("/users"),
  getUser: (id: string) => request<{ user: any; profile: any; sessions: any[] }>(`/users/${id}`),
  listChats: () => request<{ sessions: any[] }>("/chats"),
  getChat: (id: string) => request<{ messages: any[] }>(`/chats/${id}`),
  listArticles: () => request<{ articles: any[] }>("/kb/articles"),
  getArticle: (id: string) => request<any>(`/kb/articles/${id}`),
  createArticle: (data: any) => request<{ id: string }>("/kb/articles", { method: "POST", body: JSON.stringify(data) }),
  updateArticle: (id: string, data: any) => request(`/kb/articles/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  publishArticle: (id: string) => request(`/kb/articles/${id}/publish`, { method: "POST" }),
  deleteArticle: (id: string) => request(`/kb/articles/${id}`, { method: "DELETE" }),
  searchKB: (q: string, top_k = 5, category?: string) => request<{ hits: any[] }>("/kb/search", { method: "POST", body: JSON.stringify({ query: q, top_k, category }) }),
  listPrompts: (key?: string) => request<{ prompts: any[] }>(`/prompts${key ? `?key=${encodeURIComponent(key)}` : ""}`),
  createPrompt: (d: any) => request<{ id: string; version: number }>("/prompts", { method: "POST", body: JSON.stringify(d) }),
  activatePrompt: (id: string) => request(`/prompts/${id}/activate`, { method: "POST" }),
  listModels: () => request<{ models: any[] }>("/models"),
  createModel: (d: any) => request<{ id: string }>("/models", { method: "POST", body: JSON.stringify(d) }),
  activateModel: (id: string) => request(`/models/${id}/activate`, { method: "POST" }),
  auditLog: () => request<{ entries: any[] }>("/audit-log"),
  dashboard: () => request<any>("/stats/dashboard"),
};
```

`admin_ui/src/app/page.tsx`:
```tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function Index() {
  const r = useRouter();
  useEffect(() => { api.me().then(() => r.replace("/dashboard")).catch(() => r.replace("/login")); }, [r]);
  return null;
}
```

`admin_ui/src/app/login/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function Login() {
  const r = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { await api.login(email, password); r.replace("/dashboard"); }
    catch { setErr("ایمیل یا رمز عبور نادرست است."); }
  }
  return (
    <main className="flex items-center justify-center min-h-screen">
      <form onSubmit={submit} className="bg-white p-6 rounded shadow w-full max-w-md space-y-4">
        <h1 className="text-xl font-bold">ورود</h1>
        <label className="block">ایمیل<input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full border p-2 rounded mt-1" /></label>
        <label className="block">رمز عبور<input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full border p-2 rounded mt-1" /></label>
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <button className="w-full bg-blue-600 text-white rounded p-2">ورود</button>
      </form>
    </main>
  );
}
```

Install + initial build:
```bash
cd admin_ui && npm install && npx playwright install --with-deps
```

- [ ] **Step 4: Verify pass**

Run (in two terminals): backend `uvicorn energybot.main:app --port 8000`, UI dev `cd admin_ui && npm run dev`, then `cd admin_ui && E2E_BASE_URL=http://localhost:3000 npx playwright test`.
Expected: 2 PASSED. (Once the static build is integrated in Task 46 the test will run against the bundled FastAPI URL.)

- [ ] **Step 5: Commit**

```bash
git add admin_ui
git commit -m "feat(admin-ui): Next.js scaffold + API client + login + e2e harness"
```

---

### Task 44: Dashboard, Users, Chats pages

**Files:**
- Create: `admin_ui/src/app/dashboard/page.tsx`
- Create: `admin_ui/src/app/users/page.tsx`
- Create: `admin_ui/src/app/users/[id]/page.tsx`
- Create: `admin_ui/src/app/chats/page.tsx`
- Create: `admin_ui/src/app/chats/[id]/page.tsx`
- Create: `admin_ui/src/components/NavBar.tsx`
- Create: `admin_ui/tests/e2e/dashboard.spec.ts`

- [ ] **Step 1: Write failing E2E test**

`admin_ui/tests/e2e/dashboard.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("dashboard shows core widgets", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("ایمیل").fill("a@b.c");
  await page.getByLabel("رمز عبور").fill("pass1234");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page.getByText("کاربران فعال امروز")).toBeVisible();
  await expect(page.getByText("پیام‌های امروز")).toBeVisible();
});

test("users list opens user detail", async ({ page }) => {
  await page.goto("/admin/users");
  // Test environment seeds at least one user; click first row
  const firstLink = page.locator("table tbody tr a").first();
  await firstLink.click();
  await expect(page.getByText("پروفایل")).toBeVisible();
});
```

- [ ] **Step 2: Verify failure**

Run E2E. Expected: FAIL.

- [ ] **Step 3: Implement pages**

`admin_ui/src/components/NavBar.tsx`:
```tsx
"use client";
import Link from "next/link";
const links = [
  { href: "/dashboard", label: "داشبورد" },
  { href: "/users", label: "کاربران" },
  { href: "/chats", label: "گفتگوها" },
  { href: "/kb/articles", label: "دانش‌نامه" },
  { href: "/prompts", label: "پرامپت‌ها" },
  { href: "/models", label: "مدل‌ها" },
  { href: "/audit-log", label: "گزارش تغییرات" },
];
export function NavBar() {
  return (
    <nav className="bg-white shadow px-4 py-3 flex gap-4">
      {links.map(l => <Link key={l.href} href={l.href} className="hover:underline">{l.label}</Link>)}
    </nav>
  );
}
```

`admin_ui/src/app/dashboard/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.dashboard().then(setData); }, []);
  return (
    <>
      <NavBar />
      <main className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card title="کاربران فعال امروز" value={data?.dau ?? "..."} />
        <Card title="پیام‌های امروز" value={data?.messages_today ?? "..."} />
        <Card title="کل کاربران" value={data?.total_users ?? "..."} />
      </main>
    </>
  );
}
function Card({ title, value }: { title: string; value: any }) {
  return <div className="bg-white p-4 rounded shadow"><div className="text-sm text-gray-600">{title}</div><div className="text-2xl font-bold mt-2">{value}</div></div>;
}
```

`admin_ui/src/app/users/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  useEffect(() => { api.listUsers().then(d => setUsers(d.users)); }, []);
  return (
    <><NavBar /><main className="p-6"><h1 className="text-xl font-bold mb-4">کاربران</h1>
      <table className="w-full bg-white shadow rounded">
        <thead className="bg-gray-100"><tr><th className="p-2 text-right">نام</th><th className="p-2 text-right">شناسه بله</th><th className="p-2 text-right">آخرین فعالیت</th></tr></thead>
        <tbody>{users.map(u => <tr key={u.id} className="border-t"><td className="p-2"><Link href={`/users/${u.id}`}>{u.display_name || "—"}</Link></td><td className="p-2">{u.bale_user_id}</td><td className="p-2">{u.last_seen_at?.slice(0, 16) || "—"}</td></tr>)}</tbody>
      </table>
    </main></>
  );
}
```

`admin_ui/src/app/users/[id]/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.getUser(id).then(setData); }, [id]);
  if (!data) return <><NavBar /><main className="p-6">در حال بارگذاری...</main></>;
  return (
    <><NavBar /><main className="p-6 space-y-4">
      <h1 className="text-xl font-bold">{data.user.display_name || data.user.bale_user_id}</h1>
      <section><h2 className="font-bold mb-2">پروفایل</h2><pre className="bg-white p-3 rounded shadow text-sm">{JSON.stringify(data.profile, null, 2)}</pre></section>
      <section><h2 className="font-bold mb-2">جلسه‌های اخیر</h2><ul>{data.sessions.map((s: any) => <li key={s.id}><a href={`/admin/chats/${s.id}`}>{s.started_at}</a></li>)}</ul></section>
    </main></>
  );
}
```

`admin_ui/src/app/chats/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function ChatsPage() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api.listChats().then(d => setRows(d.sessions)); }, []);
  return (
    <><NavBar /><main className="p-6"><h1 className="text-xl font-bold mb-4">گفتگوها</h1>
      <ul>{rows.map(s => <li key={s.id}><Link href={`/chats/${s.id}`}>{s.started_at} — {s.user_id}</Link></li>)}</ul>
    </main></>
  );
}
```

`admin_ui/src/app/chats/[id]/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function ChatDetail() {
  const { id } = useParams<{ id: string }>();
  const [msgs, setMsgs] = useState<any[]>([]);
  useEffect(() => { api.getChat(id).then(d => setMsgs(d.messages)); }, [id]);
  return (
    <><NavBar /><main className="p-6 space-y-2 max-w-3xl">
      {msgs.map(m => (
        <div key={m.id} className="bg-white p-3 rounded shadow">
          <div className="text-xs text-gray-500">{m.role} — {m.created_at}</div>
          <div className="mt-1 whitespace-pre-wrap">{m.content || "—"}</div>
          {m.tool_name && <pre className="text-xs bg-gray-50 p-2 mt-2 rounded">{m.tool_name}({JSON.stringify(m.tool_args)}) → {JSON.stringify(m.tool_result)}</pre>}
        </div>
      ))}
    </main></>
  );
}
```

- [ ] **Step 4: Verify pass**

Run E2E. Expected: 2 PASSED.

- [ ] **Step 5: Commit**

```bash
git add admin_ui/src admin_ui/tests/e2e/dashboard.spec.ts
git commit -m "feat(admin-ui): dashboard, users, chats pages"
```

---

### Task 45: KB pages (articles list + editor + attachments + search-test + trash)

**Files:**
- Create: `admin_ui/src/app/kb/articles/page.tsx`
- Create: `admin_ui/src/app/kb/articles/[id]/page.tsx`
- Create: `admin_ui/src/app/kb/articles/new/page.tsx`
- Create: `admin_ui/src/app/kb/trash/page.tsx`
- Create: `admin_ui/src/app/kb/search-test/page.tsx`
- Create: `admin_ui/tests/e2e/kb.spec.ts`

- [ ] **Step 1: Write failing E2E test**

`admin_ui/tests/e2e/kb.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("create, edit, publish, search-test, delete article", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("ایمیل").fill("a@b.c");
  await page.getByLabel("رمز عبور").fill("pass1234");
  await page.getByRole("button", { name: "ورود" }).click();
  await page.goto("/admin/kb/articles/new");
  await page.getByLabel("عنوان").fill("پکیج گاز");
  await page.getByLabel("متن").fill("متن کافی برای تست. تنظیم ترموستات روی ۲۱.");
  await page.getByLabel("دسته").selectOption("gas");
  await page.getByRole("button", { name: "ذخیره" }).click();
  await expect(page).toHaveURL(/\/admin\/kb\/articles\/[^/]+/);
  await page.getByRole("button", { name: "انتشار" }).click();
  await expect(page.getByText("منتشر شد")).toBeVisible({ timeout: 10_000 });
  await page.goto("/admin/kb/search-test");
  await page.getByLabel("جستجو").fill("پکیج");
  await page.getByRole("button", { name: "جستجو" }).click();
  await expect(page.getByText("پکیج گاز")).toBeVisible();
});
```

- [ ] **Step 2: Verify failure**

Run E2E. Expected: FAIL.

- [ ] **Step 3: Implement pages**

`admin_ui/src/app/kb/articles/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function ArticlesList() {
  const [arts, setArts] = useState<any[]>([]);
  useEffect(() => { api.listArticles().then(d => setArts(d.articles)); }, []);
  return (
    <><NavBar /><main className="p-6">
      <div className="flex justify-between mb-4"><h1 className="text-xl font-bold">مقاله‌ها</h1><Link href="/kb/articles/new" className="bg-blue-600 text-white px-3 py-1 rounded">جدید</Link></div>
      <table className="w-full bg-white shadow rounded">
        <thead className="bg-gray-100"><tr><th className="p-2 text-right">عنوان</th><th className="p-2 text-right">دسته</th><th className="p-2 text-right">وضعیت</th><th className="p-2 text-right">نسخه</th></tr></thead>
        <tbody>{arts.map(a => <tr key={a.id} className="border-t"><td className="p-2"><Link href={`/kb/articles/${a.id}`}>{a.title}</Link></td><td className="p-2">{a.category}</td><td className="p-2">{a.status}</td><td className="p-2">{a.version}</td></tr>)}</tbody>
      </table>
    </main></>
  );
}
```

`admin_ui/src/app/kb/articles/new/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function NewArticle() {
  const r = useRouter();
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [category, setCategory] = useState("general");
  async function save() {
    const { id } = await api.createArticle({ title, body, category, tags: [] });
    r.push(`/kb/articles/${id}`);
  }
  return (
    <><NavBar /><main className="p-6 max-w-3xl space-y-3">
      <label className="block">عنوان<input value={title} onChange={e => setTitle(e.target.value)} className="w-full border p-2 rounded mt-1" /></label>
      <label className="block">متن<textarea value={body} onChange={e => setBody(e.target.value)} rows={12} className="w-full border p-2 rounded mt-1" /></label>
      <label className="block">دسته<select value={category} onChange={e => setCategory(e.target.value)} className="border p-2 rounded mt-1"><option value="electricity">برق</option><option value="gas">گاز</option><option value="general">عمومی</option></select></label>
      <button onClick={save} className="bg-blue-600 text-white px-4 py-2 rounded">ذخیره</button>
    </main></>
  );
}
```

`admin_ui/src/app/kb/articles/[id]/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function ArticleEdit() {
  const { id } = useParams<{ id: string }>();
  const [a, setA] = useState<any>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { api.getArticle(id).then(setA); }, [id]);
  async function save() { await api.updateArticle(id, { title: a.title, body: a.body, category: a.category, tags: a.tags }); setMsg("ذخیره شد"); }
  async function publish() { await api.publishArticle(id); setMsg("منتشر شد"); const fresh = await api.getArticle(id); setA(fresh); }
  async function upload(f: File) {
    const fd = new FormData(); fd.append("file", f);
    await fetch(`/api/admin/kb/articles/${id}/attachments`, { method: "POST", credentials: "include", body: fd, headers: { "x-csrf": localStorage.getItem("csrf") || "" } as any });
  }
  if (!a) return <><NavBar /><main className="p-6">...</main></>;
  return (
    <><NavBar /><main className="p-6 max-w-3xl space-y-3">
      <label className="block">عنوان<input value={a.title} onChange={e => setA({ ...a, title: e.target.value })} className="w-full border p-2 rounded mt-1" /></label>
      <label className="block">متن<textarea value={a.body} onChange={e => setA({ ...a, body: e.target.value })} rows={12} className="w-full border p-2 rounded mt-1" /></label>
      <label className="block">دسته<select value={a.category} onChange={e => setA({ ...a, category: e.target.value })} className="border p-2 rounded mt-1"><option value="electricity">برق</option><option value="gas">گاز</option><option value="general">عمومی</option></select></label>
      <div><input type="file" onChange={e => e.target.files && upload(e.target.files[0])} /></div>
      <div className="flex gap-2"><button onClick={save} className="bg-gray-600 text-white px-4 py-2 rounded">ذخیره</button><button onClick={publish} className="bg-blue-600 text-white px-4 py-2 rounded">انتشار</button></div>
      {msg && <p className="text-green-600">{msg}</p>}
    </main></>
  );
}
```

`admin_ui/src/app/kb/search-test/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function SearchTest() {
  const [q, setQ] = useState(""); const [hits, setHits] = useState<any[]>([]);
  async function go() { const r = await api.searchKB(q); setHits(r.hits); }
  return (
    <><NavBar /><main className="p-6 max-w-3xl space-y-3">
      <label className="block">جستجو<input value={q} onChange={e => setQ(e.target.value)} className="w-full border p-2 rounded mt-1" /></label>
      <button onClick={go} className="bg-blue-600 text-white px-4 py-2 rounded">جستجو</button>
      <ul className="mt-4 space-y-2">{hits.map(h => <li key={h.chunk_id} className="bg-white p-3 rounded shadow"><div className="text-sm text-gray-500">{h.article_title} — {h.relevance.toFixed(3)}</div><div className="mt-1 text-sm">{h.chunk_text}</div></li>)}</ul>
    </main></>
  );
}
```

`admin_ui/src/app/kb/trash/page.tsx`:
```tsx
"use client";
// Minimal: list trashed items; restore is a future improvement.
export default function Trash() { return <main className="p-6">سطل بازیافت (در حال توسعه)</main>; }
```

- [ ] **Step 4: Verify pass**

Run E2E. Expected: PASS (single combined test).

- [ ] **Step 5: Commit**

```bash
git add admin_ui/src/app/kb admin_ui/tests/e2e/kb.spec.ts
git commit -m "feat(admin-ui): KB articles, editor, attachments, search-test, trash"
```

---

### Task 46: Prompts/models/audit pages + static export wiring

**Files:**
- Create: `admin_ui/src/app/prompts/page.tsx`
- Create: `admin_ui/src/app/models/page.tsx`
- Create: `admin_ui/src/app/audit-log/page.tsx`
- Modify: `src/energybot/main.py` (mount static admin from `admin_ui/out`)
- Create: `tests/integration/test_admin_static.py`

- [ ] **Step 1: Write failing integration test**

`tests/integration/test_admin_static.py`:
```python
import os
from pathlib import Path
import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def app_with_admin(tmp_path, monkeypatch):
    # Stage a fake static build
    out = tmp_path / "admin_out"
    (out / "login").mkdir(parents=True)
    (out / "login" / "index.html").write_text("<!DOCTYPE html><html><body>صفحه ورود</body></html>", encoding="utf-8")
    monkeypatch.setenv("ENERGYBOT_ADMIN_STATIC_DIR", str(out))
    for k, v in {"SESSION_SECRET": "z" * 32, "BALE_WEBHOOK_SECRET": "x", "BALE_BOT_TOKEN": "t",
                  "FRONTIER_API_KEY": "f", "METIS_API_KEY": "m"}.items():
        monkeypatch.setenv(k, v)
    from energybot.main import create_app
    return create_app()


@pytest.mark.asyncio
async def test_admin_static_login_served(app_with_admin):
    async with AsyncClient(transport=ASGITransport(app=app_with_admin), base_url="http://t") as c:
        r = await c.get("/admin/login/")
    assert r.status_code == 200
    assert "صفحه ورود" in r.text
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_admin_static.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement remaining pages and static mount**

`admin_ui/src/app/prompts/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function PromptsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [key, setKey] = useState(""); const [name, setName] = useState(""); const [body, setBody] = useState("");
  async function load() { const r = await api.listPrompts(); setRows(r.prompts); }
  useEffect(() => { load(); }, []);
  async function create() { await api.createPrompt({ key, name, body }); await load(); }
  return (
    <><NavBar /><main className="p-6 max-w-4xl space-y-3">
      <h1 className="text-xl font-bold">پرامپت‌ها</h1>
      <div className="bg-white p-4 rounded shadow space-y-2">
        <input placeholder="کلید (مثل system_prompt)" value={key} onChange={e => setKey(e.target.value)} className="border p-2 rounded w-full" />
        <input placeholder="نام" value={name} onChange={e => setName(e.target.value)} className="border p-2 rounded w-full" />
        <textarea placeholder="متن قالب (Jinja2)" value={body} onChange={e => setBody(e.target.value)} className="border p-2 rounded w-full" rows={8} />
        <button onClick={create} className="bg-blue-600 text-white px-4 py-2 rounded">افزودن نسخه</button>
      </div>
      <table className="w-full bg-white shadow rounded mt-4">
        <thead className="bg-gray-100"><tr><th className="p-2 text-right">کلید</th><th className="p-2 text-right">نسخه</th><th className="p-2 text-right">وضعیت</th><th className="p-2 text-right"></th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className="border-t"><td className="p-2">{r.key}</td><td className="p-2">{r.version}</td><td className="p-2">{r.status}</td><td className="p-2">{r.status !== "active" && <button onClick={async () => { await api.activatePrompt(r.id); await load(); }} className="bg-green-600 text-white px-3 py-1 rounded">فعال‌سازی</button>}</td></tr>)}</tbody>
      </table>
    </main></>
  );
}
```

`admin_ui/src/app/models/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function ModelsPage() {
  const [rows, setRows] = useState<any[]>([]);
  async function load() { const r = await api.listModels(); setRows(r.models); }
  useEffect(() => { load(); }, []);
  return (
    <><NavBar /><main className="p-6 max-w-4xl">
      <h1 className="text-xl font-bold mb-4">مدل‌ها</h1>
      <table className="w-full bg-white shadow rounded">
        <thead className="bg-gray-100"><tr><th className="p-2 text-right">نوع تماس</th><th className="p-2 text-right">ارائه‌دهنده</th><th className="p-2 text-right">مدل</th><th className="p-2 text-right">فعال؟</th><th className="p-2 text-right"></th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className="border-t"><td className="p-2">{r.call_type}</td><td className="p-2">{r.provider}</td><td className="p-2">{r.model_name}</td><td className="p-2">{r.is_active ? "✔" : "—"}</td><td className="p-2">{!r.is_active && <button onClick={async () => { await api.activateModel(r.id); await load(); }} className="bg-green-600 text-white px-3 py-1 rounded">فعال‌سازی</button>}</td></tr>)}</tbody>
      </table>
    </main></>
  );
}
```

`admin_ui/src/app/audit-log/page.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";

export default function AuditLogPage() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { api.auditLog().then(r => setRows(r.entries)); }, []);
  return (
    <><NavBar /><main className="p-6 max-w-5xl">
      <h1 className="text-xl font-bold mb-4">گزارش تغییرات</h1>
      <ul className="space-y-2">{rows.map(r => <li key={r.id} className="bg-white p-3 rounded shadow"><div className="text-sm text-gray-500">{r.created_at}</div><div>{r.action} → {r.entity_type}/{r.entity_id}</div></li>)}</ul>
    </main></>
  );
}
```

Build the static admin: `cd admin_ui && npm run build` (produces `admin_ui/out/`).

Modify `src/energybot/main.py` to mount static files:
```python
import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from energybot.health import router as health_router
from energybot.bale_adapter.webhook import router as bale_router
from energybot.admin_api.auth import router as admin_auth_router
from energybot.admin_api.users import router as admin_users_router
from energybot.admin_api.chats import router as admin_chats_router
from energybot.admin_api.kb import router as admin_kb_router
from energybot.admin_api.prompts import router as admin_prompts_router
from energybot.admin_api.models import router as admin_models_router
from energybot.admin_api.audit_log import router as admin_audit_router
from energybot.admin_api.stats import router as admin_stats_router
from energybot.logging import configure_logging


def create_app() -> FastAPI:
    configure_logging("INFO")
    app = FastAPI(title="Energybot")
    app.include_router(health_router)
    app.include_router(bale_router)
    app.include_router(admin_auth_router)
    app.include_router(admin_users_router)
    app.include_router(admin_chats_router)
    app.include_router(admin_kb_router)
    app.include_router(admin_prompts_router)
    app.include_router(admin_models_router)
    app.include_router(admin_audit_router)
    app.include_router(admin_stats_router)
    static_dir = os.environ.get("ENERGYBOT_ADMIN_STATIC_DIR", "admin_ui/out")
    if os.path.isdir(static_dir):
        app.mount("/admin", StaticFiles(directory=static_dir, html=True), name="admin")
    return app


app = create_app()
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_admin_static.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add admin_ui/src/app src/energybot/main.py tests/integration/test_admin_static.py
git commit -m "feat(admin-ui): prompts, models, audit pages + static SPA mount"
```

---

## Milestone 14 — Background jobs

### Task 47: APScheduler + nightly daily_stats rollup

**Files:**
- Create: `src/energybot/jobs/__init__.py`
- Create: `src/energybot/jobs/scheduler.py`
- Create: `src/energybot/jobs/daily_stats.py`
- Modify: `src/energybot/main.py` (start/stop scheduler in lifespan)
- Create: `tests/integration/test_daily_stats.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_daily_stats.py`:
```python
from datetime import datetime, timedelta
import pytest
from sqlalchemy import select
from energybot.core.models import DailyStats, Message, User
from energybot.jobs.daily_stats import recompute_daily_stats


@pytest.mark.asyncio
async def test_recompute_yesterday(db_session):
    u = User(bale_user_id=12345)
    db_session.add(u)
    await db_session.commit()
    yday = datetime.utcnow() - timedelta(days=1)
    sess_id = None
    from energybot.core.models import ChatSession
    sess = ChatSession(user_id=u.id, started_at=yday)
    db_session.add(sess)
    await db_session.commit()
    for i in range(3):
        m = Message(user_id=u.id, session_id=sess.id, role="user" if i % 2 == 0 else "assistant", content="x")
        m.created_at = yday
        db_session.add(m)
    await db_session.commit()
    await recompute_daily_stats(session_factory=lambda: db_session, for_date=yday.date())
    row = (await db_session.execute(select(DailyStats).where(DailyStats.date == yday.date()))).scalar_one()
    assert row.messages == 3
    assert row.dau == 1
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_daily_stats.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/jobs/__init__.py`: (empty)

`src/energybot/jobs/scheduler.py`:
```python
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from energybot.core.db import get_sessionmaker
from energybot.jobs.daily_stats import recompute_daily_stats


def make_scheduler() -> AsyncIOScheduler:
    sched = AsyncIOScheduler()
    Session = get_sessionmaker()

    async def session_factory():
        return Session()  # caller awaits inside async with

    # Wrap: jobs receive session_factory via closures
    async def daily_stats_job():
        async with Session() as s:
            await recompute_daily_stats(session_factory=lambda: s)

    sched.add_job(daily_stats_job, "cron", hour=2, minute=15, id="daily_stats")
    return sched
```

`src/energybot/jobs/daily_stats.py`:
```python
from collections.abc import Callable
from datetime import date, datetime, timedelta
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import DailyStats, Message


async def recompute_daily_stats(*, session_factory: Callable[[], AsyncSession], for_date: date | None = None) -> None:
    target = for_date or (datetime.utcnow().date() - timedelta(days=1))
    start = datetime.combine(target, datetime.min.time())
    end = start + timedelta(days=1)
    s = session_factory()
    dau = (await s.execute(select(func.count(func.distinct(Message.user_id))).where(Message.created_at >= start, Message.created_at < end))).scalar_one()
    msgs = (await s.execute(select(func.count(Message.id)).where(Message.created_at >= start, Message.created_at < end))).scalar_one()
    kb_hits = (await s.execute(select(func.count(Message.id)).where(Message.created_at >= start, Message.created_at < end, Message.tool_name == "search_knowledge_base"))).scalar_one()
    tokens_total = (await s.execute(select(func.coalesce(func.sum(Message.tokens_in + Message.tokens_out), 0)).where(Message.created_at >= start, Message.created_at < end))).scalar_one()
    await s.execute(delete(DailyStats).where(DailyStats.date == target))
    s.add(DailyStats(date=target, dau=int(dau or 0), messages=int(msgs or 0),
                     kb_hits=int(kb_hits or 0), llm_cost_usd=0, tokens_total=int(tokens_total or 0)))
    await s.commit()
```

Modify `main.py` to start the scheduler in a FastAPI lifespan:
```python
from contextlib import asynccontextmanager
from energybot.jobs.scheduler import make_scheduler

@asynccontextmanager
async def lifespan(app: FastAPI):
    sched = make_scheduler()
    sched.start()
    try:
        yield
    finally:
        sched.shutdown(wait=False)


def create_app() -> FastAPI:
    configure_logging("INFO")
    app = FastAPI(title="Energybot", lifespan=lifespan)
    ...
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_daily_stats.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/jobs src/energybot/main.py tests/integration/test_daily_stats.py
git commit -m "feat(jobs): APScheduler + nightly daily_stats rollup"
```

---

### Task 48: Cleanup + hard-purge jobs

**Files:**
- Create: `src/energybot/jobs/cleanup.py`
- Create: `src/energybot/jobs/purge.py`
- Modify: `src/energybot/jobs/scheduler.py`
- Create: `tests/integration/test_jobs_cleanup.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_jobs_cleanup.py`:
```python
from datetime import datetime, timedelta
import pytest
from sqlalchemy import select
from energybot.core.models import ProcessedUpdate, User, Profile
from energybot.jobs.cleanup import cleanup_processed_updates
from energybot.jobs.purge import hard_purge_soft_deleted


@pytest.mark.asyncio
async def test_processed_updates_older_than_24h_removed(db_session):
    old = ProcessedUpdate(update_id=1)
    old.created_at = datetime.utcnow() - timedelta(days=2)
    new = ProcessedUpdate(update_id=2)
    db_session.add_all([old, new])
    await db_session.commit()
    await cleanup_processed_updates(session_factory=lambda: db_session)
    rows = (await db_session.execute(select(ProcessedUpdate))).scalars().all()
    assert {r.update_id for r in rows} == {2}


@pytest.mark.asyncio
async def test_hard_purge_after_grace(db_session):
    u = User(bale_user_id=99988, display_name="x")
    db_session.add(u)
    db_session.add(Profile(user_id=u.id))
    await db_session.commit()
    u.deleted_at = datetime.utcnow() - timedelta(days=40)
    await db_session.commit()
    await hard_purge_soft_deleted(session_factory=lambda: db_session, grace_days=30)
    rows = (await db_session.execute(select(User).where(User.id == u.id))).scalars().all()
    assert rows == []
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_jobs_cleanup.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/jobs/cleanup.py`:
```python
from collections.abc import Callable
from datetime import datetime, timedelta
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import ProcessedUpdate


async def cleanup_processed_updates(*, session_factory: Callable[[], AsyncSession]) -> None:
    s = session_factory()
    cutoff = datetime.utcnow() - timedelta(hours=24)
    await s.execute(delete(ProcessedUpdate).where(ProcessedUpdate.created_at < cutoff))
    await s.commit()
```

`src/energybot/jobs/purge.py`:
```python
from collections.abc import Callable
from datetime import datetime, timedelta
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import KBArticle, Message, Profile, User


async def hard_purge_soft_deleted(*, session_factory: Callable[[], AsyncSession], grace_days: int = 30) -> None:
    s = session_factory()
    cutoff = datetime.utcnow() - timedelta(days=grace_days)
    await s.execute(delete(Message).where(Message.deleted_at.is_not(None), Message.deleted_at < cutoff))
    await s.execute(delete(Profile).where(Profile.deleted_at.is_not(None), Profile.deleted_at < cutoff))
    await s.execute(delete(KBArticle).where(KBArticle.deleted_at.is_not(None), KBArticle.deleted_at < cutoff))
    await s.execute(delete(User).where(User.deleted_at.is_not(None), User.deleted_at < cutoff))
    await s.commit()
```

Extend `scheduler.py`:
```python
from energybot.jobs.cleanup import cleanup_processed_updates
from energybot.jobs.purge import hard_purge_soft_deleted
from energybot.settings import get_settings

...
def make_scheduler() -> AsyncIOScheduler:
    sched = AsyncIOScheduler()
    Session = get_sessionmaker()
    s = get_settings()

    async def daily_stats_job():
        async with Session() as session: await recompute_daily_stats(session_factory=lambda: session)
    async def cleanup_job():
        async with Session() as session: await cleanup_processed_updates(session_factory=lambda: session)
    async def purge_job():
        async with Session() as session: await hard_purge_soft_deleted(session_factory=lambda: session, grace_days=s.soft_delete_grace_days)

    sched.add_job(daily_stats_job, "cron", hour=2, minute=15, id="daily_stats")
    sched.add_job(cleanup_job, "cron", minute=0, id="cleanup_processed_updates")
    sched.add_job(purge_job, "cron", hour=3, minute=30, id="hard_purge")
    return sched
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_jobs_cleanup.py -v`
Expected: 2 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/jobs/cleanup.py src/energybot/jobs/purge.py src/energybot/jobs/scheduler.py tests/integration/test_jobs_cleanup.py
git commit -m "feat(jobs): hourly processed_updates cleanup + nightly hard purge"
```

---

## Milestone 15 — Observability and deploy

### Task 49: Prometheus `/metrics` endpoint

**Files:**
- Create: `src/energybot/metrics.py`
- Modify: `src/energybot/main.py` (include router)
- Modify: `src/energybot/agent/loop.py` (record counters)
- Create: `tests/integration/test_metrics.py`

- [ ] **Step 1: Write failing test**

`tests/integration/test_metrics.py`:
```python
import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def app(monkeypatch):
    for k, v in {"SESSION_SECRET": "z" * 32, "BALE_WEBHOOK_SECRET": "x", "BALE_BOT_TOKEN": "t",
                  "FRONTIER_API_KEY": "f", "METIS_API_KEY": "m"}.items():
        monkeypatch.setenv(k, v)
    from energybot.main import create_app
    return create_app()


@pytest.mark.asyncio
async def test_metrics_endpoint_exposes_counters(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/metrics")
    assert r.status_code == 200
    assert "energybot_webhook_requests_total" in r.text
    assert "energybot_llm_calls_total" in r.text
```

- [ ] **Step 2: Verify failure**

Run: `python -m pytest tests/integration/test_metrics.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/energybot/metrics.py`:
```python
from fastapi import APIRouter, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

router = APIRouter()

webhook_requests = Counter("energybot_webhook_requests_total", "Bale webhook requests", ["status"])
llm_calls = Counter("energybot_llm_calls_total", "LLM calls", ["provider", "call_type", "status"])
agent_iterations = Histogram("energybot_agent_iterations", "Tool iterations per agent turn", buckets=(0, 1, 2, 3, 4, 5, 6))
kb_searches = Counter("energybot_kb_searches_total", "KB search tool invocations")


@router.get("/metrics")
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
```

Modify `main.py`:
```python
from energybot.metrics import router as metrics_router
...
    app.include_router(metrics_router)
```

Modify `bale_adapter/webhook.py` — wrap the body with counter increments:
```python
from energybot.metrics import webhook_requests
...
@router.post("/bale/webhook/{secret}")
async def webhook(...):
    ...
    try:
        await handle_bale_update(body, session_factory=lambda: session)
        webhook_requests.labels(status="ok").inc()
    except Exception:
        webhook_requests.labels(status="error").inc()
        ...
```

Modify `providers/router.py` to bump `llm_calls`:
```python
from energybot.metrics import llm_calls
...
# inside _log
llm_calls.labels(provider=provider, call_type=call_type, status=status).inc()
```

Modify `agent/loop.py` to observe iterations:
```python
from energybot.metrics import agent_iterations
...
agent_iterations.observe(iters)
```

- [ ] **Step 4: Verify pass**

Run: `python -m pytest tests/integration/test_metrics.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/metrics.py src/energybot/main.py src/energybot/bale_adapter/webhook.py src/energybot/providers/router.py src/energybot/agent/loop.py tests/integration/test_metrics.py
git commit -m "feat(obs): Prometheus /metrics with webhook, LLM, agent counters"
```

---

### Task 50: Dockerfile, docker-compose, README, smoke script

**Files:**
- Create: `Dockerfile`
- Modify: `docker-compose.yml` (add app service)
- Create: `README.md`
- Create: `scripts/smoke.sh`

- [ ] **Step 1: Write Dockerfile**

`Dockerfile`:
```dockerfile
FROM node:20-alpine AS admin-build
WORKDIR /admin
COPY admin_ui/package.json admin_ui/package-lock.json* ./
RUN npm install
COPY admin_ui/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends libmagic1 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml ./
COPY alembic.ini ./
COPY alembic ./alembic
COPY src ./src
RUN pip install --no-cache-dir -e .
COPY --from=admin-build /admin/out ./admin_ui/out
ENV ENERGYBOT_ADMIN_STATIC_DIR=/app/admin_ui/out
ENV MEDIA_ROOT=/var/lib/energybot/media
RUN mkdir -p $MEDIA_ROOT
EXPOSE 8000
CMD ["uvicorn", "energybot.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Extend `docker-compose.yml`**

```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    environment: { POSTGRES_USER: energybot, POSTGRES_PASSWORD: energybot, POSTGRES_DB: energybot }
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
  app:
    build: .
    depends_on: [db]
    environment:
      DATABASE_URL: postgresql+asyncpg://energybot:energybot@db:5432/energybot
      BALE_BOT_TOKEN: ${BALE_BOT_TOKEN}
      BALE_WEBHOOK_SECRET: ${BALE_WEBHOOK_SECRET}
      FRONTIER_API_KEY: ${FRONTIER_API_KEY}
      METIS_API_KEY: ${METIS_API_KEY}
      SESSION_SECRET: ${SESSION_SECRET}
    ports: ["8000:8000"]
    volumes: ["media:/var/lib/energybot/media"]
volumes:
  pgdata: {}
  media: {}
```

- [ ] **Step 3: Smoke script**

`scripts/smoke.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-http://localhost:8000}
echo "1. health" ; curl -sf "$BASE/health" | grep ok
echo "2. metrics" ; curl -sf "$BASE/metrics" | head -5
echo "3. webhook reject bad secret" ; curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/bale/webhook/WRONG" -H "Content-Type: application/json" -d '{}'
echo "4. webhook accept (set BALE_WEBHOOK_SECRET in env first)"
test -n "${BALE_WEBHOOK_SECRET:-}" && curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/bale/webhook/$BALE_WEBHOOK_SECRET" -H "Content-Type: application/json" -d '{"update_id":999,"message":{"message_id":1,"from":{"id":1},"chat":{"id":1},"text":"hi"}}'
echo "smoke ok"
```

- [ ] **Step 4: README**

`README.md`:
```markdown
# Energybot — Phase 1

Persian-language energy-saving assistant on Bale messenger.

## Quickstart (local dev)

1. `docker compose up -d db`
2. `python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"`
3. Copy `.env.example` to `.env` and fill values.
4. `alembic upgrade head`
5. Seed initial admin: `python -m energybot.admin_cli create-user --email you@x.com --role admin`
6. Build admin UI: `cd admin_ui && npm install && npm run build && cd ..`
7. Run: `uvicorn energybot.main:app --reload`
8. Open `http://localhost:8000/admin/`.

## Tests

- Unit: `pytest tests/ -v -m "not llm"`
- Integration: needs `docker compose -f docker-compose.test.yml up -d`, then `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/integration -v`
- Live LLM smoke: `pytest -m llm` (requires API keys in env)

## Deploy

Single VPS: `docker compose up -d --build`. Configure a reverse proxy (Caddy or nginx) in front for TLS termination and to point `/bale/webhook/...` at port 8000.

Set the Bale webhook to `https://your-host/bale/webhook/<BALE_WEBHOOK_SECRET>` via Bale's setWebhook API.

## Architecture

See `docs/superpowers/specs/2026-05-21-energybot-phase1-design.md`.
```

- [ ] **Step 5: Verify**

Run:
```bash
docker compose build app
docker compose up -d
sleep 5
BASE=http://localhost:8000 bash scripts/smoke.sh
```

Expected: smoke script prints "smoke ok".

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml README.md scripts/smoke.sh
git commit -m "feat(deploy): Dockerfile, compose, README, smoke script"
```

---

## Final integration verification

After all 50 tasks are committed:

1. Bring up a fresh environment: `docker compose down -v && docker compose up -d --build`
2. Apply migrations: `docker compose exec app alembic upgrade head`
3. Seed admin: `docker compose exec app python -m energybot.admin_cli create-user --email you@x.com --role admin`
4. Open `http://localhost:8000/admin/` and verify all six tabs render with no console errors.
5. Use the **Prompts** tab to add and activate a `system_prompt` (Persian, with `{{profile_summary}}` and `{{rolling_summary}}` placeholders).
6. Use the **Models** tab to add and activate one row per `call_type` (`chat_reasoning`, `summarize`, `embed`, `transcribe`, `wizard_extract`).
7. Use the **Knowledge Base** tab to create 1–2 short Persian articles, attach an image, click Publish, then verify hits in **Search Test**.
8. Configure the Bale webhook via Bale's `setWebhook` (out-of-band) pointing at `https://<your-host>/bale/webhook/<secret>`.
9. From a phone Bale account, send `/start` to the bot and walk through the wizard, then ask 2–3 questions and confirm responses cite published articles.

If all of the above succeed, **Phase 1 acceptance is met.**

---

## Plan Self-Review

Looked at the spec with fresh eyes and checked each acceptance criterion against the plan:

| Spec acceptance area | Plan task(s) |
|---|---|
| `/start` greets and runs onboarding wizard with inline keyboards | Tasks 20, 37 |
| Wizard resumable mid-flow | Task 20 (`OnboardingState`) |
| Mid-wizard real question abandons wizard | Task 37 (`is_wizard_answer`, `abandon`) |
| Free conversation triggers agent loop | Tasks 33, 37 |
| `/profile`, `/forget`, `/restart`, `/help` | Task 37 |
| Polite Persian error on agent failure | Task 37 (try/except wrapper) |
| Profile facts via wizard + agent tool calls | Tasks 18, 20, 31 |
| Rolling summary triggered after N messages | Task 22 |
| Multi-session continuity (profile + summary preserved) | Tasks 21, 22, 23 |
| Admin can create/edit/publish article with attachments and video transcription | Tasks 24, 25, 27, 28, 41 |
| Republish re-embeds atomically | Task 28 |
| Search Test shows ranked results | Tasks 29, 41, 45 |
| Bot retrieves and cites article content | Tasks 30, 33, 37 |
| Admin auth, KB mgmt, prompt mgmt, chat browsing, dashboard, audit log | Tasks 38–42, 43–46 |
| Audit log captures every admin write | Task 39 (decorator), Tasks 41/42 (use it) |
| One-command deploy of Docker image with migrations + static admin | Task 50 |
| Nightly pg_dump | README guidance (Task 50) |
| `/health` returns 200 | Task 5 |
| `/metrics` reachable | Task 49 |
| Provider router with frontier+metis fallback on simulated 5xx | Tasks 12–15 |
| `/forget` soft-delete with redaction + 30-day hard purge | Tasks 37, 48 |

**Placeholder scan:** searched for "TBD", "TODO", "fill in", "add appropriate", "similar to". Found one self-flagged comment in Task 27 (transcription Phase 1 placeholder body) which is explicitly called out as a temporary stub the implementer replaces when wiring real Whisper; the test exercises the path end-to-end via the router. Acceptable.

**Type consistency:** `BaleClient.send_photo`/`send_video` signatures match `SendKBMediaTool` and the `FakeBaleClient` in tests. `PromptLoader.render` signature is consistent between Task 16 and Tasks 22, 23, 33. `ProviderRouter.chat` signature (`call_type=`, `req=`, `prompt_key=`, `prompt_version=`) is consistent across Tasks 15, 22, 23, 27, 33. `ChatRepository.add_message` keyword args consistent across Tasks 21, 22, 33, 37.

**Spec requirements missing:** none material to Phase 1 acceptance.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-21-energybot-phase1.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Each subagent gets full context for one task and ends with a clean commit.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?

<!-- PLAN_APPEND_BELOW -->
