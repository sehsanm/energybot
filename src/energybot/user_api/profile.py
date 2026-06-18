from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from energybot.core.db import get_sessionmaker
from energybot.core.models import User
from energybot.user_api.auth import current_user
from energybot.profile.repository import ProfileRepository
from energybot.profile.wizard import household_field_schema, normalize_household_value

router = APIRouter(prefix="/api/app", tags=["app"])


class PatchIn(BaseModel):
    path: str
    value: str


class ItemIn(BaseModel):
    text: str


def _profile_dict(p) -> dict:
    return {
        "household": p.household, "behaviour": p.behaviour,
        "goals": p.goals, "commitments": p.commitments,
        "completeness_score": p.completeness_score,
        "fields": household_field_schema(),
    }


@router.get("/profile")
async def get_profile(user: User = Depends(current_user)):
    Session = get_sessionmaker()
    async with Session() as session:
        repo = ProfileRepository(session_factory=lambda: session)
        p = await repo.get(user.id)
        return _profile_dict(p)


@router.patch("/profile")
async def patch_profile(payload: PatchIn, user: User = Depends(current_user)):
    try:
        normalized = normalize_household_value(payload.path, payload.value)
    except KeyError:
        raise HTTPException(status_code=422, detail="فیلد نامعتبر است.")
    except ValueError:
        raise HTTPException(status_code=422, detail="مقدار نامعتبر است.")
    Session = get_sessionmaker()
    async with Session() as session:
        repo = ProfileRepository(session_factory=lambda: session)
        await repo.set(user.id, payload.path, normalized, source="web", reason="web edit")
        return _profile_dict(await repo.get(user.id))


@router.post("/profile/{section}")
async def add_item(section: str, payload: ItemIn, user: User = Depends(current_user)):
    if section not in ("goals", "commitments"):
        raise HTTPException(status_code=404, detail="not found")
    Session = get_sessionmaker()
    async with Session() as session:
        repo = ProfileRepository(session_factory=lambda: session)
        await repo.append(user.id, section, payload.text, source="web", reason="web edit")
        return _profile_dict(await repo.get(user.id))


@router.delete("/profile/{section}/{index}")
async def remove_item(section: str, index: int, user: User = Depends(current_user)):
    if section not in ("goals", "commitments"):
        raise HTTPException(status_code=404, detail="not found")
    Session = get_sessionmaker()
    async with Session() as session:
        repo = ProfileRepository(session_factory=lambda: session)
        try:
            await repo.remove_item(user.id, section, index, source="web", reason="web edit")
        except IndexError:
            raise HTTPException(status_code=404, detail="not found")
        return _profile_dict(await repo.get(user.id))
