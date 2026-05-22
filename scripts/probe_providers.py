"""Lightweight diagnostic: probe each provider directly with the configured key + model.

Reads .env via Settings, fires one minimal chat completion at DeepSeek and Metis, and one
embedding call at Metis. Prints status codes and short error excerpts. Does not touch the DB.

Run: `python scripts/probe_providers.py`
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

import httpx  # noqa: E402

from energybot.settings import get_settings  # noqa: E402


async def probe_chat(*, name: str, base_url: str, api_key: str, model: str, proxy: str | None = None) -> None:
    if not api_key:
        print(f"[{name}] SKIP — no API key set")
        return
    if api_key.startswith("replace") or api_key.startswith("sk-replace"):
        print(f"[{name}] WARNING — API key looks like the placeholder ({api_key[:12]}...). Calls will fail with 401.")
    url = f"{base_url.rstrip('/')}/chat/completions"
    body = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 5,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), proxy=proxy) as c:
        try:
            r = await c.post(url, json=body, headers=headers)
        except httpx.HTTPError as e:
            print(f"[{name}] NETWORK ERROR: {type(e).__name__}: {e}")
            return
    if r.status_code == 200:
        data = r.json()
        usage = data.get("usage", {})
        print(f"[{name}] OK — model={model} tokens_in={usage.get('prompt_tokens')} tokens_out={usage.get('completion_tokens')}")
    else:
        print(f"[{name}] HTTP {r.status_code} — {r.text[:300]}")


async def probe_embed(*, name: str, base_url: str, api_key: str, model: str) -> None:
    if not api_key or api_key.startswith("replace"):
        print(f"[{name} embed] SKIP — placeholder or empty key")
        return
    url = f"{base_url.rstrip('/')}/embeddings"
    body = {"model": model, "input": "ping"}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as c:
        try:
            r = await c.post(url, json=body, headers=headers)
        except httpx.HTTPError as e:
            print(f"[{name} embed] NETWORK ERROR: {type(e).__name__}: {e}")
            return
    if r.status_code == 200:
        data = r.json()
        dim = len(data["data"][0]["embedding"]) if data.get("data") else "?"
        print(f"[{name} embed] OK — model={model} dim={dim}")
    else:
        print(f"[{name} embed] HTTP {r.status_code} — {r.text[:300]}")


async def main() -> None:
    s = get_settings()
    print("== probe ==")
    print(f"deepseek_base_url = {s.deepseek_base_url}")
    print(f"metis_base_url    = {s.metis_base_url}")
    print(f"frontier_base_url = {s.frontier_base_url}")
    print(f"DEEPSEEK_API_KEY  = {'set' if s.deepseek_api_key else 'UNSET'} ({s.deepseek_api_key[:6]}...)")
    print(f"METIS_API_KEY     = {'set' if s.metis_api_key else 'UNSET'} ({s.metis_api_key[:8]}...)")
    print(f"FRONTIER_API_KEY  = {'set' if s.frontier_api_key else 'UNSET'} ({s.frontier_api_key[:8]}...)")

    # Try the model name actually configured in the seed defaults, and a legacy fallback.
    await probe_chat(
        name="deepseek/v4-flash",
        base_url=s.deepseek_base_url, api_key=s.deepseek_api_key,
        model="deepseek-v4-flash", proxy=s.deepseek_proxy_url,
    )
    await probe_chat(
        name="deepseek/chat (legacy)",
        base_url=s.deepseek_base_url, api_key=s.deepseek_api_key,
        model="deepseek-chat", proxy=s.deepseek_proxy_url,
    )
    await probe_chat(
        name="metis/gpt-4o-mini",
        base_url=s.metis_base_url, api_key=s.metis_api_key,
        model="gpt-4o-mini",
    )
    await probe_embed(
        name="metis",
        base_url=s.metis_base_url, api_key=s.metis_api_key,
        model="text-embedding-3-small",
    )


if __name__ == "__main__":
    asyncio.run(main())
