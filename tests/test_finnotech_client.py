import httpx
import pytest
from energybot.billing.finnotech_client import FinnotechClient, FinnotechError

# Real, checksum-valid electricity bill id (service code 2 in the ...12|6 tail).
ELEC_BILL = "9706459904126"


def _client(handler):
    return FinnotechClient(
        client_id="cid", client_secret="csec", national_id="0000000000",
        scope="billing:cc-inquiry-detail:get", base_url="https://fin.test",
        token_path="/dev/v2/oauth2/token",
        inquiry_path="/billing/v2/clients/{client_id}/detailBillingInquiry",
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
        assert request.url.path.endswith("/detailBillingInquiry")
        assert f"parameter={ELEC_BILL}" in str(request.url)
        assert "type=Electricity" in str(request.url)
        return httpx.Response(200, json={"status": "DONE", "result": {
            "Amount": "152000", "BillId": ELEC_BILL, "PayId": "0151101290107",
            "Date": "1404/04/15", "Info": {"Year": "1404", "Period": "3"},
        }})

    c = _client(handler)
    detail = await c.inquire_bill(ELEC_BILL)
    assert detail.amount == 152000
    assert detail.utility_type == "electricity"
    assert detail.pay_id == "0151101290107"
    assert detail.term == "1404/3"
    assert detail.due_date == "1404/04/15"
    assert any("oauth2/token" in u for u in seen)


@pytest.mark.asyncio
async def test_token_is_reused_across_calls():
    token_calls = {"n": 0}

    def handler(request):
        if request.url.path.endswith("/oauth2/token"):
            token_calls["n"] += 1
            return httpx.Response(200, json={"result": {"value": "TOK", "lifeTime": 3600000}, "status": "DONE"})
        return httpx.Response(200, json={"status": "DONE", "result": {"Amount": "1"}})

    c = _client(handler)
    await c.inquire_bill(ELEC_BILL)
    await c.inquire_bill(ELEC_BILL)
    assert token_calls["n"] == 1


@pytest.mark.asyncio
async def test_error_status_raises():
    def handler(request):
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(200, json={"result": {"value": "TOK", "lifeTime": 3600000}, "status": "DONE"})
        return httpx.Response(200, json={"status": "FAILED", "error": {"message": "bad bill"}})

    c = _client(handler)
    with pytest.raises(FinnotechError):
        await c.inquire_bill(ELEC_BILL)


@pytest.mark.asyncio
async def test_bill_not_found_raises():
    # Finnotech answers DONE with {"message": "قبضی یافت نشد"} and no Amount.
    def handler(request):
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(200, json={"result": {"value": "TOK", "lifeTime": 3600000}, "status": "DONE"})
        return httpx.Response(200, json={"status": "DONE", "result": {"message": "قبضی یافت نشد"}})

    c = _client(handler)
    with pytest.raises(FinnotechError):
        await c.inquire_bill(ELEC_BILL)


@pytest.mark.asyncio
async def test_inquire_bill_populates_details():
    def handler(request):
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(200, json={"result": {"value": "TOK", "lifeTime": 3600000}, "status": "DONE"})
        return httpx.Response(200, json={"status": "DONE", "result": {
            "Amount": "6492000", "BillId": ELEC_BILL, "PayId": "649250240",
            "Date": "1405/03/31",
            "Info": {"TariffType": "خانگی", "Period": "2", "Year": "1405",
                     "NormalConsumption": "366", "PeakConsumption": "136",
                     "LowConsumption": "173", "FridayConsumption": "0",
                     "PeriodAmount": "10775136", "PreviousDebt": "6497683"},
        }})

    c = _client(handler)
    d = await c.inquire_bill(ELEC_BILL)
    assert d.details["tariff"] == "خانگی"
    assert d.details["consumption"]["total"] == 675
    assert d.details["amounts"]["period"] == 10775136
    assert d.amount == 6492000  # top-level Amount unchanged on BillDetail
