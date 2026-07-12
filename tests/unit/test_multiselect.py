from energybot.bale_adapter.multiselect import build_markup, parse_ms_callback

OPTS = [("a", "الف"), ("b", "ب")]


def test_build_markup_marks_selected_and_adds_done():
    m = build_markup("tb", OPTS, {"a"})
    rows = m["inline_keyboard"]
    assert rows[0][0]["text"].startswith("✅ ") and rows[0][0]["text"].endswith("الف")
    assert rows[0][0]["callback_data"] == "ms:tb:a"
    assert rows[1][0]["text"].startswith("▫️ ")
    control = rows[-1]
    assert control[0]["callback_data"] == "ms:tb:__done__"
    assert all("__skip__" not in b["callback_data"] for b in control)


def test_build_markup_optional_skip():
    m = build_markup("tb", OPTS, set(), allow_skip=True)
    control = m["inline_keyboard"][-1]
    assert control[-1]["callback_data"] == "ms:tb:__skip__"


def test_parse_ms_callback():
    assert parse_ms_callback("ms:tb:a") == ("tb", "a")
    assert parse_ms_callback("ms:motivations:__done__") == ("motivations", "__done__")
    assert parse_ms_callback("act:foo") is None
    assert parse_ms_callback("ms:tb:") is None
    assert parse_ms_callback("ms::x") is None
