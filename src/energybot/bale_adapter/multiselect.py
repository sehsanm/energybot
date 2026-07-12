from collections.abc import Iterable


def build_markup(
    field: str,
    options: list[tuple[str, str]],
    selected: Iterable[str],
    *,
    allow_skip: bool = False,
    done_label: str = "تأیید ✅",
    skip_label: str = "فعلاً نه",
) -> dict:
    sel = set(selected)
    rows = []
    for key, label in options:
        mark = "✅ " if key in sel else "▫️ "
        rows.append([{"text": mark + label, "callback_data": f"ms:{field}:{key}"}])
    control = [{"text": done_label, "callback_data": f"ms:{field}:__done__"}]
    if allow_skip:
        control.append({"text": skip_label, "callback_data": f"ms:{field}:__skip__"})
    rows.append(control)
    return {"inline_keyboard": rows}


def parse_ms_callback(data: str) -> tuple[str, str] | None:
    if not data.startswith("ms:"):
        return None
    field, _, key = data[3:].partition(":")
    if not field or not key:
        return None
    return field, key
