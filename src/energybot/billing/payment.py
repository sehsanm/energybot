from dataclasses import dataclass
from typing import Any, Protocol
import httpx


@dataclass(slots=True)
class PaymentSession:
    redirect_url: str
    gateway_ref: str
    raw: dict


@dataclass(slots=True)
class PaymentResult:
    success: bool
    gateway_ref: str
    raw: dict


class PaymentProvider(Protocol):
    async def create_session(self, *, amount: int, bill_id: str, pay_id: str | None, return_url: str) -> PaymentSession: ...
    async def verify(self, *, gateway_ref: str, params: dict) -> PaymentResult: ...


class GenericRedirectProvider:
    """Redirect-style IPG: POST creates a session and returns an authority + URL;
    a verify call confirms settlement. Exact field names are gateway-specific and
    centralised here so only this file changes when the concrete PSP is pinned."""

    def __init__(self, *, gateway_base: str, merchant_id: str,
                 transport: httpx.AsyncBaseTransport | None = None):
        self._base = gateway_base.rstrip("/")
        self._merchant = merchant_id
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), transport=transport)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def create_session(self, *, amount: int, bill_id: str, pay_id: str | None, return_url: str) -> PaymentSession:
        r = await self._client.post(f"{self._base}/request", json={
            "merchant_id": self._merchant, "amount": amount,
            "description": f"قبض {bill_id}", "callback_url": return_url,
            "metadata": {"bill_id": bill_id, "pay_id": pay_id},
        })
        r.raise_for_status()
        data = r.json()
        ref = str(data.get("authority") or data.get("ref"))
        url = data.get("url") or f"{self._base}/{ref}"
        return PaymentSession(redirect_url=url, gateway_ref=ref, raw=data)

    async def verify(self, *, gateway_ref: str, params: dict) -> PaymentResult:
        r = await self._client.post(f"{self._base}/verify", json={
            "merchant_id": self._merchant, "authority": gateway_ref,
        })
        data = r.json() if r.status_code < 400 else {"status": r.status_code, "body": r.text}
        success = r.status_code < 400 and int(data.get("status", 0)) in (100, 101)
        return PaymentResult(success=success, gateway_ref=gateway_ref, raw=data)


class FakePaymentProvider:
    async def create_session(self, *, amount: int, bill_id: str, pay_id: str | None, return_url: str) -> PaymentSession:
        return PaymentSession(redirect_url=f"https://pay.fake/{bill_id}", gateway_ref=f"REF-{bill_id}", raw={})

    async def verify(self, *, gateway_ref: str, params: dict) -> PaymentResult:
        return PaymentResult(success=params.get("ok") == "1", gateway_ref=gateway_ref, raw=dict(params))
