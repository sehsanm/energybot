import os
import pytest
from energybot.core.models import User, ChatSession
from energybot.chat.repository import ChatRepository

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


async def _seed(db_session):
    u = User(bale_user_id=515151)
    db_session.add(u)
    await db_session.flush()
    sess = ChatSession(user_id=u.id)
    db_session.add(sess)
    await db_session.flush()
    repo = ChatRepository(session_factory=lambda: db_session)
    ids = []
    for i in range(5):
        ids.append(await repo.add_message(u.id, sess.id, role="user", content=f"u{i}"))
        ids.append(await repo.add_message(u.id, sess.id, role="assistant", content=f"a{i}"))
    # a stray tool row that must be excluded from history
    await repo.add_message(u.id, sess.id, role="tool", content="{}", tool_name="search_kb")
    return u, repo, ids


@pytest.mark.asyncio
async def test_history_page_returns_user_and_assistant_oldest_first(db_session):
    u, repo, ids = await _seed(db_session)
    page = await repo.history_page(u.id, limit=4)
    assert [m.content for m in page] == ["u3", "a3", "u4", "a4"]  # newest 4, oldest-first
    assert all(m.role in ("user", "assistant") for m in page)


@pytest.mark.asyncio
async def test_history_page_before_cursor_paginates(db_session):
    u, repo, ids = await _seed(db_session)
    first = await repo.history_page(u.id, limit=4)
    older = await repo.history_page(u.id, before=first[0].id, limit=4)
    assert [m.content for m in older] == ["u1", "a1", "u2", "a2"]


@pytest.mark.asyncio
async def test_latest_assistant_message_id(db_session):
    u, repo, ids = await _seed(db_session)
    last = await repo.latest_assistant_message_id(u.id)
    # last assistant content was "a4"; its id is the max assistant id
    assert last is not None
    page = await repo.history_page(u.id, limit=1)
    assert page[0].content == "a4" and page[0].id == last
