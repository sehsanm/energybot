from dataclasses import dataclass
from uuid import UUID
from energybot.billing.barcode import decode_bill_barcode
from energybot.billing.bill_numbers import parse_bill_numbers, BillNumbers
from energybot.billing.finnotech_client import BillDetail, FinnotechError
from energybot.billing.repository import BillingRepository
from energybot.logging import get_logger

log = get_logger(__name__)

_MANUAL_HINT = "نتونستم بارکد رو بخونم. لطفاً شناسه قبض و شناسه پرداخت را تایپ کن (مثل: ۱۱۷۷... ۰۱۵۱...)."
_BAD_INPUT = "شناسه قبض معتبر پیدا نکردم. می‌تونی عکس واضح‌تر بفرستی یا عدد رو تایپ کنی."
_FIN_DOWN = "سرویس استعلام قبض موقتاً در دسترس نیست. کمی بعد دوباره امتحان کن."


@dataclass(slots=True)
class CaptureResult:
    ok: bool
    summary: str
    pay_callback: str | None
    bill_db_id: str | None
    error: str | None


def _fmt_amount(rial: int) -> str:
    toman = rial // 10
    return f"{toman:,} تومان"


def render_summary(detail: BillDetail) -> str:
    kind = {"electricity": "برق", "gas": "گاز"}.get(detail.utility_type, "قبض")
    lines = [f"📄 قبض {kind}", f"مبلغ: {_fmt_amount(detail.amount)}"]
    if detail.term:
        lines.append(f"دوره: {detail.term}")
    if detail.due_date:
        lines.append(f"مهلت پرداخت: {detail.due_date}")
    return "\n".join(lines)


class BillingService:
    def __init__(self, *, finnotech, payment, repo: BillingRepository,
                 callback_base_url: str, provider_name: str):
        self._fin = finnotech
        self._pay = payment
        self._repo = repo
        self._callback_base = callback_base_url.rstrip("/")
        self._provider_name = provider_name

    def _capture_numbers(self, *, image_bytes: bytes | None, text: str | None) -> BillNumbers | None:
        if image_bytes is not None:
            return decode_bill_barcode(image_bytes)
        if text:
            try:
                return parse_bill_numbers(text)
            except ValueError:
                return None
        return None

    async def handle_input(self, user_id: UUID, *, image_bytes: bytes | None = None,
                           text: str | None = None) -> CaptureResult:
        bn = self._capture_numbers(image_bytes=image_bytes, text=text)
        if bn is None:
            msg = _MANUAL_HINT if image_bytes is not None else _BAD_INPUT
            return CaptureResult(False, "", None, None, msg)
        try:
            detail = await self._fin.inquire_bill(bn.bill_id)
        except FinnotechError as e:
            log.warning("finnotech_inquiry_failed", error=str(e), user_id=str(user_id))
            return CaptureResult(False, "", None, None, _FIN_DOWN)
        sub = await self._repo.get_or_create_subscription(
            user_id, utility_type=detail.utility_type, bill_id=bn.bill_id)
        bill = await self._repo.add_bill(user_id, sub.id, detail)
        return CaptureResult(
            ok=True, summary=render_summary(detail),
            pay_callback=f"pay:{bill.id}", bill_db_id=str(bill.id), error=None,
        )

    async def start_payment(self, user_id: UUID, chat_id: int, bill_db_id: UUID) -> str:
        bill = await self._repo.get_bill_by_id(bill_db_id)
        if bill is None:
            raise ValueError("bill not found")
        sub = await self._repo.get_subscription_by_id(bill.subscription_id)
        if sub is None:
            raise ValueError("subscription not found")
        return_url = f"{self._callback_base}/pay/callback"
        # bill_id here is the gateway-facing identifier used only in the payment
        # description/metadata; the pay_id (شناسه‌پرداخت) is the meaningful value.
        session = await self._pay.create_session(
            amount=int(bill.amount), bill_id=sub.bill_id,
            pay_id=bill.pay_id, return_url=return_url)
        await self._repo.create_payment(
            user_id, bill_db_id=bill.id, chat_id=chat_id, provider=self._provider_name,
            amount=int(bill.amount), session=session)
        return session.redirect_url

    async def complete_payment(self, gateway_ref: str, params: dict) -> tuple[int, bool]:
        pay = await self._repo.get_payment_by_ref(gateway_ref)
        if pay is None:
            raise ValueError("payment not found")
        result = await self._pay.verify(gateway_ref=gateway_ref, params=params)
        await self._repo.mark_payment(pay.id, success=result.success, raw=result.raw)
        return pay.chat_id, result.success
