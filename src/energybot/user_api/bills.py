from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from energybot.core.db import get_sessionmaker
from energybot.core.models import User
from energybot.user_api.auth import current_user
from energybot.billing.factory import build_billing_service
from energybot.billing.repository import BillingRepository
from energybot.logging import get_logger

router = APIRouter(prefix="/api/app", tags=["app"])


class InquireIn(BaseModel):
    bill_id: str


def _bill_dict(b) -> dict:
    return {
        "id": str(b.id), "utility_type": b.utility_type, "amount": int(b.amount),
        "term": b.term,
        "consumption": float(b.consumption) if b.consumption is not None else None,
        "due_date": b.due_date.isoformat() if b.due_date else None,
        "status": b.status, "inquired_at": b.inquired_at.isoformat(),
    }


@router.get("/bills")
async def list_bills(user: User = Depends(current_user)):
    Session = get_sessionmaker()
    async with Session() as session:
        repo = BillingRepository(session_factory=lambda: session)
        subs = await repo.list_subscriptions(user.id)
        bills = await repo.recent_bills(user.id, limit=24)
        return {
            "subscriptions": [
                {"id": str(x.id), "utility_type": x.utility_type, "bill_id": x.bill_id, "label": x.label}
                for x in subs
            ],
            "bills": [_bill_dict(b) for b in bills],
        }


@router.post("/bills/inquire")
async def inquire(payload: InquireIn, user: User = Depends(current_user)):
    Session = get_sessionmaker()
    async with Session() as session:
        svc = build_billing_service(lambda: session)
        try:
            res = await svc.handle_input(user.id, text=payload.bill_id)
        except Exception:
            get_logger(__name__).exception("web_bill_inquire_failed", user_id=str(user.id))
            raise HTTPException(status_code=400, detail="در پردازش قبض مشکلی پیش اومد.")
        return {"ok": res.ok, "summary": res.summary, "bill_db_id": res.bill_db_id, "error": res.error}


@router.post("/bills/{bill_db_id}/pay")
async def pay(bill_db_id: str, user: User = Depends(current_user)):
    try:
        bid = UUID(bill_db_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="not found")
    Session = get_sessionmaker()
    async with Session() as session:
        svc = build_billing_service(lambda: session)
        try:
            url = await svc.start_payment(user.id, user.bale_user_id, bid)
        except ValueError:
            raise HTTPException(status_code=404, detail="قبض یافت نشد.")
        except Exception:
            get_logger(__name__).exception("web_bill_pay_failed", user_id=str(user.id))
            raise HTTPException(status_code=400, detail="ایجاد لینک پرداخت ناموفق بود.")
        return {"url": url}
