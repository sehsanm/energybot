from energybot.billing.bill_details import parse_bill_details

# Trimmed real Finnotech electricity response.
RAW = {"status": "DONE", "result": {
    "Amount": "6492000", "BillId": "9706459904126", "PayId": "649250240",
    "Date": "1405/03/31", "Info": {
        "CompanyName": "توزيع نيروی برق تهران بزرگ", "CustomerName": "سيدکمال ",
        "CustomerType": "حقیقی", "TariffType": "خانگی", "Phase": "3", "Amper": "25",
        "Year": "1405", "Period": "2", "TotalDaysCount": "58",
        "PreviousReadingDate": "1405/01/22", "CurrentReadingDate": "1405/03/18",
        "NormalConsumption": "366", "PeakConsumption": "136", "LowConsumption": "173",
        "FridayConsumption": "0", "ReactiveConsumption": "0", "AverageConsumption": "349",
        "BillPayableAmount": "17272819", "PeriodAmount": "10775136",
        "PreviousDebt": "6497683", "EnergyAmount": "8219830", "TaxAmount": "573540",
        "SubscriptionAmount": "31555",
    }}}


def test_electricity_parses_consumption_and_amounts():
    d = parse_bill_details("electricity", RAW)
    assert d["tariff"] == "خانگی"
    assert d["phase"] == 3 and d["amper"] == 25
    assert d["period"] == {"year": 1405, "number": 2, "days": 58}
    assert d["reading"] == {"previous_date": "1405/01/22", "current_date": "1405/03/18"}
    assert d["due_date"] == "1405/03/31"
    assert d["consumption"]["total"] == 675  # 366+136+173+0
    assert d["consumption"]["unit"] == "kWh"
    assert d["consumption"]["peak"] == 136
    assert d["amounts"]["period"] == 10775136
    assert d["amounts"]["previous_debt"] == 6497683
    assert d["amounts"]["payable"] == 17272819
    assert d["amounts"]["pay_amount"] == 6492000


def test_missing_keys_are_omitted_not_guessed():
    raw = {"result": {"Amount": "100", "Info": {"TariffType": "خانگی"}}}
    d = parse_bill_details("electricity", raw)
    assert d["tariff"] == "خانگی"
    assert "consumption" not in d  # no readings present
    assert d["amounts"] == {"pay_amount": 100}


def test_unknown_type_passthrough():
    raw = {"result": {"Amount": "5", "Info": {"X": "1"}}}
    assert parse_bill_details("gas", raw) == {"raw_info": {"X": "1"}}
    assert parse_bill_details("water", {"result": {}}) == {}
