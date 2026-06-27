import json
from uuid import uuid4

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
