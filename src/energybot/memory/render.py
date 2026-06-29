# Category -> Persian heading. Order here defines render order.
_HEADINGS = [
    ("preference", "ترجیحات"),
    ("life_context", "شرایط زندگی"),
    ("constraint", "محدودیت‌ها"),
    ("interaction_style", "سبک تعامل"),
    ("misc", "سایر"),
]
_LABEL = dict(_HEADINGS)


def render_memory(items: list) -> str:
    if not items:
        return ""
    by_cat: dict[str, list] = {}
    for it in items:
        cat = it.category if it.category in _LABEL else "misc"
        by_cat.setdefault(cat, []).append(it)
    parts: list[str] = ["آنچه درباره‌ی کاربر می‌دانم:"]
    for cat, heading in _HEADINGS:
        rows = by_cat.get(cat)
        if not rows:
            continue
        lines = [f"- [{it.id}] {it.text}" for it in rows]
        parts.append(f"{heading}:\n" + "\n".join(lines))
    return "\n\n".join(parts)
