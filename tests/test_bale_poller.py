import httpx
import pytest

from energybot.bale_adapter.poller import BalePoller


@pytest.mark.asyncio
async def test_delete_webhook_calls_correct_endpoint():
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        return httpx.Response(200, json={"ok": True, "result": True})

    p = BalePoller(token="ABC", base_url="https://tapi.bale.ai", poll_timeout=0, transport=httpx.MockTransport(handler))
    await p._delete_webhook()
    assert paths == ["/botABC/deleteWebhook"]
    await p.aclose()


@pytest.mark.asyncio
async def test_fetch_includes_offset_after_set():
    captured: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json
        captured.append(_json.loads(request.content.decode()))
        return httpx.Response(200, json={"ok": True, "result": []})

    p = BalePoller(token="ABC", base_url="https://tapi.bale.ai", poll_timeout=0, transport=httpx.MockTransport(handler))
    # First fetch: no offset
    await p._fetch()
    assert "offset" not in captured[0]
    # After we advance offset manually, subsequent fetch should include it
    p._offset = 100
    await p._fetch()
    assert captured[1].get("offset") == 100
    await p.aclose()


@pytest.mark.asyncio
async def test_fetch_raises_when_response_not_ok():
    def handler(request):
        return httpx.Response(200, json={"ok": False, "description": "bad token"})

    p = BalePoller(token="x", base_url="https://tapi.bale.ai", poll_timeout=0, transport=httpx.MockTransport(handler))
    with pytest.raises(RuntimeError):
        await p._fetch()
    await p.aclose()


@pytest.mark.asyncio
async def test_run_loop_stops_on_signal_after_processing_updates():
    """Run a single iteration: fetch returns one update, _dispatch_one is stubbed,
    stop is signalled, and the next iteration exits cleanly."""
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/deleteWebhook"):
            return httpx.Response(200, json={"ok": True, "result": True})
        if request.url.path.endswith("/getUpdates"):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return httpx.Response(200, json={"ok": True, "result": [{"update_id": 7, "message": {}}]})
            return httpx.Response(200, json={"ok": True, "result": []})
        return httpx.Response(404)

    p = BalePoller(token="ABC", base_url="https://tapi.bale.ai", poll_timeout=0, transport=httpx.MockTransport(handler))
    dispatched: list[int] = []

    async def fake_dispatch(upd):
        dispatched.append(upd["update_id"])
        p.stop()  # stop right after we've seen the first update

    p._dispatch_one = fake_dispatch  # type: ignore[method-assign]
    await p.run()

    assert dispatched == [7]
    # offset should have advanced to 8 (update_id + 1)
    assert p._offset == 8
    await p.aclose()
