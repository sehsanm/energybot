from collections.abc import Callable
from datetime import datetime
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import UtilitySubscription, Bill, BillPayment
from energybot.billing.finnotech_client import BillDetail
from energybot.billing.payment import PaymentSession


def _parse_due(due: str | None):
    return None  # due dates arrive as Jalali strings; stored only in raw_inquiry for now


class BillingRepository:
    def __init__(self, *, session_factory: Callable[[], AsyncSession]):
        self._session_factory = session_factory

    async def get_or_create_subscription(self, user_id: UUID, *, utility_type: str, bill_id: str) -> UtilitySubscription:
        s = self._session_factory()
        existing = (await s.execute(
            select(UtilitySubscription).where(
                UtilitySubscription.user_id == user_id,
                UtilitySubscription.bill_id == bill_id,
                UtilitySubscription.deleted_at.is_(None),
            )
        )).scalar_one_or_none()
        if existing is not None:
            return existing
        sub = UtilitySubscription(user_id=user_id, utility_type=utility_type, bill_id=bill_id)
        s.add(sub)
        await s.commit()
        await s.refresh(sub)
        return sub

    async def add_bill(self, user_id: UUID, subscription_id: UUID, detail: BillDetail) -> Bill:
        s = self._session_factory()
        bill = Bill(
            user_id=user_id, subscription_id=subscription_id, utility_type=detail.utility_type,
            pay_id=detail.pay_id, amount=detail.amount, term=detail.term,
            due_date=_parse_due(detail.due_date), status="inquired", raw_inquiry=detail.raw,
        )
        s.add(bill)
        await s.commit()
        await s.refresh(bill)
        return bill

    async def create_payment(self, user_id: UUID, *, bill_db_id: UUID, chat_id: int,
                             provider: str, amount: int, session: PaymentSession) -> BillPayment:
        s = self._session_factory()
        pay = BillPayment(
            bill_db_id=bill_db_id, user_id=user_id, chat_id=chat_id, provider=provider,
            amount=amount, status="pending", gateway_ref=session.gateway_ref,
            redirect_url=session.redirect_url, raw=session.raw,
        )
        s.add(pay)
        await s.commit()
        await s.refresh(pay)
        return pay

    async def get_payment_by_ref(self, gateway_ref: str) -> BillPayment | None:
        s = self._session_factory()
        return (await s.execute(
            select(BillPayment).where(BillPayment.gateway_ref == gateway_ref)
        )).scalar_one_or_none()

    async def mark_payment(self, payment_id: UUID, *, success: bool, raw: dict) -> BillPayment:
        s = self._session_factory()
        pay = (await s.execute(select(BillPayment).where(BillPayment.id == payment_id))).scalar_one()
        pay.status = "success" if success else "failed"
        pay.raw = {**(pay.raw or {}), "verify": raw}
        if success:
            pay.paid_at = datetime.utcnow()
            bill = (await s.execute(select(Bill).where(Bill.id == pay.bill_db_id))).scalar_one()
            bill.status = "paid"
        await s.commit()
        await s.refresh(pay)
        return pay

    async def recent_bills(self, user_id: UUID, limit: int = 12) -> list[Bill]:
        s = self._session_factory()
        return list((await s.execute(
            select(Bill).where(Bill.user_id == user_id).order_by(Bill.inquired_at.desc()).limit(limit)
        )).scalars().all())
