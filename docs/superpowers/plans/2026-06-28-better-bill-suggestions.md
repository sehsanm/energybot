# Better Bill Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-bill LLM suggestions specific and quantified by feeding code-computed derived features (season, shares, density, deltas, cost split), rewriting the prompt to demand quantified mechanism-linked targets, and pointing the call at a stronger model.

**Architecture:** A pure context-builder (`_build_suggestion_context`) replaces the thin `_build_prompt_variables`, computing clean numbers from `bill.details` + profile + previous bill. The seeded prompt is rewritten (new version) to present all of it and require enriched targets. `render_suggestions` and `_build_targets_as_goals` carry the new target fields; the `bill_suggestions` model_config moves to `deepseek-reasoner`. No DB schema/migration change.

**Tech Stack:** Python 3.10/3.12, SQLAlchemy async, Jinja2 (StrictUndefined) prompts in DB, pytest/pytest-asyncio, Postgres.

## Global Constraints

- All user-facing copy is **Persian (fa)**. Persian-digit/toman formatting reuses helpers in `src/energybot/billing/service.py`: `_to_persian_digits(s)` (translates `0-9` and `,`→`٬`), `_fmt_amount`, `_fmt_kwh`.
- The new module code lives in `src/energybot/billing/suggestions.py` (already exists; APPEND/replace named functions, keep the rest).
- Jinja prompts render under **StrictUndefined**: every top-level variable must always be present in the context dict; dict fields accessed via `.get('x', default)`; optional blocks (`prev`, `user_memory`) guarded by `{% if %}`.
- LLM call goes through `ProviderRouter.chat(call_type="bill_suggestions", req=ChatRequest(model="", messages=[...]), prompt_key=..., prompt_version=...)`. The router sets `req.model` from the `model_configs` row; it does NOT apply `params.temperature` to chat requests (params only carries the fallback), so the only effective model change is `model_name`.
- `_parse_suggestions_json` already keeps the full target dict (requires only `text: str`), so enriched target keys pass through with **no parser change**.
- Error/idempotency semantics are unchanged and must stay intact: LLM/parse failure → log + leave `suggestions` NULL + send nothing; atomic `set_bill_suggestions_if_absent` claim gates persist + goal-append + send.
- Run unit tests: `pytest tests/test_bill_suggestions.py -v`
- Run integration tests: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/integration/test_bill_suggestions.py -v` (test Postgres up via `docker compose -f docker-compose.test.yml up -d`; migrations already applied).

---

### Task 1: Season helper `_season_for_jalali_date`

**Files:**
- Modify: `src/energybot/billing/suggestions.py`
- Test: `tests/test_bill_suggestions.py`

**Interfaces:**
- Produces: `_season_for_jalali_date(s: str | None) -> tuple[str | None, int | None]` — parses a Jalali `"YYYY/MM/DD"` (ASCII or Persian digits) and returns `(season_fa, month_int)`; `(None, None)` if missing/unparseable/out-of-range. Seasons: 1–3 بهار, 4–6 تابستان, 7–9 پاییز, 10–12 زمستان.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_bill_suggestions.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bill_suggestions.py -v -k season`
Expected: FAIL — `ImportError: cannot import name '_season_for_jalali_date'`

- [ ] **Step 3: Write the implementation**

In `src/energybot/billing/suggestions.py`, add after the imports (above `_parse_suggestions_json`):

```python
_JALALI_SEASONS = {
    1: "بهار", 2: "بهار", 3: "بهار",
    4: "تابستان", 5: "تابستان", 6: "تابستان",
    7: "پاییز", 8: "پاییز", 9: "پاییز",
    10: "زمستان", 11: "زمستان", 12: "زمستان",
}

_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


def _season_for_jalali_date(s: str | None) -> tuple[str | None, int | None]:
    if not s or not isinstance(s, str):
        return None, None
    parts = s.translate(_FA_DIGITS).split("/")
    if len(parts) < 2:
        return None, None
    try:
        month = int(parts[1])
    except ValueError:
        return None, None
    if month < 1 or month > 12:
        return None, None
    return _JALALI_SEASONS[month], month
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_bill_suggestions.py -v -k season`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/suggestions.py tests/test_bill_suggestions.py
git commit -m "feat(billing): jalali season helper for suggestions"
```

---

### Task 2: Context builder `_build_suggestion_context` (replaces `_build_prompt_variables`)

**Files:**
- Modify: `src/energybot/billing/suggestions.py` (replace `_build_prompt_variables`, update the call in `_generate`)
- Test: `tests/test_bill_suggestions.py`

**Interfaces:**
- Consumes: `_season_for_jalali_date` (Task 1).
- Produces: `_build_suggestion_context(bill, profile, prev) -> dict` — Jinja vars for the prompt. Always includes (never raises on missing detail): `utility_kind, amount_toman, energy_toman, tax_toman, subscription_toman, term, season, jalali_month, days, kwh_per_day, total_kwh, peak_kwh, normal_kwh, low_kwh, friday_kwh, peak_pct, normal_pct, low_pct, friday_pct, kwh_per_person, kwh_per_m2, tariff, phase, amper, customer_type, household, behaviour, prev, user_memory`. `prev` (when a prior bill exists) is `{amount_toman, total_kwh, term, delta_kwh, delta_pct, delta_toman}` else `None`. `user_memory` is `None`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_bill_suggestions.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bill_suggestions.py -v -k context`
Expected: FAIL — `ImportError: cannot import name '_build_suggestion_context'`

- [ ] **Step 3: Write the implementation**

In `src/energybot/billing/suggestions.py`, **replace** the entire `_build_prompt_variables` function with:

```python
def _pct(part, total):
    if part is None or not total:
        return None
    return round(100 * part / total)


def _ratio(total, divisor, ndigits=1):
    if total is None or not divisor:
        return None
    return round(total / divisor, ndigits)


def _build_suggestion_context(bill, profile, prev) -> dict:
    details = bill.details or {}
    cons = details.get("consumption") or {}
    amounts = details.get("amounts") or {}
    reading = details.get("reading") or {}
    period = details.get("period") or {}
    household = profile.household or {}

    def toman(rial):
        return int(rial) // 10 if rial is not None else None

    total = cons.get("total")
    peak, normal, low, friday = cons.get("peak"), cons.get("normal"), cons.get("low"), cons.get("friday")
    days = period.get("days")
    season, jmonth = _season_for_jalali_date(reading.get("current_date"))
    amount_toman = toman(amounts.get("period") or bill.amount)

    prev_block = None
    if prev is not None:
        pdet = prev.details or {}
        ptotal = (pdet.get("consumption") or {}).get("total")
        pamount = toman((pdet.get("amounts") or {}).get("period") or prev.amount)
        prev_block = {
            "amount_toman": pamount, "total_kwh": ptotal, "term": prev.term,
            "delta_kwh": round(total - ptotal, 1) if (total is not None and ptotal is not None) else None,
            "delta_pct": _pct(total - ptotal, ptotal) if (total is not None and ptotal) else None,
            "delta_toman": (amount_toman - pamount) if (amount_toman is not None and pamount is not None) else None,
        }

    return {
        "utility_kind": {"electricity": "برق", "gas": "گاز", "water": "آب"}.get(bill.utility_type, "قبض"),
        "amount_toman": amount_toman,
        "energy_toman": toman(amounts.get("energy")),
        "tax_toman": toman(amounts.get("tax")),
        "subscription_toman": toman(amounts.get("subscription")),
        "term": bill.term,
        "season": season, "jalali_month": jmonth, "days": days,
        "kwh_per_day": _ratio(total, days),
        "total_kwh": total, "peak_kwh": peak, "normal_kwh": normal,
        "low_kwh": low, "friday_kwh": friday,
        "peak_pct": _pct(peak, total), "normal_pct": _pct(normal, total),
        "low_pct": _pct(low, total), "friday_pct": _pct(friday, total),
        "kwh_per_person": _ratio(total, household.get("occupants")),
        "kwh_per_m2": _ratio(total, household.get("area_m2")),
        "tariff": details.get("tariff"), "phase": details.get("phase"),
        "amper": details.get("amper"), "customer_type": details.get("customer_type"),
        "household": household,
        "behaviour": profile.behaviour or {},
        "prev": prev_block,
        "user_memory": None,
    }
```

- [ ] **Step 4: Update the call site in `_generate`**

In `_generate`, change the render line from:

```python
        body, key, version = await prompt_loader.render(
            "bill_suggestions", _build_prompt_variables(bill, profile, prev))
```

to:

```python
        body, key, version = await prompt_loader.render(
            "bill_suggestions", _build_suggestion_context(bill, profile, prev))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_bill_suggestions.py -v -k context`
Expected: PASS (3 passed)

Then the full unit file (no regressions):
Run: `pytest tests/test_bill_suggestions.py -v`
Expected: PASS (all)

- [ ] **Step 6: Commit**

```bash
git add src/energybot/billing/suggestions.py tests/test_bill_suggestions.py
git commit -m "feat(billing): rich suggestion context builder"
```

---

### Task 3: `render_suggestions` shows savings + how

**Files:**
- Modify: `src/energybot/billing/suggestions.py`
- Test: `tests/test_bill_suggestions.py`

**Interfaces:**
- Produces: `_fmt_saving(t: dict) -> str | None` (Persian saving line from a target's `saving_kwh`/`saving_toman`/`saving_pct`, or `None` if all absent); `render_suggestions` now appends, under each target's text, a `صرفه‌جویی حدود …` line (when present) and a `چطور: …` line (when `how` present).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_bill_suggestions.py`:

```python
def test_render_target_with_savings_and_how():
    msg = render_suggestions({
        "intro": "", "tips": [],
        "targets": [{"text": "۱۰٪ کمتر در اوج", "saving_kwh": 12, "saving_toman": 36000,
                     "saving_pct": 10, "how": "انتقال بار اوج به کم‌باری"}],
    })
    assert "- ۱۰٪ کمتر در اوج" in msg
    assert "صرفه‌جویی حدود" in msg
    assert "کیلووات‌ساعت" in msg and "تومان" in msg
    assert "چطور: انتقال بار اوج به کم‌باری" in msg


def test_render_target_without_savings_omits_lines():
    msg = render_suggestions({"intro": "", "tips": [], "targets": [{"text": "هدف ساده"}]})
    assert "- هدف ساده" in msg
    assert "صرفه‌جویی" not in msg
    assert "چطور:" not in msg
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bill_suggestions.py -v -k "savings_and_how or without_savings"`
Expected: FAIL — `assert 'صرفه‌جویی حدود' in msg` (render doesn't emit savings yet)

- [ ] **Step 3: Write the implementation**

In `src/energybot/billing/suggestions.py`, add `_fmt_saving` above `render_suggestions`:

```python
def _fmt_saving(t: dict) -> str | None:
    from energybot.billing.service import _to_persian_digits
    kwh, toman, pct = t.get("saving_kwh"), t.get("saving_toman"), t.get("saving_pct")
    if kwh is None and toman is None and pct is None:
        return None
    bits = []
    if kwh is not None:
        bits.append(f"{_to_persian_digits(format(kwh, ','))} کیلووات‌ساعت")
    if toman is not None:
        bits.append(f"{_to_persian_digits(format(int(toman), ','))} تومان")
    if pct is not None:
        bits.append(f"{_to_persian_digits(str(pct))}٪")
    return "صرفه‌جویی حدود " + " / ".join(bits)
```

Then **replace** the `if targets:` block in `render_suggestions` with:

```python
    if targets:
        lines.append("")
        lines.append("🎯 هدف‌ها")
        for t in targets:
            lines.append(f"- {t.get('text', '')}")
            saving = _fmt_saving(t)
            if saving:
                lines.append(f"  {saving}")
            how = (t.get("how") or "").strip()
            if how:
                lines.append(f"  چطور: {how}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_bill_suggestions.py -v -k "render"`
Expected: PASS (existing render tests + 2 new = 4 passed)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/suggestions.py tests/test_bill_suggestions.py
git commit -m "feat(billing): render target savings + how"
```

---

### Task 4: `_build_targets_as_goals` carries the new fields

**Files:**
- Modify: `src/energybot/billing/suggestions.py`
- Test: `tests/test_bill_suggestions.py`

**Interfaces:**
- Produces: goal items now also include `saving_kwh, saving_toman, saving_pct, how` (each defaulting to `None`), alongside the existing `id, text, status, source, bill_id, metric, baseline, target_value, target_date`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_bill_suggestions.py`:

```python
def test_build_targets_carries_savings_and_how():
    goals = _build_targets_as_goals(
        [{"text": "t", "saving_kwh": 12, "saving_toman": 36000, "saving_pct": 10, "how": "روش"}],
        bill_id="b")
    g = goals[0]
    assert g["saving_kwh"] == 12 and g["saving_toman"] == 36000
    assert g["saving_pct"] == 10 and g["how"] == "روش"


def test_build_targets_savings_default_none():
    g = _build_targets_as_goals([{"text": "t"}], bill_id="b")[0]
    assert g["saving_kwh"] is None and g["saving_toman"] is None
    assert g["saving_pct"] is None and g["how"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bill_suggestions.py -v -k "carries_savings or savings_default"`
Expected: FAIL — `KeyError: 'saving_kwh'`

- [ ] **Step 3: Write the implementation**

In `src/energybot/billing/suggestions.py`, in `_build_targets_as_goals`, add the four keys to the dict (after `target_value`):

```python
            "target_value": t.get("target_value"),
            "saving_kwh": t.get("saving_kwh"),
            "saving_toman": t.get("saving_toman"),
            "saving_pct": t.get("saving_pct"),
            "how": t.get("how"),
            "target_date": t.get("target_date"),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_bill_suggestions.py -v -k "targets"`
Expected: PASS (existing targets tests + 2 new)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/suggestions.py tests/test_bill_suggestions.py
git commit -m "feat(billing): carry target savings into profile goals"
```

---

### Task 5: New prompt version + `deepseek-reasoner` model config

**Files:**
- Modify: `scripts/seed_data/prompts/bill_suggestions.md` (rewrite body)
- Modify: `scripts/seed_dev.py` (`DEFAULT_MODEL_CONFIGS` `bill_suggestions` entry)
- Test: `tests/test_bill_suggestions.py`

**Interfaces:**
- Produces: an updated prompt body that references the new context fields and the enriched target schema; the `bill_suggestions` model_config points at `deepseek` / `deepseek-reasoner` (fallback `metis`/`gpt-4o-mini`).

- [ ] **Step 1: Write the failing test**

In `tests/test_bill_suggestions.py`, find `test_prompt_seed_file_present` and `test_model_config_has_bill_suggestions` and **replace** them with:

```python
def test_prompt_seed_file_present():
    p = _ROOT / "scripts" / "seed_data" / "prompts" / "bill_suggestions.md"
    text = p.read_text(encoding="utf-8")
    assert "key: bill_suggestions" in text
    assert "intro" in text and "tips" in text and "targets" in text
    # new enriched context + target fields the rewrite must reference
    for token in ("season", "peak_pct", "kwh_per_person", "saving_kwh",
                  "saving_toman", "saving_pct", "how", "behaviour"):
        assert token in text, f"prompt missing {token!r}"


def test_model_config_bill_suggestions_uses_reasoner():
    spec = importlib.util.spec_from_file_location("seed_dev", _ROOT / "scripts" / "seed_dev.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cfgs = {c["call_type"]: c for c in mod.DEFAULT_MODEL_CONFIGS}
    cfg = cfgs["bill_suggestions"]
    assert cfg["provider"] == "deepseek"
    assert cfg["model_name"] == "deepseek-reasoner"
    assert cfg["params"]["fallback"]["provider"] == "metis"
```

(If the old `test_model_config_has_bill_suggestions` name is referenced nowhere else, removing it is fine — the new test supersedes it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bill_suggestions.py -v -k "seed_file or reasoner"`
Expected: FAIL — prompt missing `season`/etc., and `model_name` is `deepseek-v4-flash`.

- [ ] **Step 3: Rewrite the prompt body**

Replace the body of `scripts/seed_data/prompts/bill_suggestions.md` (keep frontmatter `key`/`name`, update `notes`) with:

```markdown
---
key: bill_suggestions
name: تولید پیشنهاد و هدف کمی از روی قبض
notes: ورودی‌ها شامل اطلاعات تفصیلی قبض (مصرف اوج/عادی/کم‌باری، سهم هر بخش، فصل، تعرفه)، پروفایل خانوار و رفتار، و قبض دوره قبل است. خروجی فقط JSON معتبر با هدف‌های کمّی.
---
تو یک مشاور صرفه‌جویی انرژی فارسی‌زبان، دقیق و عددمحور هستی. فقط بر اساس داده‌های همین قبض و همین خانوار، پیشنهاد بده. از کلی‌گویی پرهیز کن؛ هر مشاهده را به یک عددِ همین قبض گره بزن.

اطلاعات این قبض ({{ utility_kind }}):
- دوره: {{ term }}{% if season %}، فصل: {{ season }}{% endif %}{% if days %}، {{ days }} روز{% endif %}
- مبلغ این دوره: {{ amount_toman }} تومان{% if energy_toman %} (انرژی: {{ energy_toman }}، مالیات/عوارض: {{ tax_toman }}، آبونمان: {{ subscription_toman }}){% endif %}
- مصرف کل: {{ total_kwh }} کیلووات‌ساعت{% if kwh_per_day %}، {{ kwh_per_day }} در روز{% endif %}
- اوج: {{ peak_kwh }}{% if peak_pct is not none %} ({{ peak_pct }}٪){% endif %} | عادی: {{ normal_kwh }}{% if normal_pct is not none %} ({{ normal_pct }}٪){% endif %} | کم‌باری: {{ low_kwh }}{% if low_pct is not none %} ({{ low_pct }}٪){% endif %}
{% if kwh_per_person %}- مصرف به ازای هر نفر: {{ kwh_per_person }} کیلووات‌ساعت{% endif %}
{% if kwh_per_m2 %}- مصرف به ازای هر مترمربع: {{ kwh_per_m2 }} کیلووات‌ساعت{% endif %}
{% if tariff %}- تعرفه: {{ tariff }}{% if phase %}، فاز: {{ phase }}{% endif %}{% if amper %}، آمپر: {{ amper }}{% endif %}{% endif %}

پروفایل خانوار:
- شهر: {{ household.get('city', 'نامشخص') }} | نوع منزل: {{ household.get('home_type', 'نامشخص') }} | ساکنان: {{ household.get('occupants', 'نامشخص') }} | متراژ: {{ household.get('area_m2', 'نامشخص') }}
- گرمایش: {{ household.get('heating_type', 'نامشخص') }} | سرمایش: {{ household.get('cooling_type', 'نامشخص') }} | دغدغه: {{ household.get('main_concern', 'نامشخص') }}
{% if behaviour %}- رفتار مصرف: {{ behaviour }}{% endif %}

{% if prev %}قبض دوره قبل: مصرف {{ prev.get('total_kwh') }} کیلووات‌ساعت، مبلغ {{ prev.get('amount_toman') }} تومان{% if prev.get('delta_kwh') is not none %} — تغییر مصرف: {{ prev.get('delta_kwh') }} کیلووات‌ساعت ({{ prev.get('delta_pct') }}٪){% endif %}.{% else %}قبض دوره قبلی ثبت نشده است.{% endif %}
{% if user_memory %}آنچه از گفتگوهای قبلی درباره کاربر می‌دانیم: {{ user_memory }}{% endif %}

قواعد خروجی:
- فقط یک شیء JSON معتبر بده. هیچ متنی بیرون از JSON ننویس.
- همه متن‌ها فارسی، کوتاه و عملی. هر پیشنهاد به الگوی همین قبض گره بخورد (مثلاً «اوج {{ peak_pct }}٪ از مصرف توست که برای {{ season }} بالاست»).
- `intro`: یک تا دو جمله؛ اگر قبض قبلی هست به تغییر مصرف اشاره کن.
- `tips`: ۳ تا ۵ اقدام مشخص و عملی.
- `targets`: ۱ تا ۳ هدف کاملاً کمّی. هر هدف باید مقدار پایه و مقدار هدف و میزان صرفه‌جویی را با عدد بیاورد و «چطور» محقق می‌شود را بگوید.
- برای هر هدف:
  - `text`: شرح کوتاه فارسی و کمّی.
  - `metric`: یکی از "peak_kwh" | "total_kwh" | "amount_toman".
  - `baseline`: مقدار فعلی همین معیار از روی این قبض (عدد).
  - `target_value`: مقدار هدف (عدد).
  - `saving_kwh`: تخمین صرفه‌جویی به کیلووات‌ساعت (عدد یا null).
  - `saving_toman`: تخمین صرفه‌جویی به تومان (عدد یا null).
  - `saving_pct`: درصد صرفه‌جویی (عدد یا null).
  - `how`: مکانیزم تحقق هدف؛ به کدام پیشنهادها وصل است.
  - `target_date`: تاریخ شمسی مثل "1405/05/31" یا null.
- همه صرفه‌جویی‌ها تخمینی‌اند؛ غیرواقعی بزرگ‌نمایی نکن.

ساختار خروجی:
{"intro": "...", "tips": ["...", "..."], "targets": [{"text": "...", "metric": "peak_kwh", "baseline": 0, "target_value": 0, "saving_kwh": 0, "saving_toman": 0, "saving_pct": 0, "how": "...", "target_date": "1405/05/31"}]}
```

- [ ] **Step 4: Update the model config**

In `scripts/seed_dev.py`, in `DEFAULT_MODEL_CONFIGS`, change the `bill_suggestions` entry's `model_name`:

```python
    {
        "call_type": "bill_suggestions",
        "provider": "deepseek",
        "model_name": "deepseek-reasoner",
        "params": {"temperature": 0.4, "fallback": {"provider": "metis", "model_name": "gpt-4o-mini"}},
        "is_active": True,
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_bill_suggestions.py -v -k "seed_file or reasoner"`
Expected: PASS (2 passed)

Then verify the StrictUndefined prompt renders with a real context (catches Jinja typos):

```bash
python - <<'PY'
from jinja2 import Environment, StrictUndefined
from types import SimpleNamespace
from energybot.billing.suggestions import _build_suggestion_context
body = open("scripts/seed_data/prompts/bill_suggestions.md", encoding="utf-8").read().split("---",2)[2]
bill = SimpleNamespace(utility_type="electricity", amount=2_000_000, term="1405/3",
    details={"consumption":{"total":400,"peak":200,"normal":120,"low":80},
             "amounts":{"period":2_000_000,"energy":1_500_000,"tax":180_000,"subscription":90_000},
             "period":{"days":60},"reading":{"current_date":"1405/05/20"},
             "tariff":"خانگی","phase":1,"amper":25,"customer_type":"مسکونی"})
prof = SimpleNamespace(household={"occupants":4,"area_m2":100,"city":"تهران"}, behaviour={"peak_usage_hours":"شب"})
for prev in (None, bill):
    ctx = _build_suggestion_context(bill, prof, prev)
    Environment(undefined=StrictUndefined, autoescape=False).from_string(body).render(**ctx)
print("prompt renders OK for prev=None and prev=set")
PY
```
Expected: `prompt renders OK for prev=None and prev=set` (no `UndefinedError`).

- [ ] **Step 6: Commit**

```bash
git add scripts/seed_data/prompts/bill_suggestions.md scripts/seed_dev.py tests/test_bill_suggestions.py
git commit -m "feat(billing): quantified suggestions prompt + deepseek-reasoner"
```

---

### Task 6: End-to-end integration with enriched targets

**Files:**
- Modify: `tests/integration/test_bill_suggestions.py` (update `_GOOD`, extend the generate test)

**Interfaces:**
- Consumes: `generate_and_send_suggestions` (unchanged signature), the enriched `render_suggestions`/`_build_targets_as_goals`/`_build_suggestion_context`.

- [ ] **Step 1: Update the canned payload and add assertions**

In `tests/integration/test_bill_suggestions.py`, **replace** the `_GOOD` definition with an enriched target:

```python
_GOOD = _json.dumps({
    "intro": "مصرفت بالاست", "tips": ["کولر را کم کن"],
    "targets": [{"text": "۱۰٪ کمتر در اوج", "metric": "peak_kwh", "baseline": 120,
                 "target_value": 108, "saving_kwh": 12, "saving_toman": 36000,
                 "saving_pct": 10, "how": "انتقال بار اوج به کم‌باری"}],
}, ensure_ascii=False)
```

Then, inside `test_generate_persists_appends_goal_and_sends`, after the existing assertions, append:

```python
    # enriched target fields persist to the bill and the goal, and render in the message
    assert row.suggestions["targets"][0]["saving_kwh"] == 12
    goal = next(g for g in prof.goals if g["source"] == "bill_suggestion")
    assert goal["saving_kwh"] == 12 and goal["how"] == "انتقال بار اوج به کم‌باری"
    assert "صرفه‌جویی حدود" in bale.sent[0]
    assert "چطور: انتقال بار اوج به کم‌باری" in bale.sent[0]
```

(The existing assertions in that test — `row.suggestions["intro"]`, the `prof` goal lookup, `bale.sent` — already establish `row`, `prof`, and `bale`; reuse those variable names. If the test currently fetches `prof` inline in an assert, hoist it to a local `prof = await ProfileRepository(session_factory=lambda: db_session).get(u.id)` before these lines.)

- [ ] **Step 2: Run the integration generate tests**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/integration/test_bill_suggestions.py -v -k generate`
Expected: PASS (3 passed) — persists enriched targets, idempotency + parse-failure unchanged.

- [ ] **Step 3: Run the full suggestions suites (regression)**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/test_bill_suggestions.py tests/integration/test_bill_suggestions.py -v`
Expected: PASS (all).

- [ ] **Step 4: Commit**

```bash
git add tests/integration/test_bill_suggestions.py
git commit -m "test(billing): end-to-end enriched suggestion targets"
```

---

## Rollout (after merge + deploy)

The deploy applies no new migration. Re-seed prod prompts + models (scripts-mount workaround, with reset flags to bump the prompt version and overwrite the model row):

```bash
ssh arvandev "cd /srv/energybot && DOCKERFILE=Dockerfile.prod docker compose run --rm \
  -v /srv/energybot/scripts:/app/scripts app \
  python scripts/seed_dev.py --skip kb --reset-prompts --reset-models"
```

Expected output includes `prompt 'bill_suggestions': retired vN, inserted v(N+1)` and `model_config 'bill_suggestions': ... deepseek/deepseek-reasoner`.

## Self-Review

**Spec coverage:**
- Derived features computed in code → Task 2 (`_build_suggestion_context`) + Task 1 (season). ✓
- Season from reading dates, days, shares, density, cost split, deltas, behaviour, guarded `user_memory` → Task 2. ✓
- Prompt rewrite presenting all fields + demanding quantified mechanism-linked targets → Task 5. ✓
- Enriched target schema (saving_kwh/toman/pct/how) → Task 5 (prompt) + Task 3 (render) + Task 4 (goals) + Task 6 (e2e). ✓
- Parser unchanged (passes target keys through) → noted in Global Constraints; verified by Task 6 persistence. ✓
- Model → `deepseek-reasoner` with metis fallback → Task 5. ✓
- StrictUndefined-safe prompt → Task 5 Step 5 render check. ✓
- Error/idempotency semantics intact → unchanged code paths; Task 6 keeps idempotency/parse-failure tests green. ✓
- Rollout re-seed with reset flags → Rollout section. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `_build_suggestion_context` (not `_build_prompt_variables`) used in Task 2 call-site and Task 5 render check; `_fmt_saving`, `saving_kwh/saving_toman/saving_pct/how` named identically across Tasks 3/4/5/6; model id `deepseek-reasoner` consistent. ✓
