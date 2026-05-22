from typing import Any

_LABELS = {
    "city": "شهر",
    "home_type": "نوع مسکن",
    "occupants": "تعداد افراد خانوار",
    "area_m2": "متراژ",
    "heating_type": "سیستم گرمایش",
    "cooling_type": "سیستم سرمایش",
    "main_concern": "دغدغه اصلی",
}

_EN_TO_FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def _fa_digits(s: Any) -> str:
    return str(s).translate(_EN_TO_FA_DIGITS)


def render_profile_summary(household: dict, behaviour: dict, goals: list, commitments: list) -> str:
    parts: list[str] = []
    if household:
        rows = []
        for k, label in _LABELS.items():
            v = household.get(k)
            if v in (None, "", []):
                continue
            rows.append(f"- {label}: {_fa_digits(v)}")
        if rows:
            parts.append("**اطلاعات خانه:**\n" + "\n".join(rows))
    if behaviour:
        rows = [f"- {k}: {_fa_digits(v)}" for k, v in behaviour.items()]
        parts.append("**عادت‌های مصرف:**\n" + "\n".join(rows))
    if goals:
        rows = [f"- {g.get('text', '')} ({g.get('status', '')})" for g in goals]
        parts.append("**هدف‌ها:**\n" + "\n".join(rows))
    if commitments:
        rows = [f"- {c.get('text', '')}" + (" ✅" if c.get("fulfilled") else "") for c in commitments]
        parts.append("**تعهدها:**\n" + "\n".join(rows))
    if not parts:
        return "هنوز اطلاعاتی از این کاربر در دست نیست."
    return "\n\n".join(parts)
