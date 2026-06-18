import pytest
from energybot.profile.wizard import household_field_schema, normalize_household_value


def test_schema_lists_seven_household_fields():
    schema = household_field_schema()
    keys = [f["key"] for f in schema]
    assert keys == ["city", "home_type", "occupants", "area_m2", "heating_type", "cooling_type", "main_concern"]
    home = next(f for f in schema if f["key"] == "home_type")
    assert home["options"] == ["آپارتمان", "ویلایی", "مجتمع"]
    assert home["path"] == "household.home_type"
    city = next(f for f in schema if f["key"] == "city")
    assert city["options"] is None


def test_normalize_valid_select():
    assert normalize_household_value("household.home_type", "ویلایی") == "ویلایی"


def test_normalize_occupants_int():
    assert normalize_household_value("household.occupants", "5+") == 5


def test_normalize_rejects_invalid_option():
    with pytest.raises(ValueError):
        normalize_household_value("household.home_type", "قصر")


def test_normalize_unknown_path():
    with pytest.raises(KeyError):
        normalize_household_value("household.nope", "x")
