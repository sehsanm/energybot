from energybot.profile.render import render_profile_summary


def test_empty_profile_renders_no_data_message():
    out = render_profile_summary({}, {}, [], [])
    assert "هنوز اطلاعاتی" in out


def test_household_fields_rendered_in_persian():
    out = render_profile_summary(
        household={"city": "تهران", "home_type": "آپارتمان", "occupants": 3, "heating_type": "پکیج"},
        behaviour={},
        goals=[],
        commitments=[],
    )
    assert "تهران" in out
    assert "آپارتمان" in out
    assert "۳" in out  # Persian digit
    assert "پکیج" in out


def test_goals_and_commitments_rendered():
    out = render_profile_summary(
        household={},
        behaviour={},
        goals=[{"text": "کاهش قبض برق", "status": "active"}],
        commitments=[{"text": "ترموستات روی ۲۱", "fulfilled": False}],
    )
    assert "کاهش قبض برق" in out
    assert "ترموستات روی ۲۱" in out
