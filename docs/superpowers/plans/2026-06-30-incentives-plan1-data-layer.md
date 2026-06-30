# Incentives — Plan 1: Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the admin-editable database foundation for Tavanir incentive calculations — an `incentive_param_set` table (numbers keyed by year + climate zone) and a `city_climate_zone` lookup table, with a repository, an admin CRUD API, dev seed data, and an admin UI screen.

**Architecture:** Two new standalone tables in `core/models.py` + an Alembic migration. A new `energybot.incentives` package holds a repository that reads the active param set for a zone and resolves a free-text city to a climate zone. A new `admin_api/incentives.py` router exposes CRUD (mirrors `admin_api/bills.py` auth + audit pattern). Seed data lives in `scripts/seed_dev.py`. The admin screen mirrors `admin_ui/src/app/prompts/page.tsx`.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy 2 (async, `Mapped`/`mapped_column`) / Alembic / Postgres (JSONB) / Next.js App Router (static export, TypeScript, Tailwind) / pytest-asyncio.

## Global Constraints

- All money values are stored in **rial** (the `Bill.amount` convention; UI divides by 10 for Toman).
- Persian (fa) is the only UI language; admin copy is Persian, RTL.
- Every admin endpoint is protected: `_: AdminUser = Depends(current_admin)`; writes require the `x-csrf` header (enforced by `current_admin`); mutations write an `AuditLog` row.
- Async SQLAlchemy throughout: models use `Mapped[...] = mapped_column(...)`; queries use `await s.execute(select(...))`.
- `asyncio_mode = "auto"` is set; existing tests still decorate with `@pytest.mark.asyncio` — match that style.
- Test DB: `postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test` (env `TEST_DATABASE_URL`). Migrations are applied to it with `DATABASE_URL=<test-url> python -m alembic upgrade head`.
- The current Alembic head is `f6a1b2c3d4e5` (verify with `python -m alembic heads`).
- **The seeded incentive numbers are representative and flagged `"verified": false`.** They MUST be confirmed against current Tavanir figures before production; the admin screen exists precisely so a non-developer can correct them.

### `incentive_param_set.params` JSONB schema (the contract Plan 2's calculator consumes)

```json
{
  "free_tier": {
    "summer": { "pattern_kwh": 300, "low_user_kwh": 200 },
    "winter": { "pattern_kwh": 200, "low_user_kwh": 120 }
  },
  "savings_reward": {
    "min_reduction_pct": 10,
    "reward_pct_of_bill": 30,
    "low_usage_threshold_kwh": 150,
    "per_kwh_rial_reward": 5000,
    "monthly_cap_rial": 8500000
  },
  "verified": false,
  "last_verified": "1404"
}
```

Semantics (used by Plan 2): monthly usage `<= low_user_kwh` → کم‌مصرف (free / 100% discount); `low_user_kwh < usage <= pattern_kwh` → خوش‌مصرف (partial discount); `> pattern_kwh` → پرمصرف. `savings_reward` describes پاداش صرفه‌جویی: reduce ≥ `min_reduction_pct` vs the same period last year → up to `reward_pct_of_bill`% of the bill back, capped at `monthly_cap_rial`; usage under `low_usage_threshold_kwh` earns `per_kwh_rial_reward` per kWh reduced.

---

### Task 1: Models + migration for the two tables

**Files:**
- Modify: `src/energybot/core/models.py` (append two classes after `BillPayment`, ~line 313)
- Create: `alembic/versions/20260630_1300_incentives.py`
- Modify: `tests/integration/conftest.py` (add the two tables to both cleanup blocks)
- Test: `tests/integration/test_incentives_schema.py`

**Interfaces:**
- Produces: `IncentiveParamSet(id, effective_year, climate_zone, label, params, is_active, created_at)` and `CityClimateZone(id, city_name, province, climate_zone, is_active)` SQLAlchemy models, and the corresponding Postgres tables `incentive_param_set` / `city_climate_zone`.

- [ ] **Step 1: Write the failing schema test**

Create `tests/integration/test_incentives_schema.py`:

```python
import pytest
from sqlalchemy import select
from energybot.core.models import IncentiveParamSet, CityClimateZone


@pytest.mark.asyncio
async def test_incentive_param_set_table_exists(db_session):
    rows = (await db_session.execute(select(IncentiveParamSet))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_city_climate_zone_table_exists(db_session):
    rows = (await db_session.execute(select(CityClimateZone))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_param_set_roundtrip(db_session):
    ps = IncentiveParamSet(
        effective_year=1404, climate_zone="normal", label="عادی ۱۴۰۴",
        params={"savings_reward": {"min_reduction_pct": 10}}, is_active=True,
    )
    db_session.add(ps)
    await db_session.commit()
    got = (await db_session.execute(select(IncentiveParamSet))).scalar_one()
    assert got.climate_zone == "normal"
    assert got.params["savings_reward"]["min_reduction_pct"] == 10
    assert got.is_active is True
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/integration/test_incentives_schema.py -v`
Expected: FAIL — `ImportError: cannot import name 'IncentiveParamSet'`.

- [ ] **Step 3: Add the two models**

Append to `src/energybot/core/models.py` immediately after the `BillPayment` class (after line 312). `Boolean`, `Integer`, `String`, `JSONB`, `func` are already imported at the top of the file.

```python
class IncentiveParamSet(Base):
    __tablename__ = "incentive_param_set"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    effective_year: Mapped[int] = mapped_column(Integer, nullable=False)
    climate_zone: Mapped[str] = mapped_column(String(40), nullable=False)
    label: Mapped[str | None] = mapped_column(String(200))
    params: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    __table_args__ = (
        UniqueConstraint("effective_year", "climate_zone", name="uq_incentive_year_zone"),
    )


class CityClimateZone(Base):
    __tablename__ = "city_climate_zone"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    city_name: Mapped[str] = mapped_column(String(120), nullable=False)
    province: Mapped[str | None] = mapped_column(String(120))
    climate_zone: Mapped[str] = mapped_column(String(40), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    __table_args__ = (
        UniqueConstraint("city_name", name="uq_city_climate_zone_city"),
        Index("ix_city_climate_zone_city", "city_name"),
    )
```

Note: `Index` is already imported (used by `Bill`).

- [ ] **Step 4: Create the migration**

Create `alembic/versions/20260630_1300_incentives.py`:

```python
"""incentive params and city climate zones

Revision ID: a7b8c9d0e1f2
Revises: f6a1b2c3d4e5
Create Date: 2026-06-30 13:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID

revision: str = "a7b8c9d0e1f2"
down_revision: str | None = "f6a1b2c3d4e5"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "incentive_param_set",
        sa.Column("id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("effective_year", sa.Integer(), nullable=False),
        sa.Column("climate_zone", sa.String(length=40), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("params", JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("effective_year", "climate_zone", name="uq_incentive_year_zone"),
    )
    op.create_table(
        "city_climate_zone",
        sa.Column("id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("city_name", sa.String(length=120), nullable=False),
        sa.Column("province", sa.String(length=120), nullable=True),
        sa.Column("climate_zone", sa.String(length=40), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("city_name", name="uq_city_climate_zone_city"),
    )
    op.create_index("ix_city_climate_zone_city", "city_climate_zone", ["city_name"])


def downgrade() -> None:
    op.drop_index("ix_city_climate_zone_city", table_name="city_climate_zone")
    op.drop_table("city_climate_zone")
    op.drop_table("incentive_param_set")
```

Before writing the file, confirm the parent: `python -m alembic heads` should print `f6a1b2c3d4e5 (head)`. If it prints a different id, set `down_revision` to that id instead.

- [ ] **Step 5: Apply the migration to the test DB and the dev DB**

```bash
DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test python -m alembic upgrade head
python -m alembic upgrade head   # dev DB (uses DATABASE_URL from your env/.env)
```

Expected: `Running upgrade f6a1b2c3d4e5 -> a7b8c9d0e1f2, incentive params and city climate zones`.

- [ ] **Step 6: Add the new tables to the test cleanup fixture**

In `tests/integration/conftest.py`, add these two lines in BOTH the before-block (after line 17, the `DELETE FROM model_configs` line) and the after-block (after line 51):

```python
    await db_session.execute(text("DELETE FROM incentive_param_set"))
    await db_session.execute(text("DELETE FROM city_climate_zone"))
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `python -m pytest tests/integration/test_incentives_schema.py -v`
Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add src/energybot/core/models.py alembic/versions/20260630_1300_incentives.py tests/integration/test_incentives_schema.py tests/integration/conftest.py
git commit -m "feat(incentives): add incentive_param_set + city_climate_zone tables"
```

---

### Task 2: Incentives repository

**Files:**
- Create: `src/energybot/incentives/__init__.py`
- Create: `src/energybot/incentives/repository.py`
- Test: `tests/integration/test_incentives_repository.py`

**Interfaces:**
- Consumes: `IncentiveParamSet`, `CityClimateZone` (Task 1); `normalize_fa` from `energybot.core.normalize_fa`.
- Produces: `IncentiveRepository(session_factory)` with:
  - `async def active_param_set(self, climate_zone: str, year: int | None = None) -> IncentiveParamSet | None`
  - `async def resolve_city_zone(self, city: str) -> str | None`
  - `async def list_param_sets(self) -> list[IncentiveParamSet]`
  - `async def list_city_zones(self) -> list[CityClimateZone]`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_incentives_repository.py`:

```python
import pytest
from energybot.core.models import IncentiveParamSet, CityClimateZone
from energybot.incentives.repository import IncentiveRepository


def _repo(db_session):
    return IncentiveRepository(session_factory=lambda: db_session)


@pytest.mark.asyncio
async def test_active_param_set_returns_active_for_zone(db_session):
    db_session.add(IncentiveParamSet(effective_year=1403, climate_zone="normal",
                                     params={"v": 1}, is_active=False))
    db_session.add(IncentiveParamSet(effective_year=1404, climate_zone="normal",
                                     params={"v": 2}, is_active=True))
    await db_session.commit()
    ps = await _repo(db_session).active_param_set("normal")
    assert ps is not None
    assert ps.params["v"] == 2


@pytest.mark.asyncio
async def test_active_param_set_missing_zone_returns_none(db_session):
    ps = await _repo(db_session).active_param_set("hot")
    assert ps is None


@pytest.mark.asyncio
async def test_resolve_city_zone_normalizes(db_session):
    # stored normalized (normalize_fa lowercases + maps Arabic chars)
    db_session.add(CityClimateZone(city_name="تهران", climate_zone="normal", is_active=True))
    await db_session.commit()
    repo = _repo(db_session)
    assert await repo.resolve_city_zone("  تهران ") == "normal"
    assert await repo.resolve_city_zone("اهواز") is None


@pytest.mark.asyncio
async def test_resolve_city_zone_ignores_inactive(db_session):
    db_session.add(CityClimateZone(city_name="یزد", climate_zone="hot", is_active=False))
    await db_session.commit()
    assert await _repo(db_session).resolve_city_zone("یزد") is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/integration/test_incentives_repository.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'energybot.incentives'`.

- [ ] **Step 3: Create the package + repository**

Create `src/energybot/incentives/__init__.py` (empty file).

Create `src/energybot/incentives/repository.py`:

```python
from __future__ import annotations

from typing import Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import CityClimateZone, IncentiveParamSet
from energybot.core.normalize_fa import normalize_fa


class IncentiveRepository:
    def __init__(self, session_factory: Callable[[], AsyncSession]):
        self._sf = session_factory

    async def active_param_set(self, climate_zone: str, year: int | None = None) -> IncentiveParamSet | None:
        s = self._sf()
        q = select(IncentiveParamSet).where(
            IncentiveParamSet.climate_zone == climate_zone,
            IncentiveParamSet.is_active.is_(True),
        )
        if year is not None:
            q = q.where(IncentiveParamSet.effective_year == year)
        q = q.order_by(IncentiveParamSet.effective_year.desc())
        return (await s.execute(q)).scalars().first()

    async def resolve_city_zone(self, city: str) -> str | None:
        norm = normalize_fa(city)
        if not norm:
            return None
        s = self._sf()
        row = (await s.execute(
            select(CityClimateZone).where(
                CityClimateZone.city_name == norm,
                CityClimateZone.is_active.is_(True),
            )
        )).scalars().first()
        return row.climate_zone if row else None

    async def list_param_sets(self) -> list[IncentiveParamSet]:
        s = self._sf()
        return list((await s.execute(
            select(IncentiveParamSet).order_by(
                IncentiveParamSet.effective_year.desc(), IncentiveParamSet.climate_zone
            )
        )).scalars().all())

    async def list_city_zones(self) -> list[CityClimateZone]:
        s = self._sf()
        return list((await s.execute(
            select(CityClimateZone).order_by(CityClimateZone.city_name)
        )).scalars().all())
```

Note: `resolve_city_zone` matches on the normalized city, so city rows MUST be stored normalized (the seed in Task 4 and the admin API in Task 3 both call `normalize_fa` before insert).

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest tests/integration/test_incentives_repository.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/incentives/ tests/integration/test_incentives_repository.py
git commit -m "feat(incentives): repository for active param sets + city->zone resolution"
```

---

### Task 3: Admin CRUD API

**Files:**
- Create: `src/energybot/admin_api/incentives.py`
- Modify: `src/energybot/main.py` (import + `include_router`)
- Test: `tests/integration/test_admin_incentives.py`

**Interfaces:**
- Consumes: `IncentiveParamSet`, `CityClimateZone`, `AuditLog`, `AdminUser`; `current_admin`, `get_session`; `normalize_fa`.
- Produces router `prefix="/api/admin/incentives"` with: `GET /params`, `POST /params`, `PUT /params/{id}`, `DELETE /params/{id}`, `GET /cities`, `POST /cities`, `PUT /cities/{id}`, `DELETE /cities/{id}`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_admin_incentives.py`:

```python
import os
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from energybot.core.models import AdminUser, AuditLog, CityClimateZone, IncentiveParamSet
from energybot.core.security import hash_password

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


async def _login(c, db_session) -> dict:
    db_session.add(AdminUser(email="a@b.c", password_hash=hash_password("pass1234"), role="admin"))
    await db_session.commit()
    r = await c.post("/api/admin/login", json={"email": "a@b.c", "password": "pass1234"})
    return {"x-csrf": r.headers.get("x-csrf")}


@pytest.fixture
async def app(monkeypatch, db_session):
    for k, v in {"DATABASE_URL": TEST_DB, "SESSION_SECRET": "z" * 32, "BALE_WEBHOOK_SECRET": "x",
                  "BALE_BOT_TOKEN": "t", "FRONTIER_API_KEY": "f", "METIS_API_KEY": "m"}.items():
        monkeypatch.setenv(k, v)
    from energybot.settings import get_settings
    get_settings.cache_clear()
    import energybot.core.db as _db
    _db._engine = None
    _db._sessionmaker = None
    import energybot.admin_api.auth as _auth
    _auth._LOGIN_HITS.clear()
    from energybot.main import create_app
    return create_app()


@pytest.mark.asyncio
async def test_params_requires_auth(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/admin/incentives/params")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_create_and_list_param_set(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.post("/api/admin/incentives/params", headers=hdr, json={
            "effective_year": 1404, "climate_zone": "normal", "label": "عادی",
            "params": {"savings_reward": {"min_reduction_pct": 10}}, "is_active": True,
        })
        assert r.status_code == 200
        rid = r.json()["id"]
        lst = await c.get("/api/admin/incentives/params", headers=hdr)
    body = lst.json()
    assert any(p["id"] == rid and p["climate_zone"] == "normal" for p in body["params"])


@pytest.mark.asyncio
async def test_update_param_set_writes_audit(app, db_session):
    ps = IncentiveParamSet(effective_year=1404, climate_zone="hot", params={"v": 1}, is_active=False)
    db_session.add(ps)
    await db_session.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.put(f"/api/admin/incentives/params/{ps.id}", headers=hdr, json={
            "params": {"v": 2}, "is_active": True,
        })
    assert r.status_code == 200
    rows = (await db_session.execute(
        select(AuditLog).where(AuditLog.entity_id == str(ps.id))
    )).scalars().all()
    assert any(row.action == "update_incentive_param_set" for row in rows)


@pytest.mark.asyncio
async def test_create_city_normalizes_name(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.post("/api/admin/incentives/cities", headers=hdr, json={
            "city_name": "  تهران ", "province": "تهران", "climate_zone": "normal",
        })
    assert r.status_code == 200
    row = (await db_session.execute(select(CityClimateZone))).scalar_one()
    assert row.city_name == "تهران"  # trimmed + normalized


@pytest.mark.asyncio
async def test_delete_param_set(app, db_session):
    ps = IncentiveParamSet(effective_year=1404, climate_zone="normal", params={}, is_active=False)
    db_session.add(ps)
    await db_session.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.delete(f"/api/admin/incentives/params/{ps.id}", headers=hdr)
    assert r.status_code == 200
    remaining = (await db_session.execute(select(IncentiveParamSet))).scalars().all()
    assert remaining == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/integration/test_admin_incentives.py -v`
Expected: FAIL — 404s (router not registered) / import error.

- [ ] **Step 3: Create the admin router**

Create `src/energybot/admin_api/incentives.py`:

```python
from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session
from energybot.core.models import AdminUser, AuditLog, CityClimateZone, IncentiveParamSet
from energybot.core.normalize_fa import normalize_fa

router = APIRouter(prefix="/api/admin/incentives", tags=["admin-incentives"])


def _param_dict(p: IncentiveParamSet) -> dict[str, Any]:
    return {
        "id": str(p.id), "effective_year": p.effective_year, "climate_zone": p.climate_zone,
        "label": p.label, "params": p.params or {}, "is_active": p.is_active,
    }


def _city_dict(c: CityClimateZone) -> dict[str, Any]:
    return {
        "id": str(c.id), "city_name": c.city_name, "province": c.province,
        "climate_zone": c.climate_zone, "is_active": c.is_active,
    }


# ---------- param sets ----------

@router.get("/params")
async def list_params(_: AdminUser = Depends(current_admin),
                      s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    rows = (await s.execute(select(IncentiveParamSet).order_by(
        IncentiveParamSet.effective_year.desc(), IncentiveParamSet.climate_zone))).scalars().all()
    return {"params": [_param_dict(p) for p in rows]}


@router.post("/params")
async def create_param(payload: dict, _: AdminUser = Depends(current_admin),
                       s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    p = IncentiveParamSet(
        effective_year=int(payload["effective_year"]),
        climate_zone=str(payload["climate_zone"]).strip(),
        label=payload.get("label"),
        params=payload.get("params", {}),
        is_active=bool(payload.get("is_active", False)),
    )
    s.add(p)
    await s.commit()
    return {"id": str(p.id)}


@router.put("/params/{param_id}")
async def update_param(param_id: UUID, payload: dict, admin: AdminUser = Depends(current_admin),
                       s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    p = (await s.execute(select(IncentiveParamSet).where(IncentiveParamSet.id == param_id))).scalar_one_or_none()
    if p is None:
        raise HTTPException(404)
    before = _param_dict(p)
    if "effective_year" in payload:
        p.effective_year = int(payload["effective_year"])
    if "climate_zone" in payload:
        p.climate_zone = str(payload["climate_zone"]).strip()
    if "label" in payload:
        p.label = payload["label"]
    if "params" in payload:
        p.params = payload["params"]
    if "is_active" in payload:
        p.is_active = bool(payload["is_active"])
    s.add(AuditLog(admin_user_id=admin.id, action="update_incentive_param_set",
                   entity_type="incentive_param_set", entity_id=str(param_id),
                   before=before, after=_param_dict(p)))
    await s.commit()
    return {"ok": True}


@router.delete("/params/{param_id}")
async def delete_param(param_id: UUID, admin: AdminUser = Depends(current_admin),
                       s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    p = (await s.execute(select(IncentiveParamSet).where(IncentiveParamSet.id == param_id))).scalar_one_or_none()
    if p is None:
        raise HTTPException(404)
    await s.delete(p)
    s.add(AuditLog(admin_user_id=admin.id, action="delete_incentive_param_set",
                   entity_type="incentive_param_set", entity_id=str(param_id), before=None, after=None))
    await s.commit()
    return {"ok": True}


# ---------- city zones ----------

@router.get("/cities")
async def list_cities(_: AdminUser = Depends(current_admin),
                      s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    rows = (await s.execute(select(CityClimateZone).order_by(CityClimateZone.city_name))).scalars().all()
    return {"cities": [_city_dict(c) for c in rows]}


@router.post("/cities")
async def create_city(payload: dict, _: AdminUser = Depends(current_admin),
                      s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    c = CityClimateZone(
        city_name=normalize_fa(str(payload["city_name"])),
        province=payload.get("province"),
        climate_zone=str(payload["climate_zone"]).strip(),
        is_active=bool(payload.get("is_active", True)),
    )
    s.add(c)
    await s.commit()
    return {"id": str(c.id)}


@router.put("/cities/{city_id}")
async def update_city(city_id: UUID, payload: dict, admin: AdminUser = Depends(current_admin),
                      s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    c = (await s.execute(select(CityClimateZone).where(CityClimateZone.id == city_id))).scalar_one_or_none()
    if c is None:
        raise HTTPException(404)
    before = _city_dict(c)
    if "city_name" in payload:
        c.city_name = normalize_fa(str(payload["city_name"]))
    if "province" in payload:
        c.province = payload["province"]
    if "climate_zone" in payload:
        c.climate_zone = str(payload["climate_zone"]).strip()
    if "is_active" in payload:
        c.is_active = bool(payload["is_active"])
    s.add(AuditLog(admin_user_id=admin.id, action="update_city_climate_zone",
                   entity_type="city_climate_zone", entity_id=str(city_id),
                   before=before, after=_city_dict(c)))
    await s.commit()
    return {"ok": True}


@router.delete("/cities/{city_id}")
async def delete_city(city_id: UUID, admin: AdminUser = Depends(current_admin),
                      s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    c = (await s.execute(select(CityClimateZone).where(CityClimateZone.id == city_id))).scalar_one_or_none()
    if c is None:
        raise HTTPException(404)
    await s.delete(c)
    s.add(AuditLog(admin_user_id=admin.id, action="delete_city_climate_zone",
                   entity_type="city_climate_zone", entity_id=str(city_id), before=None, after=None))
    await s.commit()
    return {"ok": True}
```

- [ ] **Step 4: Register the router in `main.py`**

In `src/energybot/main.py`, add the import after line 20 (`from energybot.admin_api.bills import router as admin_bills_router`):

```python
from energybot.admin_api.incentives import router as admin_incentives_router
```

And add the include after line 113 (`app.include_router(admin_bills_router)`):

```python
    app.include_router(admin_incentives_router)
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `python -m pytest tests/integration/test_admin_incentives.py -v`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/admin_api/incentives.py src/energybot/main.py tests/integration/test_admin_incentives.py
git commit -m "feat(incentives): admin CRUD API for param sets + city zones"
```

---

### Task 4: Dev seed data

**Files:**
- Modify: `scripts/seed_dev.py` (add `seed_incentives`, import the models, wire into `main()` + argparse `--skip`)
- Test: `tests/integration/test_incentives_seed.py`

**Interfaces:**
- Consumes: `IncentiveParamSet`, `CityClimateZone`; `normalize_fa`; the seeding session pattern in `seed_dev.py`.
- Produces: `async def seed_incentives(session_maker, *, reset: bool = False) -> None` — idempotent; inserts param sets for zones `normal` + `hot` (year 1404) and a starter city list, all normalized.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_incentives_seed.py`:

```python
import pytest
from sqlalchemy import select
from energybot.core.models import CityClimateZone, IncentiveParamSet
from scripts.seed_dev import seed_incentives


@pytest.mark.asyncio
async def test_seed_incentives_is_idempotent(db_session):
    maker = lambda: db_session  # noqa: E731 — reuse the test session
    await seed_incentives(maker)
    await seed_incentives(maker)  # second run must not duplicate
    params = (await db_session.execute(select(IncentiveParamSet))).scalars().all()
    cities = (await db_session.execute(select(CityClimateZone))).scalars().all()
    zones = {p.climate_zone for p in params}
    assert {"normal", "hot"} <= zones
    # exactly one active set per seeded zone, no duplicates from the 2nd run
    assert len([p for p in params if p.climate_zone == "normal"]) == 1
    assert len(cities) >= 10
    # every seeded city resolves to a zone that has a param set
    assert all(c.climate_zone in zones for c in cities)
    # city names are stored normalized (lowercased, trimmed)
    assert all(c.city_name == c.city_name.strip() for c in cities)


@pytest.mark.asyncio
async def test_seed_params_shape(db_session):
    await seed_incentives(lambda: db_session)
    p = (await db_session.execute(
        select(IncentiveParamSet).where(IncentiveParamSet.climate_zone == "normal")
    )).scalar_one()
    assert p.params["savings_reward"]["min_reduction_pct"] == 10
    assert p.params["free_tier"]["summer"]["pattern_kwh"] > 0
    assert p.params["verified"] is False
```

Note: the test imports `from scripts.seed_dev import seed_incentives`. `scripts/` has no `__init__.py`; this import works because tests run from the repo root (on `sys.path`). If collection fails to import it, run pytest from the repo root (`python -m pytest ...`), which is the standard here.

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m pytest tests/integration/test_incentives_seed.py -v`
Expected: FAIL — `ImportError: cannot import name 'seed_incentives'`.

- [ ] **Step 3: Add `seed_incentives` and wire it in**

In `scripts/seed_dev.py`, extend the model import block (lines 32-37) to include the two new models:

```python
from energybot.core.models import (  # noqa: E402
    CityClimateZone,
    IncentiveParamSet,
    KBArticle,
    KBChunk,
    ModelConfig,
    PromptTemplate,
)
```

Add this section after `seed_model_configs` (before the `# ---------- Main ----------` comment near line 294). The numbers are representative and flagged `verified: false`:

```python
# ---------- Incentives ----------

# Representative Tavanir incentive numbers (rial). VERIFY against current figures
# before production — the admin screen (/admin/incentives) exists to correct these.
_INCENTIVE_SETS: list[dict] = [
    {
        "effective_year": 1404, "climate_zone": "normal", "label": "مناطق عادی ۱۴۰۴",
        "params": {
            "free_tier": {
                "summer": {"pattern_kwh": 300, "low_user_kwh": 200},
                "winter": {"pattern_kwh": 200, "low_user_kwh": 120},
            },
            "savings_reward": {
                "min_reduction_pct": 10, "reward_pct_of_bill": 30,
                "low_usage_threshold_kwh": 150, "per_kwh_rial_reward": 5000,
                "monthly_cap_rial": 8_500_000,
            },
            "verified": False, "last_verified": "1404",
        },
    },
    {
        "effective_year": 1404, "climate_zone": "hot", "label": "مناطق گرمسیر ۱۴۰۴",
        "params": {
            "free_tier": {
                "summer": {"pattern_kwh": 1500, "low_user_kwh": 1000},
                "winter": {"pattern_kwh": 600, "low_user_kwh": 400},
            },
            "savings_reward": {
                "min_reduction_pct": 10, "reward_pct_of_bill": 30,
                "low_usage_threshold_kwh": 150, "per_kwh_rial_reward": 5000,
                "monthly_cap_rial": 33_000_000,
            },
            "verified": False, "last_verified": "1404",
        },
    },
]

# Starter city -> climate zone list (illustrative; admin extends). Collapsed to the
# two seeded zones (normal / hot) for v1.
_CITY_ZONES: list[tuple[str, str, str]] = [
    ("تهران", "تهران", "normal"),
    ("مشهد", "خراسان رضوی", "normal"),
    ("اصفهان", "اصفهان", "normal"),
    ("شیراز", "فارس", "normal"),
    ("تبریز", "آذربایجان شرقی", "normal"),
    ("کرج", "البرز", "normal"),
    ("قم", "قم", "normal"),
    ("ارومیه", "آذربایجان غربی", "normal"),
    ("رشت", "گیلان", "normal"),
    ("کرمان", "کرمان", "normal"),
    ("اهواز", "خوزستان", "hot"),
    ("بندرعباس", "هرمزگان", "hot"),
    ("بوشهر", "بوشهر", "hot"),
    ("یزد", "یزد", "hot"),
    ("زاهدان", "سیستان و بلوچستان", "hot"),
    ("آبادان", "خوزستان", "hot"),
]


async def seed_incentives(session_maker, *, reset: bool = False) -> None:
    async with session_maker() as s:
        for spec in _INCENTIVE_SETS:
            existing = (await s.execute(
                select(IncentiveParamSet).where(
                    IncentiveParamSet.effective_year == spec["effective_year"],
                    IncentiveParamSet.climate_zone == spec["climate_zone"],
                )
            )).scalar_one_or_none()
            if existing and not reset:
                print(f"incentive {spec['climate_zone']}/{spec['effective_year']}: exists; skipping")
                continue
            if existing and reset:
                existing.label = spec["label"]
                existing.params = spec["params"]
                existing.is_active = True
                print(f"incentive {spec['climate_zone']}/{spec['effective_year']}: updated")
            else:
                s.add(IncentiveParamSet(
                    effective_year=spec["effective_year"], climate_zone=spec["climate_zone"],
                    label=spec["label"], params=spec["params"], is_active=True,
                ))
                print(f"incentive {spec['climate_zone']}/{spec['effective_year']}: inserted")
        for city, province, zone in _CITY_ZONES:
            norm = normalize_fa(city)
            existing_c = (await s.execute(
                select(CityClimateZone).where(CityClimateZone.city_name == norm)
            )).scalar_one_or_none()
            if existing_c:
                continue
            s.add(CityClimateZone(city_name=norm, province=province, climate_zone=zone, is_active=True))
        await s.commit()
```

Then wire it into `main()`. Add the argparse choice (line 303-304) so `kb`/`prompts`/`models`/`incentives` are all skippable:

```python
    parser.add_argument("--skip", choices=["prompts", "models", "kb", "incentives"], action="append", default=[],
                        help="skip a section (repeatable)")
```

And add the call after the KB block (after line 322, before `print("done.")`):

```python
    if "incentives" not in args.skip:
        print("== incentives ==")
        await seed_incentives(session_maker, reset=args.reset_models)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest tests/integration/test_incentives_seed.py -v`
Expected: 2 passed.

- [ ] **Step 5: Seed the dev DB and eyeball it**

```bash
python scripts/seed_dev.py --skip prompts --skip models --skip kb
```

Expected output includes `== incentives ==`, two `inserted` lines, and no duplicates on a second run.

- [ ] **Step 6: Commit**

```bash
git add scripts/seed_dev.py tests/integration/test_incentives_seed.py
git commit -m "feat(incentives): dev seed for param sets + starter city zones"
```

---

### Task 5: Admin UI screen

**Files:**
- Modify: `admin_ui/src/lib/api.ts` (add 8 methods)
- Create: `admin_ui/src/app/incentives/page.tsx`
- Modify: `admin_ui/src/components/Sidebar.tsx` (nav entry)
- Verify: `cd admin_ui && npm run build`

**Interfaces:**
- Consumes: the admin API from Task 3 (`/api/admin/incentives/...`).
- Produces: the `/admin/incentives` page and `api.listIncentiveParams` / `createIncentiveParam` / `updateIncentiveParam` / `deleteIncentiveParam` / `listCityZones` / `createCityZone` / `updateCityZone` / `deleteCityZone`.

This task has no JS unit-test runner in the repo; verification is a successful static build.

- [ ] **Step 1: Add the API client methods**

In `admin_ui/src/lib/api.ts`, add these inside the `api` object, after the `activateModel` line (line 42):

```typescript
  listIncentiveParams: () => request<{ params: any[] }>("/incentives/params"),
  createIncentiveParam: (d: any) => request<{ id: string }>("/incentives/params", { method: "POST", body: JSON.stringify(d) }),
  updateIncentiveParam: (id: string, d: any) => request(`/incentives/params/${id}`, { method: "PUT", body: JSON.stringify(d) }),
  deleteIncentiveParam: (id: string) => request(`/incentives/params/${id}`, { method: "DELETE" }),
  listCityZones: () => request<{ cities: any[] }>("/incentives/cities"),
  createCityZone: (d: any) => request<{ id: string }>("/incentives/cities", { method: "POST", body: JSON.stringify(d) }),
  updateCityZone: (id: string, d: any) => request(`/incentives/cities/${id}`, { method: "PUT", body: JSON.stringify(d) }),
  deleteCityZone: (id: string) => request(`/incentives/cities/${id}`, { method: "DELETE" }),
```

- [ ] **Step 2: Create the page**

Create `admin_ui/src/app/incentives/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { BadgePercent, Plus, Trash2, MapPin } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/PageHeader";
import { api } from "@/lib/api";

const DEFAULT_PARAMS = JSON.stringify({
  free_tier: { summer: { pattern_kwh: 300, low_user_kwh: 200 }, winter: { pattern_kwh: 200, low_user_kwh: 120 } },
  savings_reward: { min_reduction_pct: 10, reward_pct_of_bill: 30, low_usage_threshold_kwh: 150, per_kwh_rial_reward: 5000, monthly_cap_rial: 8500000 },
  verified: false, last_verified: "1404",
}, null, 2);

export default function IncentivesPage() {
  const [params, setParams] = useState<any[] | null>(null);
  const [cities, setCities] = useState<any[] | null>(null);
  const [year, setYear] = useState("1404");
  const [zone, setZone] = useState("normal");
  const [label, setLabel] = useState("");
  const [paramsJson, setParamsJson] = useState(DEFAULT_PARAMS);
  const [active, setActive] = useState(true);
  const [paramErr, setParamErr] = useState("");
  const [savingP, setSavingP] = useState(false);

  const [cityName, setCityName] = useState("");
  const [province, setProvince] = useState("");
  const [cityZone, setCityZone] = useState("normal");
  const [savingC, setSavingC] = useState(false);

  async function load() {
    const [p, c] = await Promise.all([api.listIncentiveParams(), api.listCityZones()]);
    setParams(p.params);
    setCities(c.cities);
  }
  useEffect(() => { load(); }, []);

  async function createParam() {
    setParamErr("");
    let parsed: any;
    try { parsed = JSON.parse(paramsJson); }
    catch { setParamErr("JSON نامعتبر است"); return; }
    setSavingP(true);
    try {
      await api.createIncentiveParam({ effective_year: Number(year), climate_zone: zone, label, params: parsed, is_active: active });
      setLabel("");
      await load();
    } finally { setSavingP(false); }
  }

  async function toggleActive(row: any) {
    await api.updateIncentiveParam(row.id, { is_active: !row.is_active });
    await load();
  }

  async function removeParam(id: string) {
    await api.deleteIncentiveParam(id);
    await load();
  }

  async function createCity() {
    if (!cityName) return;
    setSavingC(true);
    try {
      await api.createCityZone({ city_name: cityName, province, climate_zone: cityZone });
      setCityName(""); setProvince("");
      await load();
    } finally { setSavingC(false); }
  }

  async function removeCity(id: string) {
    await api.deleteCityZone(id);
    await load();
  }

  return (
    <>
      <PageHeader
        title="مشوق‌ها و پاداش‌ها"
        description="پارامترهای طرح‌های توانیر (برق امید، پاداش صرفه‌جویی) به تفکیک سال و اقلیم، و نگاشت شهر به اقلیم. اعداد را با ارقام رسمی توانیر به‌روز نگه دارید."
      />

      <div className="space-y-6">
        {/* Param sets */}
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4 text-primary" /> مجموعهٔ پارامتر جدید</CardTitle>
              <CardDescription>برای هر سال و اقلیم یک مجموعه. فقط مجموعهٔ «فعال» در محاسبه استفاده می‌شود.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="year">سال</Label>
                  <Input id="year" value={year} onChange={e => setYear(e.target.value)} className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="zone">اقلیم</Label>
                  <Input id="zone" value={zone} onChange={e => setZone(e.target.value)} placeholder="normal / hot" className="font-mono" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="label">برچسب</Label>
                <Input id="label" value={label} onChange={e => setLabel(e.target.value)} placeholder="مثل مناطق عادی ۱۴۰۴" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="params">پارامترها (JSON)</Label>
                <Textarea id="params" value={paramsJson} onChange={e => setParamsJson(e.target.value)} rows={12} className="font-mono text-xs leading-relaxed" />
                {paramErr && <p className="text-xs text-destructive">{paramErr}</p>}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> فعال
              </label>
              <Button onClick={createParam} disabled={savingP} className="w-full">
                {savingP ? "در حال ذخیره..." : "افزودن مجموعه"}
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-3 p-0 overflow-hidden">
            <CardHeader>
              <CardTitle>مجموعه‌های پارامتر</CardTitle>
              <CardDescription>{params ? `${params.length.toLocaleString("fa-IR")} مجموعه` : "بارگذاری..."}</CardDescription>
            </CardHeader>
            {params === null ? (
              <div className="space-y-2 px-6 pb-6">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : params.length === 0 ? (
              <div className="px-6 pb-6"><EmptyState icon={BadgePercent} title="هنوز پارامتری ثبت نشده" description="اولین مجموعه را با فرم سمت راست بسازید." /></div>
            ) : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>سال</TableHead><TableHead>اقلیم</TableHead><TableHead>برچسب</TableHead>
                  <TableHead className="text-center">وضعیت</TableHead><TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {params.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="tabular-nums">{r.effective_year}</TableCell>
                      <TableCell className="font-mono text-sm">{r.climate_zone}</TableCell>
                      <TableCell className="text-sm">{r.label}{r.params?.verified === false && <Badge variant="outline" className="ms-2">تأییدنشده</Badge>}</TableCell>
                      <TableCell className="text-center">
                        <Button size="sm" variant={r.is_active ? "success" : "outline"} onClick={() => toggleActive(r)}>
                          {r.is_active ? "فعال" : "غیرفعال"}
                        </Button>
                      </TableCell>
                      <TableCell className="text-end">
                        <Button size="sm" variant="ghost" onClick={() => removeParam(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>

        {/* City zones */}
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> شهر → اقلیم</CardTitle>
              <CardDescription>برای تشخیص اقلیم کاربر از روی شهر پروفایل استفاده می‌شود.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5"><Label htmlFor="city">شهر</Label><Input id="city" value={cityName} onChange={e => setCityName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="prov">استان</Label><Input id="prov" value={province} onChange={e => setProvince(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="cz">اقلیم</Label><Input id="cz" value={cityZone} onChange={e => setCityZone(e.target.value)} placeholder="normal / hot" className="font-mono" /></div>
              <Button onClick={createCity} disabled={savingC || !cityName} className="w-full">{savingC ? "در حال ذخیره..." : "افزودن شهر"}</Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-3 p-0 overflow-hidden">
            <CardHeader>
              <CardTitle>شهرها</CardTitle>
              <CardDescription>{cities ? `${cities.length.toLocaleString("fa-IR")} شهر` : "بارگذاری..."}</CardDescription>
            </CardHeader>
            {cities === null ? (
              <div className="space-y-2 px-6 pb-6">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : cities.length === 0 ? (
              <div className="px-6 pb-6"><EmptyState icon={MapPin} title="هنوز شهری ثبت نشده" description="اولین شهر را با فرم سمت راست بسازید." /></div>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>شهر</TableHead><TableHead>استان</TableHead><TableHead>اقلیم</TableHead><TableHead></TableHead></TableRow></TableHeader>
                <TableBody>
                  {cities.map(c => (
                    <TableRow key={c.id}>
                      <TableCell>{c.city_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.province}</TableCell>
                      <TableCell className="font-mono text-sm">{c.climate_zone}</TableCell>
                      <TableCell className="text-end"><Button size="sm" variant="ghost" onClick={() => removeCity(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
```

If `@/components/ui/textarea`, `card`, `badge`, `empty-state`, or `StatusBadge` imports fail to resolve, confirm the exact paths against `admin_ui/src/app/prompts/page.tsx` (which imports the same primitives) and adjust — they are the canonical reference.

- [ ] **Step 3: Add the sidebar nav entry**

In `admin_ui/src/components/Sidebar.tsx`, add `BadgePercent` to the lucide import block (after `ScrollText,` on line ~15):

```tsx
  BadgePercent,
```

Then add an item to the "سیستم" group (line 48-51). Replace that group object with:

```tsx
  {
    label: "سیستم",
    items: [
      { href: "/incentives", label: "مشوق‌ها", icon: BadgePercent },
      { href: "/audit-log", label: "گزارش تغییرات", icon: ScrollText },
    ],
  },
```

- [ ] **Step 4: Verify the build**

Run: `cd admin_ui && npm run build`
Expected: build succeeds; output includes a prerendered `/incentives` route (e.g. `○ /incentives`). No TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add admin_ui/src/lib/api.ts admin_ui/src/app/incentives/page.tsx admin_ui/src/components/Sidebar.tsx
git commit -m "feat(incentives): admin UI for incentive params + city zones"
```

---

## Plan-wide verification

After all tasks, run the backend suite for the new area and confirm green:

```bash
python -m pytest tests/integration/test_incentives_schema.py tests/integration/test_incentives_repository.py tests/integration/test_admin_incentives.py tests/integration/test_incentives_seed.py -v
```

Expected: all pass. Then a full run (`python -m pytest -q`) to confirm no regressions in the shared cleanup fixture.

## What Plan 2 inherits from this plan

- `IncentiveRepository.active_param_set(zone, year=None)` and `.resolve_city_zone(city)`.
- The `params` JSONB schema documented in **Global Constraints** (free_tier summer/winter pattern/low-user thresholds; savings_reward min_reduction_pct / reward_pct_of_bill / low_usage_threshold_kwh / per_kwh_rial_reward / monthly_cap_rial).
- Seeded zones `normal` + `hot`; a city resolving to a zone with no active param set → `active_param_set` returns `None` (Plan 2's calculator must handle this with the national-default fallback from the spec).
