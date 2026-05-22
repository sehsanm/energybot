from energybot.core.normalize_fa import normalize_fa


def test_arabic_kaf_to_persian_kaf():
    assert normalize_fa("كتاب") == "کتاب"


def test_arabic_yeh_to_persian_yeh():
    assert normalize_fa("يك") == "یک"


def test_arabic_digits_to_persian_digits():
    assert normalize_fa("١٢٣٤٥٦٧٨٩٠") == "۱۲۳۴۵۶۷۸۹۰"


def test_zwnj_collapse_and_whitespace():
    assert normalize_fa("می‌‌روم  به\tخانه") == "می‌روم به خانه"


def test_mixed_case_lower():
    assert normalize_fa("Hello سلام") == "hello سلام"


def test_idempotent():
    s = "كتاب يك ١٢٣"
    assert normalize_fa(normalize_fa(s)) == normalize_fa(s)


def test_empty_and_none_safe():
    assert normalize_fa("") == ""
    assert normalize_fa("   ") == ""
