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
