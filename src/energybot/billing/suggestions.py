import json
from datetime import datetime
from uuid import UUID, uuid4

from energybot.providers.base import ChatRequest, ChatMessage
from energybot.logging import get_logger

log = get_logger(__name__)


_JALALI_SEASONS = {
    1: "بهار", 2: "بهار", 3: "بهار",
    4: "تابستان", 5: "تابستان", 6: "تابستان",
    7: "پاییز", 8: "پاییز", 9: "پاییز",
    10: "زمستان", 11: "زمستان", 12: "زمستان",
}

_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _season_for_jalali_date(s: str | None) -> tuple[str | None, int | None]:
    if not s or not isinstance(s, str):
        return None, None
    parts = s.translate(_FA_DIGITS).split("/")
    if len(parts) < 2:
        return None, None
    try:
        month = int(parts[1])
    except ValueError:
        return None, None
    if month < 1 or month > 12:
        return None, None
    return _JALALI_SEASONS[month], month


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


def _fmt_saving(t: dict) -> str | None:
    from energybot.billing.service import _to_persian_digits
    kwh, toman, pct = t.get("saving_kwh"), t.get("saving_toman"), t.get("saving_pct")
    bits = []
    if isinstance(kwh, (int, float)):
        bits.append(f"{_to_persian_digits(format(kwh, ','))} کیلووات‌ساعت")
    if isinstance(toman, (int, float)):
        bits.append(f"{_to_persian_digits(format(int(toman), ','))} تومان")
    if isinstance(pct, (int, float)):
        bits.append(f"{_to_persian_digits(str(pct))}٪")
    return ("صرفه‌جویی حدود " + " / ".join(bits)) if bits else None


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
        for t in targets:
            lines.append(f"- {t.get('text', '')}")
            saving = _fmt_saving(t)
            if saving:
                lines.append(f"  {saving}")
            how = (t.get("how") or "").strip()
            if how:
                lines.append(f"  چطور: {how}")
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
            "saving_kwh": t.get("saving_kwh"),
            "saving_toman": t.get("saving_toman"),
            "saving_pct": t.get("saving_pct"),
            "how": t.get("how"),
            "target_date": t.get("target_date"),
        }
        for t in targets
    ]


def _to_number(v):
    """Coerce a value to a number for arithmetic.

    Bill fields arrive already numeric, but profile values are free-form
    strings — notably ``area_m2`` is stored as a bucket like ``"<60"`` or
    ``"100-150"`` (the wizard never numifies it). Map those to a representative
    number so density ratios stay meaningful instead of crashing on int/str.
    """
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v
    s = str(v).translate(_FA_DIGITS).replace(",", "").replace("٫", ".").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        pass
    body = s.lstrip("<>≤≥").rstrip("+").strip()  # "<60" / ">200" / "5+" -> their bound
    try:
        return float(body)
    except ValueError:
        pass
    if "-" in body:  # "100-150" -> midpoint
        lo, _, hi = body.partition("-")
        try:
            return (float(lo) + float(hi)) / 2
        except ValueError:
            return None
    return None


def _pct(part, total):
    part, total = _to_number(part), _to_number(total)
    if part is None or not total:
        return None
    return round(100 * part / total)


def _ratio(total, divisor, ndigits=1):
    total, divisor = _to_number(total), _to_number(divisor)
    if total is None or not divisor:
        return None
    return round(total / divisor, ndigits)


def _build_suggestion_context(bill, profile, prev) -> dict:
    details = bill.details or {}
    cons = details.get("consumption") or {}
    amounts = details.get("amounts") or {}
    reading = details.get("reading") or {}
    period = details.get("period") or {}
    household = profile.household or {}

    def toman(rial):
        return int(rial) // 10 if rial is not None else None

    total = cons.get("total")
    peak, normal, low, friday = cons.get("peak"), cons.get("normal"), cons.get("low"), cons.get("friday")
    days = period.get("days")
    season, jmonth = _season_for_jalali_date(reading.get("current_date"))
    amount_toman = toman(amounts.get("period") or bill.amount)

    prev_block = None
    if prev is not None:
        pdet = prev.details or {}
        ptotal = (pdet.get("consumption") or {}).get("total")
        pamount = toman((pdet.get("amounts") or {}).get("period") or prev.amount)
        prev_block = {
            "amount_toman": pamount, "total_kwh": ptotal, "term": prev.term,
            "delta_kwh": round(total - ptotal, 1) if (total is not None and ptotal is not None) else None,
            "delta_pct": _pct(total - ptotal, ptotal) if (total is not None and ptotal) else None,
            "delta_toman": (amount_toman - pamount) if (amount_toman is not None and pamount is not None) else None,
        }

    return {
        "utility_kind": {"electricity": "برق", "gas": "گاز", "water": "آب"}.get(bill.utility_type, "قبض"),
        "amount_toman": amount_toman,
        "energy_toman": toman(amounts.get("energy")),
        "tax_toman": toman(amounts.get("tax")),
        "subscription_toman": toman(amounts.get("subscription")),
        "term": bill.term,
        "season": season, "jalali_month": jmonth, "days": days,
        "kwh_per_day": _ratio(total, days),
        "total_kwh": total, "peak_kwh": peak, "normal_kwh": normal,
        "low_kwh": low, "friday_kwh": friday,
        "peak_pct": _pct(peak, total), "normal_pct": _pct(normal, total),
        "low_pct": _pct(low, total), "friday_pct": _pct(friday, total),
        "kwh_per_person": _ratio(total, household.get("occupants")),
        "kwh_per_m2": _ratio(total, household.get("area_m2")),
        "tariff": details.get("tariff"), "phase": details.get("phase"),
        "amper": details.get("amper"), "customer_type": details.get("customer_type"),
        "household": household,
        "behaviour": profile.behaviour or {},
        "prev": prev_block,
        "user_memory": None,
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
            "bill_suggestions", _build_suggestion_context(bill, profile, prev))
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
    claimed = await billing_repo.set_bill_suggestions_if_absent(bill.id, payload)
    if not claimed:
        return  # another task already generated for this bill; it will send.
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
