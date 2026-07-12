from energybot.bale_adapter.parser import parse_update, UpdateCallback


def test_callback_carries_message_id():
    upd = parse_update({
        "update_id": 5,
        "callback_query": {
            "id": "cb1", "from": {"id": 42},
            "message": {"message_id": 77, "chat": {"id": 42}},
            "data": "ms:tb:a",
        },
    })
    assert isinstance(upd, UpdateCallback)
    assert upd.message_id == 77


def test_callback_without_message_id_is_none():
    upd = parse_update({
        "update_id": 5,
        "callback_query": {"id": "cb1", "from": {"id": 42}, "data": "x"},
    })
    assert isinstance(upd, UpdateCallback)
    assert upd.message_id is None
