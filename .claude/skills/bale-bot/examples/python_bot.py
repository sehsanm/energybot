"""
Minimal Bale bot in Python using long-polling getUpdates + the standard library
(httpx in real code; stdlib here so the example runs anywhere).

Run:
    BALE_BOT_TOKEN=123456789:abc...  python python_bot.py

What it does:
- Verifies the token with getMe
- Polls getUpdates, tracking offset to avoid duplicates
- Echoes text and answers an inline button
- Handles callback_query within the 10-second window
"""

import json
import os
import time
import urllib.parse
import urllib.request

TOKEN = os.environ["BALE_BOT_TOKEN"]
BASE = f"https://tapi.bale.ai/bot{TOKEN}"


def call(method: str, **params) -> dict:
    """POST application/json to a bot method and return the parsed result."""
    body = json.dumps(params).encode()
    req = urllib.request.Request(
        f"{BASE}/{method}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read())
    if not payload.get("ok"):
        # Surface error_code + description so the caller can react / log
        raise RuntimeError(f"{method} failed: {payload}")
    return payload["result"]


def handle_message(msg: dict) -> None:
    chat_id = msg["chat"]["id"]
    text = msg.get("text", "")

    if text.startswith("/start"):
        # Persistent inline button so the user can tap to interact
        keyboard = {
            "inline_keyboard": [
                [{"text": "Ping", "callback_data": "ping"}],
                [{"text": "Open docs", "url": "https://docs.bale.ai/"}],
            ]
        }
        call(
            "sendMessage",
            chat_id=chat_id,
            text="**Welcome!** Tap a button below.",
            reply_markup=keyboard,
        )
    elif text:
        # Plain echo (bot-quality is in the next lines, not in this branch)
        call("sendMessage", chat_id=chat_id, text=f"You said: {text}")


def handle_callback(cb: dict) -> None:
    # Must answer within 10s or the button stays in loading state
    call(
        "answerCallbackQuery",
        callback_query_id=cb["id"],
        text="pong",
        show_alert=False,
    )


def main() -> None:
    me = call("getMe")
    print(f"Logged in as @{me.get('username')} (id={me['id']})")

    offset = 0
    while True:
        try:
            # Long-poll: server holds the connection up to `timeout` seconds
            updates = call("getUpdates", offset=offset, timeout=25, limit=100)
        except Exception as e:
            # Network blip; back off and retry — do NOT advance offset
            print("poll error:", e)
            time.sleep(2)
            continue

        for upd in updates:
            offset = upd["update_id"] + 1  # confirm this update
            if "message" in upd:
                handle_message(upd["message"])
            elif "callback_query" in upd:
                handle_callback(upd["callback_query"])
            # pre_checkout_query / edited_message handlers would go here


if __name__ == "__main__":
    main()
