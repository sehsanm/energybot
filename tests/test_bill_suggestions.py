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


from energybot.billing.suggestions import _season_for_jalali_date


def test_season_for_jalali_date_quarters():
    assert _season_for_jalali_date("1405/02/15") == ("بهار", 2)
    assert _season_for_jalali_date("1405/05/01") == ("تابستان", 5)
    assert _season_for_jalali_date("1405/08/30") == ("پاییز", 8)
    assert _season_for_jalali_date("1405/11/10") == ("زمستان", 11)


def test_season_for_jalali_date_persian_digits():
    assert _season_for_jalali_date("۱۴۰۵/۰۴/۲۰") == ("تابستان", 4)


def test_season_for_jalali_date_bad_input():
    assert _season_for_jalali_date(None) == (None, None)
    assert _season_for_jalali_date("") == (None, None)
    assert _season_for_jalali_date("1405") == (None, None)
    assert _season_for_jalali_date("1405/13/01") == (None, None)
    assert _season_for_jalali_date("1405/xx/01") == (None, None)


from types import SimpleNamespace
from energybot.billing.suggestions import _build_suggestion_context


def _fake_bill(**details):
    return SimpleNamespace(utility_type="electricity", amount=2_000_000, term="1405/3", details=details)


def _fake_profile(household=None, behaviour=None):
    return SimpleNamespace(household=household or {}, behaviour=behaviour or {})


def test_context_derives_season_shares_density_costsplit():
    bill = _fake_bill(
        consumption={"total": 400, "peak": 200, "normal": 120, "low": 80},
        amounts={"period": 2_000_000, "energy": 1_500_000, "tax": 180_000, "subscription": 90_000},
        period={"days": 60}, reading={"current_date": "1405/05/20"},
        tariff="خانگی", phase=1, amper=25, customer_type="مسکونی")
    prof = _fake_profile(household={"occupants": 4, "area_m2": 100, "city": "تهران"},
                         behaviour={"peak_usage_hours": "شب‌ها"})
    ctx = _build_suggestion_context(bill, prof, None)
    assert ctx["season"] == "تابستان" and ctx["jalali_month"] == 5
    assert ctx["days"] == 60 and ctx["kwh_per_day"] == round(400 / 60, 1)
    assert ctx["peak_pct"] == 50 and ctx["normal_pct"] == 30 and ctx["low_pct"] == 20
    assert ctx["kwh_per_person"] == 100.0 and ctx["kwh_per_m2"] == 4.0
    assert ctx["amount_toman"] == 200_000 and ctx["energy_toman"] == 150_000
    assert ctx["tax_toman"] == 18_000 and ctx["subscription_toman"] == 9_000
    assert ctx["tariff"] == "خانگی" and ctx["phase"] == 1
    assert ctx["behaviour"]["peak_usage_hours"] == "شب‌ها"
    assert ctx["household"]["city"] == "تهران"
    assert ctx["prev"] is None and ctx["user_memory"] is None


def test_context_handles_missing_details_without_error():
    bill = _fake_bill()  # no consumption/amounts/reading/period
    ctx = _build_suggestion_context(bill, _fake_profile(), None)
    assert ctx["season"] is None and ctx["days"] is None
    assert ctx["total_kwh"] is None and ctx["peak_pct"] is None
    assert ctx["kwh_per_person"] is None and ctx["kwh_per_m2"] is None
    assert ctx["amount_toman"] == 200_000  # falls back to bill.amount//10


def test_context_prev_delta():
    bill = _fake_bill(consumption={"total": 400}, amounts={"period": 2_000_000})
    prev = _fake_bill(consumption={"total": 300}, amounts={"period": 1_000_000})
    prev.term = "1405/2"
    ctx = _build_suggestion_context(bill, _fake_profile(), prev)
    assert ctx["prev"]["total_kwh"] == 300 and ctx["prev"]["amount_toman"] == 100_000
    assert ctx["prev"]["delta_kwh"] == 100
    assert ctx["prev"]["delta_pct"] == 33  # round(100*100/300)
    assert ctx["prev"]["delta_toman"] == 100_000  # 200000 - 100000
