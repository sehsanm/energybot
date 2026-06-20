from dataclasses import dataclass


@dataclass(slots=True)
class QuickAction:
    key: str
    label: str           # Persian button label
    kind: str            # "profile" | "bill" | "web" | "home" | "prompt"
    prompt: str | None = None  # required when kind == "prompt"

    def __post_init__(self):
        if self.kind == "prompt" and not self.prompt:
            raise ValueError(f"QuickAction {self.key!r}: kind='prompt' requires a non-empty prompt")


CATALOG: dict[str, QuickAction] = {
    "view_profile": QuickAction("view_profile", "پروفایل من", "profile"),
    "query_bill": QuickAction("query_bill", "استعلام قبض", "bill"),
    "web_login": QuickAction("web_login", "نسخهٔ وب", "web"),
    "saving_tips": QuickAction(
        "saving_tips", "راه‌های صرفه‌جویی", "prompt",
        "چند راه ساده و کاربردی برای کاهش مصرف انرژی در خانه بهم بگو.",
    ),
    "set_goal": QuickAction(
        "set_goal", "تعیین هدف", "prompt",
        "می‌خوام یک هدف صرفه‌جویی انرژی تعیین کنم. کمکم کن یک هدف مشخص و قابل‌اندازه‌گیری بذارم.",
    ),
    "more_help": QuickAction("more_help", "راهنما", "home"),
}

CATALOG_KEYS: list[str] = list(CATALOG.keys())

# Persistent reply-keyboard labels -> action kind. Labels are matched exactly.
REPLY_KB_ROUTES: dict[str, str] = {
    "قبض من": "bill",
    "پروفایل": "profile",
    "نسخه وب": "web",
    "راهنما": "home",
}


def build_suggestions_markup(keys: list[str]) -> dict | None:
    rows = [
        [{"text": CATALOG[k].label, "callback_data": f"act:{k}"}]
        for k in keys
        if k in CATALOG
    ]
    if not rows:
        return None
    return {"inline_keyboard": rows}
