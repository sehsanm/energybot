from energybot.bale_adapter.web_login import build_web_login_markup


def test_markup_has_single_url_button():
    m = build_web_login_markup("https://app.example.ir/app/auth?t=abc")
    btn = m["inline_keyboard"][0][0]
    assert btn["url"] == "https://app.example.ir/app/auth?t=abc"
    assert "وب" in btn["text"]
    assert "callback_data" not in btn
