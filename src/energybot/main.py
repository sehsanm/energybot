from fastapi import FastAPI
from energybot.health import router as health_router
from energybot.logging import configure_logging


def create_app() -> FastAPI:
    configure_logging("INFO")
    app = FastAPI(title="Energybot")
    app.include_router(health_router)
    return app


app = create_app()
