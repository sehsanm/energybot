from collections.abc import Callable
from typing import Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.bale_adapter.client import BaleClient
from energybot.bale_adapter.commands import is_command, is_wizard_answer
from energybot.bale_adapter.parser import parse_update, UpdateText, UpdateCallback, UpdatePhoto, UpdateDocument, UpdateUnknown
from energybot.core.models import User, Profile, OnboardingState
from energybot.profile.repository import ProfileRepository
from energybot.profile.wizard import WizardEngine
from energybot.billing.factory import build_billing_service
from energybot.settings import get_settings


_bale_singleton: BaleClient | None = None


def get_bale_client() -> BaleClient:
    global _bale_singleton
    if _bale_singleton is None:
        s = get_settings()
        _bale_singleton = BaleClient(token=s.bale_bot_token, base_url=s.bale_api_base)
    return _bale_singleton


def build_agent_for_user(user_id, chat_id, session_factory):
    from energybot.agent.builder import build_agent
    from energybot.agent.channels import BaleChannel
    return build_agent(user_id=user_id, channel=BaleChannel(get_bale_client(), chat_id), session_factory=session_factory)


async def _send_capture(bale, chat_id, res):
    if not res.ok:
        await bale.send_message(chat_id=chat_id, text=res.error)
        return
    markup = {"inline_keyboard": [[{"text": "پرداخت 💳", "callback_data": res.pay_callback}]]}
    await bale.send_message(chat_id=chat_id, text=res.summary, reply_markup=markup)


async def _ensure_user_and_profile(session: AsyncSession, bale_user_id: int, display_name: str | None) -> User:
    u = (await session.execute(select(User).where(User.bale_user_id == bale_user_id))).scalar_one_or_none()
    if u is None:
        u = User(bale_user_id=bale_user_id, display_name=display_name)
        session.add(u)
        await session.flush()
        session.add(Profile(user_id=u.id))
        await session.commit()
    return u


async def handle_bale_update(body: dict[str, Any], *, session_factory: Callable[[], AsyncSession]) -> None:
    parsed = parse_update(body)
    if isinstance(parsed, UpdateUnknown):
        return
    session = session_factory()
    user = await _ensure_user_and_profile(session, parsed.bale_user_id, getattr(parsed, "display_name", None))
    bale = get_bale_client()
    await bale.send_chat_action(chat_id=parsed.chat_id, action="typing")

    profile_repo = ProfileRepository(session_factory=session_factory)
    wizard = WizardEngine(session_factory=session_factory, profile_repo=profile_repo)

    if isinstance(parsed, UpdateText):
        text = parsed.text.strip()
        if not await _has_onboarding_state(session, user.id):
            from energybot.bale_adapter.home import INTRO_TEXT
            await bale.send_message(chat_id=parsed.chat_id, text=INTRO_TEXT)
            step = await wizard.start(user.id)
            await _send_step(bale, parsed.chat_id, step)
            return
        if text == "/start":
            current = await wizard.current_step(user.id)
            if current is not None:
                # Mid-wizard: resume where they left off.
                await _send_step(bale, parsed.chat_id, current)
            else:
                await _send_home(bale, parsed.chat_id)
            return
        if text == "/help":
            await _send_home(bale, parsed.chat_id)
            return
        if text == "/web":
            await _send_web(bale, session, user, parsed.chat_id)
            return
        if text == "/profile":
            await _send_profile(bale, session, session_factory, user, parsed.chat_id)
            return
        if text == "/restart":
            await bale.send_message(chat_id=parsed.chat_id, text="گفتگوی تازه آغاز شد. در چه موردی صحبت کنیم؟")
            return
        if text == "/forget":
            from datetime import datetime
            user.deleted_at = datetime.utcnow()
            user.display_name = "[deleted]"
            p = await profile_repo.get(user.id)
            p.deleted_at = datetime.utcnow()
            await session.commit()
            await bale.send_message(chat_id=parsed.chat_id, text="باشد، اطلاعات شما حذف شد.")
            return

        from energybot.bale_adapter.actions import REPLY_KB_ROUTES
        kind = REPLY_KB_ROUTES.get(text)
        if kind is not None:
            if kind == "home":
                await _send_home(bale, parsed.chat_id)
            elif kind == "profile":
                await _send_profile(bale, session, session_factory, user, parsed.chat_id)
            elif kind == "web":
                await _send_web(bale, session, user, parsed.chat_id)
            elif kind == "bill":
                await _send_bill_prompt(bale, parsed.chat_id)
            return

        if text.startswith("/bill"):
            arg = text[len("/bill"):].strip()
            if not arg:
                await _send_bill_prompt(bale, parsed.chat_id)
                return
            await _process_typed_bill(bale, session_factory, user.id, parsed.chat_id, arg)
            return

        current = await wizard.current_step(user.id)
        if current is not None:
            if is_wizard_answer(text):
                next_step = await wizard.answer(user.id, text)
                if next_step is None:
                    await _send_home(bale, parsed.chat_id)
                    return
                await _send_step(bale, parsed.chat_id, next_step)
                return
            else:
                await wizard.abandon(user.id)

        # A bare bill id typed in (after tapping "قبض من", or pasted directly) looks
        # like ordinary text, so route it to the billing service before the LLM agent —
        # the agent has no bill-lookup tool and would deflect it as off-domain.
        if _looks_like_bill_id(text):
            await _process_typed_bill(bale, session_factory, user.id, parsed.chat_id, text)
            return

        await _reply_with_agent(bale, user, parsed.chat_id, text, session_factory)

    elif isinstance(parsed, UpdatePhoto):
        try:
            file_path = await bale.get_file(parsed.file_id)
            image_bytes = await bale.download_file(file_path)
            svc = build_billing_service(session_factory)
            res = await svc.handle_input(user.id, image_bytes=image_bytes)
        except Exception:
            from energybot.logging import get_logger
            get_logger(__name__).exception("photo_billing_failed", chat_id=parsed.chat_id)
            await bale.send_message(chat_id=parsed.chat_id, text="نتونستم عکس رو پردازش کنم. دوباره امتحان کن.")
            return
        await _send_capture(bale, parsed.chat_id, res)
        return

    elif isinstance(parsed, UpdateDocument):
        await _handle_bill_document(bale, session_factory, user.id, parsed)
        return

    elif isinstance(parsed, UpdateCallback):
        await bale.answer_callback_query(callback_query_id=parsed.callback_id)
        if parsed.data.startswith("act:"):
            await _dispatch_quick_action(bale, session, session_factory, user, parsed.chat_id, parsed.data[4:])
            return
        if parsed.data.startswith("pay:"):
            from uuid import UUID
            svc = build_billing_service(session_factory)
            try:
                url = await svc.start_payment(user.id, parsed.chat_id, UUID(parsed.data[4:]))
            except Exception:
                from energybot.logging import get_logger
                get_logger(__name__).exception("pay_start_failed", chat_id=parsed.chat_id)
                await bale.send_message(chat_id=parsed.chat_id, text="ایجاد لینک پرداخت ناموفق بود. بعداً امتحان کن.")
                return
            await bale.send_message(chat_id=parsed.chat_id, text=f"برای پرداخت روی این لینک بزن:\n{url}")
            return
        current = await wizard.current_step(user.id)
        if current is not None:
            next_step = await wizard.answer(user.id, parsed.data)
            if next_step is None:
                await _send_home(bale, parsed.chat_id)
            else:
                await _send_step(bale, parsed.chat_id, next_step)


async def _has_onboarding_state(session: AsyncSession, user_id) -> bool:
    row = (await session.execute(select(OnboardingState).where(OnboardingState.user_id == user_id))).scalar_one_or_none()
    return row is not None


async def _send_home(bale: BaleClient, chat_id: int) -> None:
    from energybot.bale_adapter.home import build_home_message
    text, markup = build_home_message()
    await bale.send_message(chat_id=chat_id, text=text, reply_markup=markup)


async def _send_step(bale: BaleClient, chat_id: int, step) -> None:
    markup = None
    if step.buttons:
        markup = {"inline_keyboard": [[{"text": b, "callback_data": b}] for b in step.buttons]}
    await bale.send_message(chat_id=chat_id, text=step.prompt, reply_markup=markup)


async def _send_profile(bale, session, session_factory, user, chat_id) -> None:
    from energybot.profile.render import render_profile_summary, render_bills_line
    from energybot.billing.repository import BillingRepository
    profile_repo = ProfileRepository(session_factory=session_factory)
    p = await profile_repo.get(user.id)
    summary = render_profile_summary(p.household or {}, p.behaviour or {}, p.goals or [], p.commitments or [])
    bills = await BillingRepository(session_factory=session_factory).recent_bills(user.id, limit=6)
    line = render_bills_line([{"utility_type": b.utility_type, "amount": int(b.amount), "term": b.term} for b in bills])
    if line:
        summary = summary + "\n\n" + line
    await bale.send_message(chat_id=chat_id, text=summary)


async def _send_web(bale, session, user, chat_id) -> None:
    from energybot.user_api.tokens import mint_login_token
    from energybot.bale_adapter.web_login import build_web_login_markup
    s = get_settings()
    if not s.public_base_url:
        await bale.send_message(chat_id=chat_id, text="نسخهٔ وب هنوز پیکربندی نشده است.")
        return
    raw = await mint_login_token(session, user.id, ttl_minutes=s.web_login_token_ttl_minutes)
    # Trailing slash matches the app_ui static export (trailingSlash: true) so the
    # link resolves directly without a 307 that would downgrade the token to http.
    url = f"{s.public_base_url.rstrip('/')}/app/auth/?t={raw}"
    await bale.send_message(
        chat_id=chat_id,
        text="برای ورود به نسخهٔ وب روی دکمهٔ زیر بزن. این لینک یک‌بارمصرف است و تا چند دقیقه اعتبار دارد.",
        reply_markup=build_web_login_markup(url),
    )


async def _send_bill_prompt(bale, chat_id) -> None:
    await bale.send_message(chat_id=chat_id, text="شناسه قبض را بفرست یا عکس یا فایل PDF قبض را ارسال کن.")


async def _handle_bill_document(bale, session_factory, user_id, parsed) -> None:
    mime = (parsed.mime_type or "").lower()
    name = (parsed.file_name or "").lower()
    is_pdf = mime == "application/pdf" or name.endswith(".pdf")
    # Photos sent "as file" arrive as documents with an image mime; route them
    # through the image pipeline rather than rejecting them.
    is_image = mime.startswith("image/")
    if not (is_pdf or is_image):
        await bale.send_message(chat_id=parsed.chat_id, text="فقط می‌تونم عکس یا فایل PDF قبض را بررسی کنم.")
        return
    try:
        file_path = await bale.get_file(parsed.file_id)
        data = await bale.download_file(file_path)
        svc = build_billing_service(session_factory)
        if is_pdf:
            res = await svc.handle_input(user_id, pdf_bytes=data)
        else:
            res = await svc.handle_input(user_id, image_bytes=data)
    except Exception:
        from energybot.logging import get_logger
        get_logger(__name__).exception("document_billing_failed", chat_id=parsed.chat_id)
        await bale.send_message(chat_id=parsed.chat_id, text="نتونستم فایل را پردازش کنم. دوباره امتحان کن.")
        return
    await _send_capture(bale, parsed.chat_id, res)


def _looks_like_bill_id(text: str) -> bool:
    # True only when the message parses to a valid شناسه قبض (Iranian mod-11 checksum),
    # so normal conversation isn't mistaken for a bill lookup.
    from energybot.billing.bill_numbers import parse_bill_numbers
    try:
        parse_bill_numbers(text)
        return True
    except ValueError:
        return False


async def _process_typed_bill(bale, session_factory, user_id, chat_id, arg) -> None:
    try:
        svc = build_billing_service(session_factory)
        res = await svc.handle_input(user_id, text=arg)
    except Exception:
        from energybot.logging import get_logger
        get_logger(__name__).exception("bill_command_failed", chat_id=chat_id)
        await bale.send_message(chat_id=chat_id, text="متأسفم، در پردازش قبض مشکلی پیش اومد. بعداً دوباره امتحان کن.")
        return
    await _send_capture(bale, chat_id, res)


async def _reply_with_agent(bale, user, chat_id, text, session_factory) -> None:
    from energybot.bale_adapter.actions import build_suggestions_markup
    try:
        agent = build_agent_for_user(user.id, chat_id, session_factory)
        result = await agent.handle(text)
        reply_text = result.text
        markup = build_suggestions_markup(result.suggestions)
    except Exception:
        from energybot.logging import get_logger
        get_logger(__name__).exception("agent_call_failed", user_id=str(user.id), chat_id=chat_id)
        reply_text = "متأسفم، یه مشکل فنی پیش اومد. می‌تونی یک بار دیگه تلاش کنی؟"
        markup = None
    await bale.send_message(chat_id=chat_id, text=reply_text, reply_markup=markup)


async def _dispatch_quick_action(bale, session, session_factory, user, chat_id, key) -> None:
    from energybot.bale_adapter.actions import CATALOG
    from energybot.logging import get_logger
    action = CATALOG.get(key)
    if action is None:
        return
    if action.kind == "home":
        await _send_home(bale, chat_id)
    elif action.kind == "profile":
        await _send_profile(bale, session, session_factory, user, chat_id)
    elif action.kind == "web":
        await _send_web(bale, session, user, chat_id)
    elif action.kind == "bill":
        await _send_bill_prompt(bale, chat_id)
    elif action.kind == "prompt":
        await _reply_with_agent(bale, user, chat_id, action.prompt, session_factory)
    else:
        get_logger(__name__).warning("unknown_quick_action_kind", key=key, kind=action.kind)
