from typing import Any


def _num(v: Any):
    if v is None:
        return None
    s = str(v).replace(",", "").strip()
    if s == "":
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return int(f) if f.is_integer() else f


def _compact(d: dict) -> dict:
    return {k: v for k, v in d.items() if v not in (None, "", {}, [])}


def _parse_electricity(result: dict, info: dict) -> dict:
    normal, peak = _num(info.get("NormalConsumption")), _num(info.get("PeakConsumption"))
    low, friday = _num(info.get("LowConsumption")), _num(info.get("FridayConsumption"))
    tiered = [x for x in (normal, peak, low, friday) if x is not None]
    total = sum(tiered) if tiered else None
    consumption = _compact({
        "normal": normal, "peak": peak, "low": low, "friday": friday,
        "reactive": _num(info.get("ReactiveConsumption")),
        "average": _num(info.get("AverageConsumption")),
        "total": total, "unit": "kWh" if total is not None else None,
    })
    period = _compact({
        "year": _num(info.get("Year")), "number": _num(info.get("Period")),
        "days": _num(info.get("TotalDaysCount")),
    })
    reading = _compact({
        "previous_date": info.get("PreviousReadingDate"),
        "current_date": info.get("CurrentReadingDate"),
    })
    amounts = _compact({
        "period": _num(info.get("PeriodAmount")),
        "previous_debt": _num(info.get("PreviousDebt")),
        "payable": _num(info.get("BillPayableAmount")),
        "pay_amount": _num(result.get("Amount")),
        "energy": _num(info.get("EnergyAmount")),
        "tax": _num(info.get("TaxAmount")),
        "subscription": _num(info.get("SubscriptionAmount")),
    })
    return _compact({
        "company": info.get("CompanyName"),
        "customer": (info.get("CustomerName") or "").strip() or None,
        "customer_type": info.get("CustomerType"),
        "tariff": info.get("TariffType"),
        "phase": _num(info.get("Phase")),
        "amper": _num(info.get("Amper")),
        "period": period, "reading": reading,
        "due_date": result.get("Date"),
        "consumption": consumption, "amounts": amounts,
    })


def parse_bill_details(utility_type: str, raw: dict) -> dict:
    result = raw.get("result") or {}
    info = result.get("Info") or {}
    if utility_type == "electricity":
        return _parse_electricity(result, info)
    # gas/water/unknown: passthrough until dedicated parsers exist.
    return {"raw_info": info} if info else {}
