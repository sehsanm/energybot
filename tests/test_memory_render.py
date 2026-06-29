from energybot.memory.render import render_memory


class _M:
    def __init__(self, id, text, category):
        self.id = id
        self.text = text
        self.category = category


def test_empty_returns_empty_string():
    assert render_memory([]) == ""


def test_groups_by_category_with_id_prefix():
    out = render_memory([
        _M(12, "اتاق خنک را دوست دارد", "preference"),
        _M(15, "شیفت شب کار می‌کند", "life_context"),
    ])
    assert "ترجیحات" in out
    assert "شرایط زندگی" in out
    assert "[12]" in out          # ascii id, round-trips as integer
    assert "[15]" in out
    assert "اتاق خنک را دوست دارد" in out


def test_unknown_category_falls_back_to_misc_heading():
    out = render_memory([_M(1, "چیزی", "something_weird")])
    assert "سایر" in out
    assert "چیزی" in out
