from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from energybot.bale_adapter.handler import build_billing_service, get_bale_client
from energybot.core.db import get_sessionmaker
from energybot.logging import get_logger

log = get_logger(__name__)
router = APIRouter()

_OK_HTML = "<html dir='rtl'><body style='font-family:sans-serif;text-align:center;padding:40px'>" \
           "<h2>✅ پرداخت موفق بود</h2><p>به ربات برگرد.</p></body></html>"
_FAIL_HTML = "<html dir='rtl'><body style='font-family:sans-serif;text-align:center;padding:40px'>" \
             "<h2>❌ پرداخت ناموفق بود</h2><p>دوباره از داخل ربات تلاش کن.</p></body></html>"


def get_session_factory_for_request():
    Session = get_sessionmaker()
    return lambda: Session()  # service opens/commits its own sessions


@router.get("/pay/callback")
async def pay_callback(request: Request) -> HTMLResponse:
    params = dict(request.query_params)
    gateway_ref = params.get("authority") or params.get("ref") or ""
    session_factory = get_session_factory_for_request()
    svc = build_billing_service(session_factory)
    try:
        chat_id, success = await svc.complete_payment(gateway_ref, params)
    except Exception as e:  # noqa: BLE001
        log.warning("pay_callback_failed", error=str(e), ref=gateway_ref)
        return HTMLResponse(_FAIL_HTML, status_code=200)
    bale = get_bale_client()
    try:
        msg = "پرداخت قبض با موفقیت انجام شد ✅" if success else "پرداخت ناموفق بود. می‌تونی دوباره تلاش کنی."
        await bale.send_message(chat_id=chat_id, text=msg)
    except Exception as e:  # noqa: BLE001
        log.warning("pay_callback_notify_failed", error=str(e), chat_id=chat_id)
    return HTMLResponse(_OK_HTML if success else _FAIL_HTML, status_code=200)
