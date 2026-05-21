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
