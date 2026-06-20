import pytest
from energybot.bale_adapter.client import BaleClient
from energybot.bale_adapter.commands import BOT_COMMAND_MENU


@pytest.mark.asyncio
async def test_set_my_commands_posts_payload():
    client = BaleClient(token="x")
    captured = {}

    async def fake_post(method, payload):
        captured["method"] = method
        captured["payload"] = payload
        return {"ok": True, "result": True}

    client._post_json = fake_post  # type: ignore[assignment]
    await client.set_my_commands(BOT_COMMAND_MENU)
    assert captured["method"] == "setMyCommands"
    assert captured["payload"]["commands"][0]["command"] == "start"
    # commands registered without a leading slash
    assert all(not c["command"].startswith("/") for c in captured["payload"]["commands"])
    assert any(c["command"] == "bill" for c in captured["payload"]["commands"])


@pytest.mark.asyncio
async def test_set_my_commands_swallows_errors():
    client = BaleClient(token="x")

    async def boom(method, payload):
        raise RuntimeError("network down")

    client._post_json = boom  # type: ignore[assignment]
    # Must not raise — registration is best-effort at startup.
    await client.set_my_commands(BOT_COMMAND_MENU)
