from energybot.bale_adapter.home import INTRO_TEXT, HOME_TEXT, REPLY_KEYBOARD, build_home_message
from energybot.bale_adapter.actions import REPLY_KB_ROUTES


def test_intro_and_home_text_present():
    assert INTRO_TEXT.strip()
    assert HOME_TEXT.strip()
    # Home must explicitly tell the user they can chat directly.
    assert "بنویس" in HOME_TEXT or "بپرس" in HOME_TEXT


def test_reply_keyboard_labels_match_router():
    labels = {btn["text"] for row in REPLY_KEYBOARD["keyboard"] for btn in row}
    assert labels == set(REPLY_KB_ROUTES.keys())
    assert REPLY_KEYBOARD["resize_keyboard"] is True


def test_build_home_message_returns_text_and_keyboard():
    text, markup = build_home_message()
    assert text == HOME_TEXT
    assert markup is REPLY_KEYBOARD
