from fastapi import APIRouter, Depends
from energybot.core.db import get_sessionmaker
from energybot.core.models import User
from energybot.user_api.auth import current_user
from energybot.memory.repository import MemoryRepository
from energybot.memory.render import _HEADINGS

router = APIRouter(prefix="/api/app", tags=["app"])


@router.get("/memory")
async def get_memory(user: User = Depends(current_user)):
    Session = get_sessionmaker()
    async with Session() as session:
        repo = MemoryRepository(session_factory=lambda: session)
        items = await repo.list_active(user.id)
    by_cat: dict[str, list] = {}
    for it in items:
        by_cat.setdefault(it.category, []).append({"id": it.id, "text": it.text})
    categories = [
        {"key": key, "label": label, "items": by_cat[key]}
        for key, label in _HEADINGS
        if by_cat.get(key)
    ]
    return {"categories": categories}
