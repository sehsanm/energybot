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


from energybot.billing.suggestions import _build_targets_as_goals


def test_build_targets_as_goals_maps_fields():
    goals = _build_targets_as_goals(
        [{"text": "کاهش اوج", "metric": "peak_kwh", "baseline": 120,
          "target_value": 108, "target_date": "1405/04/31"}],
        bill_id="bill-1",
    )
    assert len(goals) == 1
    g = goals[0]
    assert g["text"] == "کاهش اوج"
    assert g["status"] == "active"
    assert g["source"] == "bill_suggestion"
    assert g["bill_id"] == "bill-1"
    assert g["metric"] == "peak_kwh"
    assert g["baseline"] == 120
    assert g["target_value"] == 108
    assert g["target_date"] == "1405/04/31"
    assert isinstance(g["id"], str) and g["id"]


def test_build_targets_defaults_optionals_to_none():
    goals = _build_targets_as_goals([{"text": "فقط متن"}], bill_id="b")
    g = goals[0]
    assert g["metric"] is None and g["baseline"] is None
    assert g["target_value"] is None and g["target_date"] is None


def test_build_targets_unique_ids():
    goals = _build_targets_as_goals([{"text": "a"}, {"text": "b"}], bill_id="b")
    assert goals[0]["id"] != goals[1]["id"]


import importlib.util
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]


def test_prompt_seed_file_present():
    p = _ROOT / "scripts" / "seed_data" / "prompts" / "bill_suggestions.md"
    text = p.read_text(encoding="utf-8")
    assert "key: bill_suggestions" in text
    # Prompt must demand strict JSON with the three keys we parse.
    assert "intro" in text and "tips" in text and "targets" in text


def test_model_config_has_bill_suggestions():
    spec = importlib.util.spec_from_file_location("seed_dev", _ROOT / "scripts" / "seed_dev.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cfgs = {c["call_type"]: c for c in mod.DEFAULT_MODEL_CONFIGS}
    assert "bill_suggestions" in cfgs
    assert cfgs["bill_suggestions"]["params"].get("fallback")
