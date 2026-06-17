import base64
import time
import uuid
from dataclasses import dataclass
from typing import Any
import httpx
from energybot.billing.bill_numbers import utility_type_for


@dataclass(slots=True)
class BillDetail:
    bill_id: str
    pay_id: str | None
    amount: int
    utility_type: str
    term: str | None
    due_date: str | None
    raw: dict


class FinnotechError(Exception):
    pass


def _normalise_type(value: str | None, bill_id: str) -> str:
    v = (value or "").strip().lower()
    if "elec" in v or "برق" in v:
        return "electricity"
    if "gas" in v or "گاز" in v:
        return "gas"
    return utility_type_for(bill_id)


class FinnotechClient:
    def __init__(self, *, client_id: str, client_secret: str, national_id: str,
                 scope: str, base_url: str, token_path: str, inquiry_path: str,
                 transport: httpx.AsyncBaseTransport | None = None):
        self._client_id = client_id
        self._client_secret = client_secret
        self._national_id = national_id
        self._scope = scope
        self._base = base_url.rstrip("/")
        self._token_path = token_path
        self._inquiry_path = inquiry_path
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), transport=transport)
        self._token: str | None = None
        self._token_expiry: float = 0.0

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _ensure_token(self) -> str:
        if self._token and time.monotonic() < self._token_expiry - 60:
            return self._token
        basic = base64.b64encode(f"{self._client_id}:{self._client_secret}".encode()).decode()
        try:
            r = await self._client.post(
                f"{self._base}{self._token_path}",
                headers={"Authorization": f"Basic {basic}", "Content-Type": "application/json"},
                json={"grant_type": "client_credentials", "nid": self._national_id, "scopes": self._scope},
            )
        except httpx.HTTPError as e:
            raise FinnotechError(f"token request failed: {e}") from e
        if r.status_code >= 400:
            raise FinnotechError(f"token http {r.status_code}")
        data = r.json()
        result = data.get("result") or {}
        token = result.get("value")
        if not token:
            raise FinnotechError("no token in response")
        life_ms = int(result.get("lifeTime", 3600000))
        self._token = token
        self._token_expiry = time.monotonic() + life_ms / 1000.0
        return token

    async def inquire_bill(self, bill_id: str) -> BillDetail:
        token = await self._ensure_token()
        path = self._inquiry_path.format(client_id=self._client_id)
        params = {"billId": bill_id, "trackId": uuid.uuid4().hex}
        try:
            r = await self._client.get(
                f"{self._base}{path}", params=params,
                headers={"Authorization": f"Bearer {token}"},
            )
        except httpx.HTTPError as e:
            raise FinnotechError(f"inquiry request failed: {e}") from e
        if r.status_code >= 400:
            raise FinnotechError(f"inquiry http {r.status_code}")
        data: dict[str, Any] = r.json()
        if str(data.get("status", "")).upper() not in ("DONE", "OK", "SUCCESS"):
            raise FinnotechError(f"inquiry failed: status={data.get('status')} code={(data.get('error') or {}).get('code')}")
        result = data.get("result") or {}
        amount_raw = result.get("amount") or result.get("billAmount") or 0
        return BillDetail(
            bill_id=str(result.get("billId") or bill_id),
            pay_id=(str(result["paymentId"]) if result.get("paymentId") else
                    (str(result["payId"]) if result.get("payId") else None)),
            amount=int(str(amount_raw).replace(",", "") or 0),
            utility_type=_normalise_type(result.get("billType") or result.get("type"), bill_id),
            term=result.get("term") or result.get("period"),
            due_date=result.get("dueDate") or result.get("paymentDeadLine"),
            raw=data,
        )


class FakeFinnotechClient:
    def __init__(self, detail: BillDetail | None = None, error: Exception | None = None):
        self._detail = detail
        self._error = error

    async def inquire_bill(self, bill_id: str) -> BillDetail:
        if self._error:
            raise self._error
        if self._detail:
            return self._detail
        return BillDetail(bill_id=bill_id, pay_id="0151101290107", amount=152000,
                          utility_type="electricity", term="1404/03", due_date="1404/04/15", raw={})
