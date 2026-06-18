from fastapi import APIRouter, Depends
from energybot.core.db import get_sessionmaker
from energybot.core.models import User
from energybot.user_api.auth import current_user
from energybot.profile.repository import ProfileRepository
from energybot.billing.repository import BillingRepository

router = APIRouter(prefix="/api/app", tags=["app"])


def _bill_brief(b) -> dict:
    return {
        "id": str(b.id), "utility_type": b.utility_type, "amount": int(b.amount),
        "term": b.term, "due_date": b.due_date.isoformat() if b.due_date else None,
        "status": b.status,
    }


@router.get("/dashboard")
async def dashboard(user: User = Depends(current_user)):
    Session = get_sessionmaker()
    async with Session() as session:
        sf = lambda: session
        profile = await ProfileRepository(session_factory=sf).get(user.id)
        bills = await BillingRepository(session_factory=sf).recent_bills(user.id, limit=24)
        with_consumption = [b for b in bills if b.consumption is not None]
        trend = [
            {"term": b.term, "consumption": float(b.consumption), "utility_type": b.utility_type}
            for b in reversed(with_consumption)
        ]
        return {
            "completeness_score": profile.completeness_score,
            "latest_bill": _bill_brief(bills[0]) if bills else None,
            "trend": trend,
        }
