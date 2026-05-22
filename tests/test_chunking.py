from energybot.kb.chunking import chunk_text


def test_short_text_one_chunk():
    chunks = chunk_text("کوتاه است.", target_tokens=400, overlap_tokens=60)
    assert len(chunks) == 1
    assert chunks[0] == "کوتاه است."


def test_long_text_produces_multiple_chunks():
    body = ("جمله. " * 500)
    chunks = chunk_text(body, target_tokens=200, overlap_tokens=40)
    assert len(chunks) >= 2
    for c in chunks:
        assert len(c) > 0


def test_paragraph_break_preserved():
    body = "پاراگراف اول.\n\nپاراگراف دوم."
    chunks = chunk_text(body, target_tokens=400, overlap_tokens=60)
    assert len(chunks) == 1
    assert "پاراگراف اول" in chunks[0]
    assert "پاراگراف دوم" in chunks[0]


def test_overlap_present_when_split():
    body = ("یک جمله طولانی. " * 200)
    chunks = chunk_text(body, target_tokens=100, overlap_tokens=40)
    assert len(chunks) >= 2
    tail_words = chunks[0].split()[-5:]
    assert any(w in chunks[1] for w in tail_words)
