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
        target = (await s.execute(select(ModelConfig).where(ModelConfig.id == config_id))).scalar_one()
        await s.execute(
            update(ModelConfig)
            .where(ModelConfig.call_type == target.call_type, ModelConfig.is_active.is_(True))
            .values(is_active=False)
        )
        target.is_active = True
        await s.commit()
