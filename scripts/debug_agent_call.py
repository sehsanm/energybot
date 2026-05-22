"""Replay the failed turn through the live agent loop and print the full exception.

Picks the most recent real user (one with profile.household populated) and re-sends the user's
last text message through build_agent_for_user. Catches any exception and dumps the traceback.

Run: `python scripts/debug_agent_call.py [optional-text-override]`
"""
from __future__ import annotations

import asyncio
import logging
import sys
import traceback
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from sqlalchemy import select  # noqa: E402

from energybot.core.db import get_sessionmaker  # noqa: E402
from energybot.core.models import Message, User  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


async def main() -> None:
    override_text = sys.argv[1] if len(sys.argv) > 1 else None
    Session = get_sessionmaker()
    async with Session() as s:
        user = (await s.execute(select(User).order_by(User.created_at.desc()).limit(1))).scalar_one_or_none()
        if user is None:
            print("no users in DB; talk to the bot once before running this script")
            return
        last = (await s.execute(
            select(Message).where(Message.user_id == user.id, Message.role == "user").order_by(Message.created_at.desc()).limit(1)
        )).scalar_one_or_none()
        text = override_text or (last.content if last else "تعرفه برق چقدر است؟")
        print(f"replaying user_id={user.id} bale_user_id={user.bale_user_id} text={text!r}")

    from energybot.bale_adapter.handler import build_agent_for_user
    Session = get_sessionmaker()
    agent = build_agent_for_user(user.id, 0, Session)
    try:
        reply = await agent.handle(user.id, 0, text)
        print("---- agent reply ----")
        print(reply)
    except Exception:
        print("---- exception ----")
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
