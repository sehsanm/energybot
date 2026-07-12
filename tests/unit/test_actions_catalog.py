import pytest

from energybot.bale_adapter.actions import (
    CATALOG, CATALOG_KEYS, build_suggestions_markup, REPLY_KB_ROUTES, QuickAction,
)


def test_catalog_has_expected_keys():
    assert set(CATALOG_KEYS) == {
        "view_profile", "query_bill", "web_login", "saving_tips", "set_goal", "toolbox", "more_help",
    }
    for key, action in CATALOG.items():
        assert isinstance(action, QuickAction)
        assert action.key == key
        assert action.label  # non-empty Persian label
        assert action.kind in {"profile", "bill", "web", "home", "prompt", "toolbox"}
        if action.kind == "prompt":
            assert action.prompt


def test_build_suggestions_markup_renders_inline_buttons():
    markup = build_suggestions_markup(["query_bill", "view_profile"])
    rows = markup["inline_keyboard"]
    assert rows[0][0]["callback_data"] == "act:query_bill"
    assert rows[0][0]["text"] == CATALOG["query_bill"].label
    assert rows[1][0]["callback_data"] == "act:view_profile"


def test_build_suggestions_markup_drops_unknown_and_empty():
    assert build_suggestions_markup([]) is None
    assert build_suggestions_markup(["bogus"]) is None
    markup = build_suggestions_markup(["bogus", "web_login"])
    assert len(markup["inline_keyboard"]) == 1
    assert markup["inline_keyboard"][0][0]["callback_data"] == "act:web_login"


def test_reply_kb_routes_cover_core_four():
    assert REPLY_KB_ROUTES == {
        "قبض من": "bill", "پروفایل": "profile", "ابزارها": "toolbox",
        "نسخه وب": "web", "راهنما": "home",
    }


def test_prompt_kind_requires_nonempty_prompt():
    with pytest.raises(ValueError):
        QuickAction("x", "label", "prompt")  # missing prompt
    with pytest.raises(ValueError):
        QuickAction("x", "label", "prompt", prompt="")  # empty prompt
    # non-prompt kinds don't require a prompt
    QuickAction("y", "label", "home")
