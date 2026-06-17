import httpx
import pytest
from energybot.billing.payment import GenericRedirectProvider, FakePaymentProvider


@pytest.mark.asyncio
async def test_generic_create_session_builds_redirect():
    def handler(request):
        return httpx.Response(200, json={"authority": "AUTH123", "url": "https://pay.test/AUTH123"})
    p = GenericRedirectProvider(gateway_base="https://pay.test", merchant_id="M1",
                                transport=httpx.MockTransport(handler))
    sess = await p.create_session(amount=152000, bill_id="117709580013", pay_id="0151101290107",
                                  return_url="https://bot.test/pay/callback")
    assert sess.gateway_ref == "AUTH123"
    assert sess.redirect_url == "https://pay.test/AUTH123"


@pytest.mark.asyncio
async def test_generic_verify_success():
    def handler(request):
        return httpx.Response(200, json={"status": 100, "refId": "R9"})
    p = GenericRedirectProvider(gateway_base="https://pay.test", merchant_id="M1",
                                transport=httpx.MockTransport(handler))
    res = await p.verify(gateway_ref="AUTH123", params={"Status": "OK"})
    assert res.success is True


@pytest.mark.asyncio
async def test_fake_provider_roundtrip():
    p = FakePaymentProvider()
    sess = await p.create_session(amount=1, bill_id="b", pay_id=None, return_url="r")
    assert sess.redirect_url
    ok = await p.verify(gateway_ref=sess.gateway_ref, params={"ok": "1"})
    assert ok.success is True
    bad = await p.verify(gateway_ref=sess.gateway_ref, params={"ok": "0"})
    assert bad.success is False
