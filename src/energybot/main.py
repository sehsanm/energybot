import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.responses import RedirectResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import Scope
from energybot.health import router as health_router
from energybot.bale_adapter.poller import BalePoller
from energybot.bale_adapter.webhook import router as bale_router
from energybot.admin_api.auth import router as admin_auth_router
from energybot.admin_api.users import router as admin_users_router
from energybot.admin_api.chats import router as admin_chats_router
from energybot.admin_api.kb import router as admin_kb_router
from energybot.admin_api.prompts import router as admin_prompts_router
from energybot.admin_api.models import router as admin_models_router
from energybot.admin_api.audit_log import router as admin_audit_router
from energybot.admin_api.stats import router as admin_stats_router
from energybot.admin_api.bills import router as admin_bills_router
from energybot.user_api.auth import router as user_auth_router
from energybot.user_api.chat import router as user_chat_router
from energybot.user_api.bills import router as user_bills_router
from energybot.user_api.profile import router as user_profile_router
from energybot.user_api.dashboard import router as user_dashboard_router
from energybot.user_api.memory import router as user_memory_router
from energybot.logging import configure_logging, get_logger
from energybot.jobs.scheduler import make_scheduler
from energybot.metrics import router as metrics_router
from energybot.billing.callback import router as pay_router
from energybot.settings import get_settings


class _AdminSpaStatic(StaticFiles):
    # Next.js static export prerenders dynamic routes as `<segment>/_/index.html`.
    # Rewrite direct hits on real ids to the placeholder so the client router can hydrate.
    _SPA_PREFIXES: tuple[tuple[tuple[str, ...], str], ...] = (
        (("kb", "articles"), "kb/articles/_/index.html"),
        (("users",), "users/_/index.html"),
        (("chats",), "chats/_/index.html"),
    )
    _RESERVED_SEGMENTS = {"_", "new"}

    async def get_response(self, path: str, scope: Scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            response = None
        if response is not None and response.status_code != 404:
            return response
        parts = [p for p in path.split("/") if p]
        for prefix, placeholder in self._SPA_PREFIXES:
            n = len(prefix)
            if len(parts) == n + 1 and tuple(parts[:n]) == prefix and parts[n] not in self._RESERVED_SEGMENTS:
                return await super().get_response(placeholder, scope)
        if response is not None:
            return response
        raise StarletteHTTPException(status_code=404)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log = get_logger(__name__)
    s = get_settings()
    if s.bale_bot_token:
        from energybot.bale_adapter.handler import get_bale_client
        from energybot.bale_adapter.commands import BOT_COMMAND_MENU
        await get_bale_client().set_my_commands(BOT_COMMAND_MENU)
    sched = make_scheduler()
    sched.start()
    poller: BalePoller | None = None
    poller_task: asyncio.Task | None = None
    if s.bale_mode == "polling":
        poller = BalePoller(
            token=s.bale_bot_token,
            base_url=s.bale_api_base,
            poll_timeout=s.bale_poll_timeout,
        )
        poller_task = asyncio.create_task(poller.run())
        log.info("bale_mode_polling")
    else:
        log.info("bale_mode_webhook")
    try:
        yield
    finally:
        if poller is not None:
            poller.stop()
        if poller_task is not None:
            try:
                await asyncio.wait_for(poller_task, timeout=5.0)
            except asyncio.TimeoutError:
                poller_task.cancel()
        if poller is not None:
            await poller.aclose()
        sched.shutdown(wait=False)


def create_app() -> FastAPI:
    configure_logging("INFO")
    app = FastAPI(title="Energybot", lifespan=lifespan)
    app.include_router(health_router)
    app.include_router(bale_router)
    app.include_router(admin_auth_router)
    app.include_router(admin_users_router)
    app.include_router(admin_chats_router)
    app.include_router(admin_kb_router)
    app.include_router(admin_prompts_router)
    app.include_router(admin_models_router)
    app.include_router(admin_audit_router)
    app.include_router(admin_stats_router)
    app.include_router(admin_bills_router)
    app.include_router(user_auth_router)
    app.include_router(user_chat_router)
    app.include_router(user_bills_router)
    app.include_router(user_profile_router)
    app.include_router(user_dashboard_router)
    app.include_router(user_memory_router)
    app.include_router(metrics_router)
    app.include_router(pay_router)
    # StaticFiles redirects missing trailing slashes on sub-paths but not on the
    # bare mount root, so `/app` would 404 while `/app/` works. Add explicit
    # canonical redirects (registered before the mount so they match first).
    def _slash_redirect(target: str):
        async def _r(_request):
            return RedirectResponse(url=target, status_code=308)
        return _r

    static_dir = os.environ.get("ENERGYBOT_ADMIN_STATIC_DIR", "admin_ui/out")
    if os.path.isdir(static_dir):
        app.add_route("/admin", _slash_redirect("/admin/"))
        app.mount("/admin", _AdminSpaStatic(directory=static_dir, html=True), name="admin")
    app_dir = os.environ.get("ENERGYBOT_APP_STATIC_DIR", "app_ui/out")
    if os.path.isdir(app_dir):
        app.add_route("/app", _slash_redirect("/app/"))
        app.mount("/app", StaticFiles(directory=app_dir, html=True), name="app")
    landing_dir = os.environ.get("ENERGYBOT_LANDING_STATIC_DIR", "landing_ui/out")
    if os.path.isdir(landing_dir):
        app.mount("/", StaticFiles(directory=landing_dir, html=True), name="landing")
    return app


app = create_app()
