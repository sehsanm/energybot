from energybot.billing.bill_numbers import (
    parse_bill_numbers, is_valid_bill_id, utility_type_for, BillNumbers,
)
import pytest

# A constructed valid bill id (checksum verified by the same algorithm under test).
VALID_BILL_ID = "1177095800131"  # electricity sample
VALID_PAY_ID = "0151101290105"


def test_parse_two_part_string():
    bn = parse_bill_numbers(f"{VALID_BILL_ID} {VALID_PAY_ID}")
    assert bn.bill_id == VALID_BILL_ID
    assert bn.pay_id == VALID_PAY_ID


def test_parse_normalises_persian_digits_and_spaces():
    persian = "۱۱۷۷۰۹۵۸۰۰۱۳۱"
    bn = parse_bill_numbers(persian)
    assert bn.bill_id == VALID_BILL_ID
    assert bn.pay_id is None


def test_parse_26_digit_concatenation():
    bn = parse_bill_numbers(VALID_BILL_ID + VALID_PAY_ID)
    assert bn.bill_id == VALID_BILL_ID
    assert bn.pay_id == VALID_PAY_ID


def test_invalid_bill_id_raises():
    with pytest.raises(ValueError):
        parse_bill_numbers("1234567890123")  # bad checksum


def test_is_valid_bill_id():
    assert is_valid_bill_id(VALID_BILL_ID) is True
    assert is_valid_bill_id("0000000000000") is False


def test_utility_type_returns_known_value():
    # Branch 1: head "1" → "electricity"
    assert utility_type_for(VALID_BILL_ID) == "electricity"
    # Branch 2: head "2" → "gas"
    assert utility_type_for("2000000000000") == "gas"
    # Branch 3: head other → "unknown"
    assert utility_type_for("9000000000000") == "unknown"
