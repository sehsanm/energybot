# Bill inquiry caching + detail extraction — design

**Date:** 2026-06-21
**Status:** Approved (pending spec review)

## Problem

1. Every bill inquiry calls Finnotech and inserts a new `bills` row, even for a
   bill ID we have already fetched. Each شناسه‌قبض encodes a single period's bill
   (amount and pay-id are baked into the identifier), so the same bill ID always
   returns the same data — repeat calls are pure waste.
2. The rich `Info` block Finnotech returns (consumption by peak/off-peak, tariff,
   phase/amper, period days, debt breakdown) is stored only as opaque
   `raw_inquiry` JSON. The AI's `read_bills` tool sees just `amount/term/status`,
   so it cannot give consumption-aware suggestions.

## Decisions

- **Cache:** permanent, keyed by bill ID, per-user. No TTL, no manual refresh —
  a given bill ID is immutable; the user gets new data by entering the next
  period's bill ID.
- **Detail:** parse `Info` into a provider-agnostic normalized structure stored
  in a new `bills.details` JSONB column, and surface it through the existing
  `read_bills` tool.

## Design

### 1. Caching (permanent, per bill ID)

`BillingService.handle_input`, after parsing the bill ID:

```
bn = parse_bill_numbers(text) / decode_bill_barcode(image)
cached = repo.find_bill_by_bill_id(user_id, bn.bill_id)
if cached: return CaptureResult(ok=True, summary=render_bill(cached),
                                pay_callback=f"pay:{cached.id}", bill_db_id=cached.id)
detail = fin.inquire_bill(bn.bill_id)          # only on cache miss
sub    = repo.get_or_create_subscription(...)
bill   = repo.add_bill(user_id, sub.id, detail)
return CaptureResult(ok=True, summary=render_bill(bill), ...)
```

New repo method:

```python
async def find_bill_by_bill_id(self, user_id, bill_id) -> Bill | None:
    # Bill -> UtilitySubscription (unique per user+bill_id); newest first.
    select(Bill).join(UtilitySubscription, ...).where(
        UtilitySubscription.user_id == user_id,
        UtilitySubscription.bill_id == bill_id,
        UtilitySubscription.deleted_at.is_(None),
    ).order_by(Bill.inquired_at.desc()).limit(1)
```

Scope is per-user; the rare cross-user same-ID case re-queries Finnotech, which
is acceptable.

### 2. Detail extraction (normalized)

New module `billing/bill_details.py`:

```python
def parse_bill_details(utility_type: str, raw: dict) -> dict
```

Reads `raw["result"]["Info"]`. **Electricity** (implemented now):

```json
{
  "company": "توزيع نيروی برق تهران بزرگ",
  "customer": "سيدکمال الدين محمودي و شرکا",
  "customer_type": "حقیقی",
  "tariff": "خانگی",
  "phase": 3,
  "amper": 25,
  "period": {"year": 1405, "number": 2, "days": 58},
  "reading": {"previous_date": "1405/01/22", "current_date": "1405/03/18"},
  "due_date": "1405/03/31",
  "consumption": {"normal": 366, "peak": 136, "low": 173, "friday": 0,
                  "reactive": 0, "average": 349, "total": 675, "unit": "kWh"},
  // total = normal + peak + low + friday (tiered period readings)
  "amounts": {"period": 10775136, "previous_debt": 6497683, "payable": 17272819,
              "pay_amount": 6492000, "energy": 8219830, "tax": 573540,
              "subscription": 31555}
  // period = this period's cost · previous_debt = carried debt
  // payable = period + previous_debt · pay_amount = top-level Finnotech Amount
  //   (the value encoded in the شناسه‌پرداخت, used by the payment flow)
}
```

Gas / water / unknown → minimal passthrough (`{"raw_info": <Info>}`) for now;
the function dispatches on `utility_type` so per-type parsers can be added later.
Numeric fields are coerced from Finnotech's string values; missing keys are
omitted, never guessed.

`BillDetail` gains `details: dict`. `FinnotechClient.inquire_bill` calls
`parse_bill_details(utype, data)` to populate it.

### 3. Persistence

- Alembic migration: add `details JSONB NOT NULL DEFAULT '{}'` to `bills`.
- `add_bill` sets `details=detail.details`, `consumption` = period-total kWh
  (`consumption.total` when present, else `None`), and
  `amount` = `details.amounts.period` when present, else `detail.amount`
  (top-level `Amount`). So `Bill.amount` is the **current period cost** with debt
  excluded; gas/water (no period parsed yet) keep the top-level `Amount`.
- No backfill of existing rows (prod has effectively none); old rows keep
  `details = {}`.

### 4. Rendering

`render_bill(bill)` renders from normalized fields (`utility_type`, `amount`,
`term`, `details`) so cached and fresh bills are byte-identical. Enrich the bot
summary with consumption when present, e.g.:

```
📄 قبض برق
مبلغ این دوره: ۱٬۰۷۷٬۵۱۳ تومان
بدهی قبلی: ۶۴۹٬۷۶۸ تومان
قابل پرداخت: ۱٬۷۲۷٬۲۸۱ تومان
دوره: 1405/2
مصرف دوره: ۶۷۵ کیلووات‌ساعت
مهلت پرداخت: 1405/03/31
```

**Amount semantics:** the headline is the **current period cost**
(`details.amounts.period` → ۱٬۰۷۷٬۵۱۳ تومان), with carried debt shown as a
separate `بدهی قبلی` line and the sum as `قابل پرداخت`. The `بدهی قبلی` and
`قابل پرداخت` lines are shown only when `previous_debt > 0`. `Bill.amount` holds
the period cost (so trend and the AI compare like-for-like across periods,
debt-free).

**Payment amount (flagged):** the payment flow charges the شناسه‌پرداخت-encoded
top-level `Amount` (`details.amounts.pay_amount`), which on this sample
(6,492,000) matches neither the period nor the payable cleanly — it appears to
track the previous debt. `start_payment` reads `pay_amount` (fallback
`bill.amount`). Reconciling exactly what the شناسه‌پرداخت settles needs more real
bills/payments to verify and is **out of scope** here; this change only ensures
display/AI separate period cost from debt.

`render_summary(detail)` is refactored to delegate to the same field-based
renderer so the fresh and cached paths share one implementation.

### 5. AI access

`ReadBillsTool.invoke` adds `details` to each bill item (full normalized dict;
the model can ignore fields it doesn't need). Trend computation unchanged.

## Testing

- **Unit** (`test_bill_details.py`): electricity sample `Info` → expected dict;
  numeric coercion; unknown type → passthrough.
- **Unit** (`test_finnotech_client.py`): `inquire_bill` populates `details`.
- **Unit** (render): cached-vs-fresh summary identical; consumption line shown
  when present, omitted when absent; `بدهی قبلی`/`قابل پرداخت` lines appear only
  when `previous_debt > 0`.
- **Unit**: `Bill.amount` = `details.amounts.period` for electricity; falls back
  to top-level `Amount` when no period is parsed (gas/water).
- **Integration** (`test_billing_service.py`): second inquiry for the same bill
  ID makes **no** Finnotech call (fake client asserts call count), returns the
  same `bill_db_id`, inserts no new row; `details`/`consumption` persisted;
  `read_bills` returns `details`.

## Out of scope

- Re-modeling `UtilitySubscription` (today it is effectively one-per-bill because
  bill IDs are period-specific) — left as-is.
- Gas/water detail parsers (structure is ready; bodies added when needed).
- Refresh-after-payment / debt re-query.
