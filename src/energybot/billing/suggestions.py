import json
from datetime import datetime
from uuid import UUID, uuid4

from energybot.providers.base import ChatRequest, ChatMessage
from energybot.logging import get_logger

log = get_logger(__name__)


def _parse_suggestions_json(text: str | None) -> dict | None:
    if not text:
        return None
    t = text.strip()
    start, end = t.find("{"), t.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        data = json.loads(t[start:end + 1])
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    intro, tips, targets = data.get("intro"), data.get("tips"), data.get("targets")
    if not isinstance(intro, str):
        return None
    if not isinstance(tips, list) or not all(isinstance(x, str) for x in tips):
        return None
    if not isinstance(targets, list):
        return None
    return {
        "intro": intro.strip(),
        "tips": [x.strip() for x in tips if x.strip()],
        "targets": [t for t in targets if isinstance(t, dict) and isinstance(t.get("text"), str)],
    }


def render_suggestions(payload: dict) -> str:
    intro = (payload.get("intro") or "").strip()
    tips = payload.get("tips") or []
    targets = payload.get("targets") or []
    lines = ["💡 پیشنهادها برای این قبض"]
    if intro:
        lines.append(intro)
    if tips:
        lines.append("")
        lines.extend(f"• {t}" for t in tips)
    if targets:
        lines.append("")
        lines.append("🎯 هدف‌ها")
        lines.extend(f"- {t.get('text', '')}" for t in targets)
    return "\n".join(lines)


def _build_targets_as_goals(targets: list[dict], bill_id: str) -> list[dict]:
    return [
        {
            "id": uuid4().hex,
            "text": t.get("text", ""),
            "status": "active",
            "source": "bill_suggestion",
            "bill_id": bill_id,
            "metric": t.get("metric"),
            "baseline": t.get("baseline"),
            "target_value": t.get("target_value"),
            "target_date": t.get("target_date"),
        }
        for t in targets
    ]


def _build_prompt_variables(bill, profile, prev) -> dict:
    details = bill.details or {}
    cons = details.get("consumption") or {}
    amounts = details.get("amounts") or {}

    def toman(rial):
        return int(rial) // 10 if rial is not None else None

    prev_block = None
    if prev is not None:
        pdet = prev.details or {}
        prev_block = {
            "amount_toman": toman((pdet.get("amounts") or {}).get("period") or prev.amount),
            "total_kwh": (pdet.get("consumption") or {}).get("total"),
            "term": prev.term,
        }
    return {
        "utility_kind": {"electricity": "برق", "gas": "گاز", "water": "آب"}.get(bill.utility_type, "قبض"),
        "amount_toman": toman(amounts.get("period") or bill.amount),
        "term": bill.term,
        "total_kwh": cons.get("total"),
        "peak_kwh": cons.get("peak"),
        "normal_kwh": cons.get("normal"),
        "low_kwh": cons.get("low"),
        "household": profile.household or {},
        "behaviour": profile.behaviour or {},
        "prev": prev_block,
    }


async def _generate(sf, *, user_id, chat_id, bill_db_id, router, prompt_loader, bale):
    from energybot.billing.repository import BillingRepository
    from energybot.profile.repository import ProfileRepository

    billing_repo = BillingRepository(session_factory=sf)
    bill = await billing_repo.get_bill_by_id(bill_db_id)
    if bill is None:
        return
    if bale is None:
        from energybot.bale_adapter.handler import get_bale_client
        bale = get_bale_client()
    if bill.suggestions is not None:
        await bale.send_message(chat_id=chat_id, text=render_suggestions(bill.suggestions))
        return

    profile_repo = ProfileRepository(session_factory=sf)
    profile = await profile_repo.get(user_id)
    prior = await billing_repo.prior_bills_for_subscription(
        bill.subscription_id, before_bill_id=bill.id, limit=1)
    prev = prior[0] if prior else None

    if router is None:
        from energybot.providers.factory import build_providers
        from energybot.providers.router import ProviderRouter
        from energybot.settings import get_settings
        router = ProviderRouter(providers=build_providers(get_settings()), session_factory=sf)
    if prompt_loader is None:
        from energybot.agent.prompts import PromptLoader
        prompt_loader = PromptLoader(session_factory=sf)

    try:
        body, key, version = await prompt_loader.render(
            "bill_suggestions", _build_prompt_variables(bill, profile, prev))
        req = ChatRequest(model="", messages=[ChatMessage(role="user", content=body)])
        resp = await router.chat(call_type="bill_suggestions", req=req,
                                 prompt_key=key, prompt_version=version)
    except Exception as e:  # noqa: BLE001 — provider/render failures are non-fatal
        log.warning("bill_suggestions_failed", error=str(e), bill_id=str(bill_db_id))
        return

    parsed = _parse_suggestions_json(resp.content)
    if parsed is None:
        log.warning("bill_suggestions_parse_failed", bill_id=str(bill_db_id))
        return

    payload = {
        "generated_at": datetime.utcnow().isoformat(),
        "intro": parsed["intro"],
        "tips": parsed["tips"],
        "targets": parsed["targets"],
        "model": resp.model,
        "prompt_version": version,
    }
    await billing_repo.set_bill_suggestions(bill.id, payload)
    for goal in _build_targets_as_goals(parsed["targets"], str(bill.id)):
        await profile_repo.append(user_id, "goals", goal,
                                  source="bill_suggestion", reason="هدف پیشنهادی از روی قبض")
    await bale.send_message(chat_id=chat_id, text=render_suggestions(payload))


async def generate_and_send_suggestions(
    *, user_id: UUID, chat_id: int, bill_db_id: UUID,
    session_factory=None, router=None, prompt_loader=None, bale=None,
) -> None:
    if session_factory is not None:
        await _generate(session_factory, user_id=user_id, chat_id=chat_id, bill_db_id=bill_db_id,
                        router=router, prompt_loader=prompt_loader, bale=bale)
        return
    from energybot.core.db import get_sessionmaker
    Session = get_sessionmaker()
    async with Session() as session:
        await _generate(lambda: session, user_id=user_id, chat_id=chat_id, bill_db_id=bill_db_id,
                        router=router, prompt_loader=prompt_loader, bale=bale)
