import asyncio
from collections.abc import Callable
from typing import Any
from uuid import UUID
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

_BACKGROUND_TASKS: set = set()


def _on_suggestions_task_done(task: asyncio.Task) -> None:
    _BACKGROUND_TASKS.discard(task)
    if not task.cancelled() and task.exception() is not None:
        from energybot.logging import get_logger
        get_logger(__name__).warning("bill_suggestions_task_failed", error=str(task.exception()))


def _spawn_suggestions(user_id, chat_id: int, bill_db_id: UUID) -> None:
    from energybot.billing.suggestions import generate_and_send_suggestions
    task = asyncio.create_task(
        generate_and_send_suggestions(user_id=user_id, chat_id=chat_id, bill_db_id=bill_db_id)
    )
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_on_suggestions_task_done)


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


async def _send_capture(bale, chat_id, res, user_id, session_factory) -> None:
    if not res.ok:
        await bale.send_message(chat_id=chat_id, text=res.error)
        return
    markup = {"inline_keyboard": [[{"text": "پرداخت 💳", "callback_data": res.pay_callback}]]}
    await bale.send_message(chat_id=chat_id, text=res.summary, reply_markup=markup)
    if res.bill_db_id:
        _spawn_suggestions(user_id, chat_id, UUID(res.bill_db_id))
    await _maybe_advance_first_bill(bale, session_factory, user_id, chat_id)


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
            from energybot.onboarding import flow
            st = await flow.load_state(session, user.id)
            phase = flow.active_phase(st)
            if phase is None:
                await _send_home(bale, parsed.chat_id)
            else:
                await _resend_phase(bale, session_factory, wizard, user.id, parsed.chat_id, phase)
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
        if text == "/tools":
            await _open_toolbox_editor(bale, session_factory, user.id, parsed.chat_id)
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
            elif kind == "toolbox":
                await _open_toolbox_editor(bale, session_factory, user.id, parsed.chat_id)
            return

        if text.startswith("/bill"):
            arg = text[len("/bill"):].strip()
            if not arg:
                await _send_bill_prompt(bale, parsed.chat_id)
                return
            await _process_typed_bill(bale, session_factory, user.id, parsed.chat_id, arg)
            return

        from energybot.onboarding import flow
        st = await flow.load_state(session, user.id)
        phase = flow.active_phase(st)
        if phase == flow.PHASE_PROFILE:
            if is_wizard_answer(text):
                next_step = await wizard.answer(user.id, text)
                if next_step is None:
                    await _enter_motivations(bale, session_factory, user.id, parsed.chat_id)
                    return
                await _send_step(bale, parsed.chat_id, next_step)
                return
            else:
                await wizard.abandon(user.id)
        elif phase == flow.PHASE_MOTIVATIONS:
            if is_wizard_answer(text):
                await _enter_motivations(bale, session_factory, user.id, parsed.chat_id)
                return
            # a real question falls through to the agent; phase is retained
        elif phase == flow.PHASE_FIRST_BILL:
            if _looks_like_bill_id(text):
                pass  # falls through to the typed-bill path below, which advances via _send_capture
            elif is_wizard_answer(text):
                await _enter_first_bill(bale, session_factory, user.id, parsed.chat_id)
                return
            # a real question falls through to the agent; phase is retained
        elif phase == flow.PHASE_TOOLBOX:
            if is_wizard_answer(text):
                await _send_toolbox(bale, session_factory, user.id, parsed.chat_id, allow_skip=True)
                return
            # a real question falls through to the agent; phase is retained

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
        await _send_capture(bale, parsed.chat_id, res, user.id, session_factory)
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
        if parsed.data.startswith("ob:bill:"):
            from energybot.onboarding import content
            choice = parsed.data[len("ob:bill:"):]
            if choice == "skip":
                await _maybe_advance_first_bill(bale, session_factory, user.id, parsed.chat_id)
            elif choice == "elec":
                await bale.send_message(chat_id=parsed.chat_id, text=content.FIRST_BILL_ELEC_HELP)
            elif choice == "gas":
                await bale.send_message(chat_id=parsed.chat_id, text=content.FIRST_BILL_GAS_HELP)
            return
        if parsed.data.startswith("ms:"):
            await _handle_multiselect(bale, session, session_factory, profile_repo, user, parsed, parsed.data)
            return
        current = await wizard.current_step(user.id)
        if current is not None:
            next_step = await wizard.answer(user.id, parsed.data)
            if next_step is None:
                await _enter_motivations(bale, session_factory, user.id, parsed.chat_id)
            else:
                await _send_step(bale, parsed.chat_id, next_step)


async def _has_onboarding_state(session: AsyncSession, user_id) -> bool:
    row = (await session.execute(select(OnboardingState).where(OnboardingState.user_id == user_id))).scalar_one_or_none()
    return row is not None


async def _send_home(bale: BaleClient, chat_id: int) -> None:
    from energybot.bale_adapter.home import build_home_message
    text, markup = build_home_message()
    await bale.send_message(chat_id=chat_id, text=text, reply_markup=markup)


async def _enter_motivations(bale, session_factory, user_id, chat_id) -> None:
    from energybot.bale_adapter.multiselect import build_markup
    from energybot.onboarding import flow, content
    selected = await flow.get_draft(session_factory, user_id, "motivations")
    markup = build_markup("motivations", content.MOTIVATION_OPTIONS, selected, allow_skip=False)
    await bale.send_message(chat_id=chat_id, text=content.MOTIVATIONS_PROMPT, reply_markup=markup)


async def _enter_first_bill(bale, session_factory, user_id, chat_id) -> None:
    from energybot.onboarding import flow, content
    await flow.set_step(session_factory, user_id, flow.STEP_FIRST_BILL)
    markup = {"inline_keyboard": [
        [{"text": "قبض برق ⚡", "callback_data": "ob:bill:elec"},
         {"text": "قبض گاز 🔥", "callback_data": "ob:bill:gas"}],
        [{"text": "فعلاً نه", "callback_data": "ob:bill:skip"}],
    ]}
    await bale.send_message(chat_id=chat_id, text=content.FIRST_BILL_PROMPT, reply_markup=markup)


async def _maybe_advance_first_bill(bale, session_factory, user_id, chat_id) -> None:
    from energybot.onboarding import flow
    s = session_factory()
    st = await flow.load_state(s, user_id)
    if flow.active_phase(st) == flow.PHASE_FIRST_BILL:
        await _enter_toolbox(bale, session_factory, user_id, chat_id)


async def _send_toolbox(bale, session_factory, user_id, chat_id, *, seed=None, allow_skip: bool) -> None:
    from energybot.bale_adapter.multiselect import build_markup
    from energybot.onboarding import flow, content
    if seed is not None:
        await flow.seed_draft(session_factory, user_id, "toolbox", seed)
    selected = await flow.get_draft(session_factory, user_id, "toolbox")
    markup = build_markup("toolbox", content.TOOLBOX_OPTIONS, selected, allow_skip=allow_skip)
    await bale.send_message(chat_id=chat_id, text=content.TOOLBOX_PROMPT, reply_markup=markup)


async def _open_toolbox_editor(bale, session_factory, user_id, chat_id) -> None:
    repo = ProfileRepository(session_factory=session_factory)
    p = await repo.get(user_id)
    await _send_toolbox(bale, session_factory, user_id, chat_id, seed=list(p.service_prefs or []), allow_skip=False)


async def _enter_toolbox(bale, session_factory, user_id, chat_id) -> None:
    from energybot.onboarding import flow
    await flow.set_step(session_factory, user_id, flow.STEP_TOOLBOX)
    await _send_toolbox(bale, session_factory, user_id, chat_id, seed=[], allow_skip=True)


async def _resend_phase(bale, session_factory, wizard, user_id, chat_id, phase) -> None:
    from energybot.onboarding import flow
    if phase == flow.PHASE_PROFILE:
        step = await wizard.current_step(user_id)
        if step is not None:
            await _send_step(bale, chat_id, step)
    elif phase == flow.PHASE_MOTIVATIONS:
        await _enter_motivations(bale, session_factory, user_id, chat_id)
    elif phase == flow.PHASE_FIRST_BILL:
        await _enter_first_bill(bale, session_factory, user_id, chat_id)
    elif phase == flow.PHASE_TOOLBOX:
        await _send_toolbox(bale, session_factory, user_id, chat_id, allow_skip=True)


async def _handle_multiselect(bale, session, session_factory, profile_repo, user, parsed, data) -> None:
    from energybot.bale_adapter.multiselect import parse_ms_callback, build_markup
    from energybot.onboarding import flow, content
    got = parse_ms_callback(data)
    if got is None:
        return
    field, key = got
    options = {"motivations": content.MOTIVATION_OPTIONS, "toolbox": content.TOOLBOX_OPTIONS}.get(field)
    prompt = {"motivations": content.MOTIVATIONS_PROMPT, "toolbox": content.TOOLBOX_PROMPT}.get(field)
    if options is None:
        return
    if key == "__done__":
        selected = await flow.get_draft(session_factory, user.id, field)
        if field == "motivations":
            await profile_repo.set(user.id, "behaviour.motivations", selected, source="wizard", reason="onboarding:motivations")
            await flow.clear_draft(session_factory, user.id, field)
            await _enter_first_bill(bale, session_factory, user.id, parsed.chat_id)
        else:  # toolbox
            await profile_repo.set_service_prefs(user.id, selected, source="onboarding", reason="onboarding:toolbox")
            await flow.clear_draft(session_factory, user.id, field)
            st = await flow.load_state(session, user.id)
            if flow.active_phase(st) == flow.PHASE_TOOLBOX:
                await flow.complete(session_factory, user.id)
                await _send_home(bale, parsed.chat_id)
            else:
                await bale.send_message(chat_id=parsed.chat_id, text=content.TOOLBOX_UPDATED)
        return
    if key == "__skip__":
        if field == "toolbox":
            await flow.clear_draft(session_factory, user.id, field)
            await flow.complete(session_factory, user.id)
            await _send_home(bale, parsed.chat_id)
        return
    selected = await flow.toggle_draft(session_factory, user.id, field, key)
    st = await flow.load_state(session, user.id)
    allow_skip = field == "toolbox" and flow.active_phase(st) is not None
    markup = build_markup(field, options, selected, allow_skip=allow_skip)
    if parsed.message_id is not None:
        try:
            await bale.edit_message_reply_markup(chat_id=parsed.chat_id, message_id=parsed.message_id, reply_markup=markup)
            return
        except Exception:  # noqa: BLE001 — stale/old message: fall back to a fresh one
            pass
    await bale.send_message(chat_id=parsed.chat_id, text=prompt, reply_markup=markup)


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
    await _send_capture(bale, parsed.chat_id, res, user_id, session_factory)


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
    await _send_capture(bale, chat_id, res, user_id, session_factory)


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
    elif action.kind == "toolbox":
        await _open_toolbox_editor(bale, session_factory, user.id, chat_id)
    elif action.kind == "prompt":
        await _reply_with_agent(bale, user, chat_id, action.prompt, session_factory)
    else:
        get_logger(__name__).warning("unknown_quick_action_kind", key=key, kind=action.kind)
