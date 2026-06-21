from energybot.billing.service import render_bill_summary


def test_shows_period_cost_and_consumption_no_debt():
    out = render_bill_summary(
        utility_type="electricity", amount=10775136, term="1405/2",
        details={"amounts": {"period": 10775136}, "consumption": {"total": 675},
                 "due_date": "1405/03/31"})
    assert "قبض برق" in out
    assert "مبلغ این دوره" in out and "۱٬۰۷۷٬۵۱۳ تومان" in out
    assert "بدهی قبلی" not in out          # no previous_debt
    assert "مصرف دوره" in out and "۶۷۵" in out
    assert "مهلت پرداخت: 1405/03/31" in out


def test_shows_debt_lines_when_present():
    out = render_bill_summary(
        utility_type="electricity", amount=10775136, term="1405/2",
        details={"amounts": {"period": 10775136, "previous_debt": 6497683,
                             "payable": 17272819}})
    assert "بدهی قبلی" in out and "۶۴۹٬۷۶۸ تومان" in out
    assert "قابل پرداخت" in out and "۱٬۷۲۷٬۲۸۱ تومان" in out


def test_cached_bill_and_fresh_detail_render_identically():
    from energybot.billing.service import render_bill

    class _Obj:
        utility_type = "electricity"; term = "1405/2"
        details = {"amounts": {"period": 10775136}, "consumption": {"total": 675}}
    fresh = _Obj(); fresh.amount = 6492000          # BillDetail-like (pay_amount)
    cached = _Obj(); cached.amount = 10775136        # Bill-like (period stored)
    assert render_bill(fresh) == render_bill(cached)  # both derive period from details
