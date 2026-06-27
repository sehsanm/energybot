from energybot.billing.suggestions import _parse_suggestions_json, render_suggestions


def test_parse_clean_json():
    out = _parse_suggestions_json('{"intro":"سلام","tips":["یک","دو"],"targets":[{"text":"هدف"}]}')
    assert out == {"intro": "سلام", "tips": ["یک", "دو"], "targets": [{"text": "هدف"}]}


def test_parse_code_fenced_with_prose():
    raw = "اینم خروجی:\n```json\n{\"intro\":\"x\",\"tips\":[\"a\"],\"targets\":[]}\n```\nموفق باشی"
    out = _parse_suggestions_json(raw)
    assert out == {"intro": "x", "tips": ["a"], "targets": []}


def test_parse_drops_nontext_tips_and_targets():
    out = _parse_suggestions_json('{"intro":"x","tips":["a","  "],"targets":[{"text":"ok"},{"no":1},"bad"]}')
    assert out == {"intro": "x", "tips": ["a"], "targets": [{"text": "ok"}]}


def test_parse_rejects_garbage():
    assert _parse_suggestions_json("not json at all") is None
    assert _parse_suggestions_json("") is None
    assert _parse_suggestions_json(None) is None


def test_parse_rejects_missing_required_keys():
    assert _parse_suggestions_json('{"intro":"x","tips":"notalist","targets":[]}') is None
    assert _parse_suggestions_json('{"tips":[],"targets":[]}') is None


def test_render_full():
    msg = render_suggestions({
        "intro": "مصرف بالاست",
        "tips": ["کولر را کم کن", "لامپ‌ها را عوض کن"],
        "targets": [{"text": "۱۰٪ کمتر در اوج"}, {"text": "خاموش‌کردن استندبای"}],
    })
    assert "💡 پیشنهادها برای این قبض" in msg
    assert "مصرف بالاست" in msg
    assert "• کولر را کم کن" in msg
    assert "🎯 هدف‌ها" in msg
    assert "- ۱۰٪ کمتر در اوج" in msg


def test_render_omits_empty_sections():
    msg = render_suggestions({"intro": "", "tips": [], "targets": []})
    assert msg.strip() == "💡 پیشنهادها برای این قبض"
