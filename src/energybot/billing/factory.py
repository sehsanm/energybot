from collections.abc import Callable
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.settings import get_settings


def build_billing_service(session_factory: Callable[[], AsyncSession]):
    from energybot.billing.service import BillingService
    from energybot.billing.repository import BillingRepository
    from energybot.billing.finnotech_client import FinnotechClient
    from energybot.billing.payment import GenericRedirectProvider, FakePaymentProvider
    s = get_settings()
    fin = FinnotechClient(
        client_id=s.finnotech_client_id, client_secret=s.finnotech_client_secret,
        national_id=s.finnotech_national_id, scope=s.finnotech_scope,
        base_url=s.finnotech_base_url, token_path=s.finnotech_token_path,
        inquiry_path=s.finnotech_inquiry_path,
    )
    if s.payment_provider == "generic" and s.payment_gateway_base:
        payment = GenericRedirectProvider(gateway_base=s.payment_gateway_base, merchant_id=s.payment_merchant_id)
    else:
        payment = FakePaymentProvider()
    return BillingService(
        finnotech=fin, payment=payment,
        repo=BillingRepository(session_factory=session_factory),
        callback_base_url=s.payment_callback_base_url, provider_name=s.payment_provider,
    )
