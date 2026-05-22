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
