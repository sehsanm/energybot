import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
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
from energybot.logging import configure_logging, get_logger
from energybot.jobs.scheduler import make_scheduler
from energybot.metrics import router as metrics_router
from energybot.settings import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    log = get_logger(__name__)
    s = get_settings()
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
    app.include_router(metrics_router)
    static_dir = os.environ.get("ENERGYBOT_ADMIN_STATIC_DIR", "admin_ui/out")
    if os.path.isdir(static_dir):
        app.mount("/admin", StaticFiles(directory=static_dir, html=True), name="admin")
    return app


app = create_app()
