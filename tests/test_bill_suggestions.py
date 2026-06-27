from energybot.billing.suggestions import _parse_suggestions_json


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
