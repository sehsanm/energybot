import time
from collections.abc import Callable
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import LLMCall, ModelConfig
from energybot.providers.base import ChatRequest, ChatResponse, EmbeddingRequest, EmbeddingResponse, Provider, ProviderError


class ProviderRouter:
    def __init__(self, providers: dict[str, Provider], session_factory: Callable[[], AsyncSession]):
        self._providers = providers
        self._session_factory = session_factory

    async def _active_config(self, session: AsyncSession, call_type: str) -> ModelConfig:
        row = (await session.execute(
            select(ModelConfig).where(ModelConfig.call_type == call_type, ModelConfig.is_active.is_(True))
        )).scalar_one_or_none()
        if row is None:
            raise ProviderError(f"no active model_config for call_type={call_type}", retryable=False)
        return row

    async def chat(self, *, call_type: str, req: ChatRequest, prompt_key: str | None = None, prompt_version: int | None = None) -> ChatResponse:
        session = self._session_factory()
        cfg = await self._active_config(session, call_type)
        req.model = cfg.model_name
        primary = self._providers[cfg.provider]
        t0 = time.perf_counter()
        try:
            resp = await primary.chat(req)
            await self._log(session, call_type, cfg.provider, cfg.model_name, resp.tokens_in, resp.tokens_out,
                            int((time.perf_counter() - t0) * 1000), "ok", prompt_key, prompt_version)
            return resp
        except ProviderError as primary_err:
            await self._log(session, call_type, cfg.provider, cfg.model_name, 0, 0,
                            int((time.perf_counter() - t0) * 1000), "error", prompt_key, prompt_version)
            fb = cfg.params.get("fallback") if cfg.params else None
            if not fb or not primary_err.retryable:
                raise
            req.model = fb["model_name"]
            t1 = time.perf_counter()
            try:
                resp = await self._providers[fb["provider"]].chat(req)
                await self._log(session, call_type, fb["provider"], fb["model_name"], resp.tokens_in, resp.tokens_out,
                                int((time.perf_counter() - t1) * 1000), "fallback", prompt_key, prompt_version)
                return resp
            except ProviderError:
                raise

    async def embed(self, *, call_type: str, req: EmbeddingRequest) -> EmbeddingResponse:
        session = self._session_factory()
        cfg = await self._active_config(session, call_type)
        req.model = cfg.model_name
        primary = self._providers[cfg.provider]
        t0 = time.perf_counter()
        try:
            resp = await primary.embed(req)
            await self._log(session, call_type, cfg.provider, cfg.model_name, resp.tokens_in, 0,
                            int((time.perf_counter() - t0) * 1000), "ok", None, None)
            return resp
        except ProviderError as primary_err:
            await self._log(session, call_type, cfg.provider, cfg.model_name, 0, 0,
                            int((time.perf_counter() - t0) * 1000), "error", None, None)
            fb = cfg.params.get("fallback") if cfg.params else None
            if not fb or not primary_err.retryable:
                raise
            req.model = fb["model_name"]
            t1 = time.perf_counter()
            resp = await self._providers[fb["provider"]].embed(req)
            await self._log(session, call_type, fb["provider"], fb["model_name"], resp.tokens_in, 0,
                            int((time.perf_counter() - t1) * 1000), "fallback", None, None)
            return resp

    async def _log(self, session, call_type, provider, model, tin, tout, latency, status, pkey, pver) -> None:
        session.add(LLMCall(
            call_type=call_type, provider=provider, model=model,
            tokens_in=tin, tokens_out=tout, latency_ms=latency, status=status,
            prompt_template_key=pkey, prompt_template_version=pver,
        ))
        await session.commit()
