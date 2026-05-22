import re

_ARABIC_TO_PERSIAN = str.maketrans({
    "ك": "ک",
    "ي": "ی",
    "ى": "ی",
    "ة": "ه",
    "أ": "ا",
    "إ": "ا",
    "آ": "آ",
    "ؤ": "و",
    "ئ": "ی",
})

_ARABIC_DIGITS = str.maketrans({
    "٠": "۰", "١": "۱", "٢": "۲", "٣": "۳", "٤": "۴",
    "٥": "۵", "٦": "۶", "٧": "۷", "٨": "۸", "٩": "۹",
})

ZWNJ = "‌"
_MULTI_ZWNJ = re.compile(ZWNJ + r"{2,}")
_WS = re.compile(r"\s+")
_ZWNJ_BOUNDARY = re.compile(r"\s+" + ZWNJ + r"|" + ZWNJ + r"\s+")


def normalize_fa(s: str) -> str:
    if not s:
        return ""
    s = s.translate(_ARABIC_TO_PERSIAN)
    s = s.translate(_ARABIC_DIGITS)
    s = _MULTI_ZWNJ.sub(ZWNJ, s)
    s = _ZWNJ_BOUNDARY.sub(ZWNJ, s)
    s = _WS.sub(" ", s)
    s = s.strip()
    return s.lower()
