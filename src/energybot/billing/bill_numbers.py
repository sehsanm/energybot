from dataclasses import dataclass

_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


@dataclass(slots=True)
class BillNumbers:
    bill_id: str
    pay_id: str | None
    utility_type: str


def _normalise(raw: str) -> str:
    return raw.translate(_FA_DIGITS)


def _check_digit(number: str) -> str:
    # Iranian bill/pay-id check digit: weights cycle 2..7 over reversed digits, mod 11.
    s, w = 0, 2
    for ch in reversed(number):
        s += int(ch) * w
        w = 2 if w == 7 else w + 1
    r = s % 11
    return "0" if r < 2 else str(11 - r)


def is_valid_bill_id(bill_id: str) -> bool:
    if not (bill_id.isdigit() and 6 <= len(bill_id) <= 13):
        return False
    # Reject all-zeros (trivial case).
    if all(c == "0" for c in bill_id):
        return False
    return _check_digit(bill_id[:-1]) == bill_id[-1]


# Iranian شناسه‌قبض standard: the last digit is a checksum and the digit
# immediately before it ("کد نوع خدمت") identifies the service. Verified against
# real bills, e.g. ...12|6 → "2" → electricity.
_SERVICE_TYPE_CODES = {
    "1": "water",
    "2": "electricity",
    "3": "gas",
    "4": "tel",
    "5": "mobile",
    "6": "municipality",
}


def utility_type_for(bill_id: str) -> str:
    # Service type is the 2nd-from-last digit of the bill id (see standard above).
    if not bill_id.isdigit() or len(bill_id) < 2:
        return "unknown"
    return _SERVICE_TYPE_CODES.get(bill_id[-2], "unknown")


def parse_bill_numbers(raw: str) -> BillNumbers:
    cleaned = "".join(c for c in _normalise(raw) if c.isdigit() or c.isspace())
    parts = cleaned.split()
    if len(parts) == 1 and len(parts[0]) == 26:
        bill_id, pay_id = parts[0][:13], parts[0][13:]
    elif len(parts) >= 2:
        bill_id, pay_id = parts[0], parts[1]
    elif len(parts) == 1:
        bill_id, pay_id = parts[0], None
    else:
        raise ValueError("no digits found")
    if not is_valid_bill_id(bill_id):
        raise ValueError(f"invalid bill id checksum: {bill_id!r}")
    return BillNumbers(bill_id=bill_id, pay_id=pay_id, utility_type=utility_type_for(bill_id))
