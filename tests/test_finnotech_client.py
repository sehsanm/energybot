import httpx
import pytest
from energybot.billing.finnotech_client import FinnotechClient, FinnotechError


def _client(handler):
    return FinnotechClient(
        client_id="cid", client_secret="csec", national_id="0000000000",
        scope="billing:cc-inquiry-detail:get", base_url="https://fin.test",
        token_path="/dev/v2/oauth2/token",
        inquiry_path="/billing/v2/clients/{client_id}/billInquiry",
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.asyncio
async def test_inquire_bill_fetches_token_then_queries():
    seen = []

    def handler(request):
        seen.append(str(request.url))
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(200, json={"result": {"value": "TOK", "lifeTime": 3600000}, "status": "DONE"})
        assert request.headers["Authorization"] == "Bearer TOK"
        assert "billId=117709580013" in str(request.url)
        return httpx.Response(200, json={"status": "DONE", "result": {
            "billId": "117709580013", "paymentId": "0151101290107",
            "amount": "152000", "billType": "ELECTRICITY", "term": "1404/03", "dueDate": "1404/04/15",
        }})

    c = _client(handler)
    detail = await c.inquire_bill("117709580013")
    assert detail.amount == 152000
    assert detail.utility_type == "electricity"
    assert detail.pay_id == "0151101290107"
    assert any("oauth2/token" in u for u in seen)


@pytest.mark.asyncio
async def test_token_is_reused_across_calls():
    token_calls = {"n": 0}

    def handler(request):
        if request.url.path.endswith("/oauth2/token"):
            token_calls["n"] += 1
            return httpx.Response(200, json={"result": {"value": "TOK", "lifeTime": 3600000}, "status": "DONE"})
        return httpx.Response(200, json={"status": "DONE", "result": {"amount": "1", "billType": "GAS"}})

    c = _client(handler)
    await c.inquire_bill("117709580013")
    await c.inquire_bill("117709580013")
    assert token_calls["n"] == 1


@pytest.mark.asyncio
async def test_error_status_raises():
    def handler(request):
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(200, json={"result": {"value": "TOK", "lifeTime": 3600000}, "status": "DONE"})
        return httpx.Response(200, json={"status": "FAILED", "error": {"message": "bad bill"}})

    c = _client(handler)
    with pytest.raises(FinnotechError):
        await c.inquire_bill("117709580013")
