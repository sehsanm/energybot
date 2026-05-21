# Energybot — Phase 1

Persian-language energy-saving assistant on Bale messenger.

## Quickstart (local dev)

1. `docker compose up -d db`
2. `python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"`
3. Copy `.env.example` to `.env` and fill values.
4. `alembic upgrade head`
5. Seed initial admin: `python -m energybot.admin_cli create-user --email you@x.com --role admin`
6. Build admin UI: `cd admin_ui && npm install && npm run build && cd ..`
7. Run: `uvicorn energybot.main:app --reload`
8. Open `http://localhost:8000/admin/`.

## Tests

- Unit: `pytest tests/ -v -m "not llm"`
- Integration: needs `docker compose -f docker-compose.test.yml up -d`, then `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/integration -v`
- Live LLM smoke: `pytest -m llm` (requires API keys in env)

## Deploy

Single VPS: `docker compose up -d --build`. Configure a reverse proxy (Caddy or nginx) in front for TLS termination and to point `/bale/webhook/...` at port 8000.

Set the Bale webhook to `https://your-host/bale/webhook/<BALE_WEBHOOK_SECRET>` via Bale's setWebhook API.

## Architecture

See `docs/superpowers/specs/2026-05-21-energybot-phase1-design.md`.
