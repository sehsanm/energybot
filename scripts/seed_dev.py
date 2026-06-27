"""Seed the dev database with default prompt templates, model configs, and a Persian KB.

Usage (from repo root, after `alembic upgrade head`):

    python scripts/seed_dev.py                  # uses fake (deterministic) embeddings — no LLM provider needed
    python scripts/seed_dev.py --real-embeddings  # calls the configured embed provider (needs API key + model_config)
    python scripts/seed_dev.py --keep-drafts    # insert KB articles but leave them as draft (no chunks)
    python scripts/seed_dev.py --reset-prompts  # bump prompt versions even if already present
    python scripts/seed_dev.py --reset-models   # overwrite default model_configs

The script is idempotent: re-running won't duplicate prompts, configs, or articles. Bodies of existing
articles are *not* overwritten unless you pass --force-articles.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import math
import random
import re
import sys
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from energybot.core.db import get_sessionmaker  # noqa: E402
from energybot.core.models import (  # noqa: E402
    KBArticle,
    KBChunk,
    ModelConfig,
    PromptTemplate,
)
from energybot.core.normalize_fa import normalize_fa  # noqa: E402
from energybot.kb.chunking import chunk_text  # noqa: E402

SEED_DIR = Path(__file__).resolve().parent / "seed_data"
EMBED_DIM = 1536

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.DOTALL)


def parse_frontmatter(text: str) -> tuple[dict[str, object], str]:
    m = _FRONTMATTER_RE.match(text)
    if not m:
        raise ValueError("file is missing YAML-like front-matter delimited by '---'")
    raw_meta, body = m.group(1), m.group(2)
    meta: dict[str, object] = {}
    for line in raw_meta.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        k, v = k.strip(), v.strip()
        if v.startswith("[") and v.endswith("]"):
            inner = v[1:-1].strip()
            items = []
            if inner:
                for piece in re.split(r"\s*,\s*", inner):
                    piece = piece.strip().strip('"').strip("'")
                    if piece:
                        items.append(piece)
            meta[k] = items
        else:
            meta[k] = v.strip('"').strip("'")
    return meta, body.strip()


def deterministic_unit_vector(text: str, dim: int = EMBED_DIM) -> list[float]:
    """Reproducible pseudo-random unit vector keyed off the chunk text.

    Used in dev mode so vector search has well-defined cosine distance without calling a real provider.
    The lexical (tsvector) side of the hybrid search still surfaces meaningful matches.
    """
    seed_bytes = hashlib.sha256(text.encode("utf-8")).digest()
    seed_int = int.from_bytes(seed_bytes[:8], "big")
    rng = random.Random(seed_int)
    vec = [rng.gauss(0.0, 1.0) for _ in range(dim)]
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


# ---------- Prompts ----------

async def seed_prompts(session_maker, *, reset: bool) -> None:
    prompt_dir = SEED_DIR / "prompts"
    files = sorted(prompt_dir.glob("*.md"))
    if not files:
        print("no prompt files found; skipping prompts")
        return
    async with session_maker() as s:
        for f in files:
            meta, body = parse_frontmatter(f.read_text(encoding="utf-8"))
            key = str(meta.get("key") or f.stem)
            name = str(meta.get("name") or key)
            notes = meta.get("notes")
            existing = (await s.execute(
                select(PromptTemplate).where(PromptTemplate.key == key, PromptTemplate.status == "active")
            )).scalar_one_or_none()
            if existing and not reset:
                print(f"prompt {key!r}: active version {existing.version} already exists; skipping")
                continue
            if existing and reset:
                max_v_row = (await s.execute(
                    select(PromptTemplate).where(PromptTemplate.key == key).order_by(PromptTemplate.version.desc())
                )).scalars().first()
                next_v = (max_v_row.version + 1) if max_v_row else 1
                existing.status = "retired"
                s.add(PromptTemplate(
                    key=key, name=name, body=body, version=next_v, status="active",
                    notes=str(notes) if notes else None,
                ))
                print(f"prompt {key!r}: retired v{existing.version}, inserted v{next_v}")
            else:
                s.add(PromptTemplate(
                    key=key, name=name, body=body, version=1, status="active",
                    notes=str(notes) if notes else None,
                ))
                print(f"prompt {key!r}: inserted v1")
        await s.commit()


# ---------- Model configs ----------

# Multi-vendor defaults: DeepSeek for the main reasoning loop (cheap, capable, OpenAI-compatible),
# Metis for summarization (different vendor = resilience) and embeddings (DeepSeek does not ship them).
# Each row's `provider` value must match a key in providers/factory.py build_providers().
DEFAULT_MODEL_CONFIGS: list[dict] = [
    {
        "call_type": "chat_reasoning",
        "provider": "deepseek",
        "model_name": "deepseek-v4-flash",
        "params": {"temperature": 0.3, "fallback": {"provider": "metis", "model_name": "gpt-4o-mini"}},
        "is_active": True,
    },
    {
        "call_type": "summarize",
        "provider": "metis",
        "model_name": "gpt-4o-mini",
        "params": {"temperature": 0.2},
        "is_active": True,
    },
    {
        "call_type": "embed",
        "provider": "metis",
        "model_name": "text-embedding-3-small",
        "params": {"dimensions": EMBED_DIM},
        "is_active": True,
    },
    {
        "call_type": "bill_suggestions",
        "provider": "deepseek",
        "model_name": "deepseek-v4-flash",
        "params": {"temperature": 0.4, "fallback": {"provider": "metis", "model_name": "gpt-4o-mini"}},
        "is_active": True,
    },
]


async def seed_model_configs(session_maker, *, reset: bool) -> None:
    async with session_maker() as s:
        for cfg in DEFAULT_MODEL_CONFIGS:
            existing = (await s.execute(
                select(ModelConfig).where(
                    ModelConfig.call_type == cfg["call_type"],
                    ModelConfig.is_active.is_(True),
                )
            )).scalar_one_or_none()
            if existing and not reset:
                print(
                    f"model_config {cfg['call_type']!r}: active row already exists "
                    f"({existing.provider}/{existing.model_name}); skipping"
                )
                continue
            if existing and reset:
                existing.is_active = False
            s.add(ModelConfig(**cfg))
            print(f"model_config {cfg['call_type']!r}: inserted {cfg['provider']}/{cfg['model_name']}")
        await s.commit()


# ---------- Knowledge base ----------

async def seed_kb(
    session_maker,
    *,
    keep_drafts: bool,
    real_embeddings: bool,
    force_articles: bool,
) -> None:
    kb_root = SEED_DIR / "kb"
    files = sorted(kb_root.rglob("*.md"))
    if not files:
        print("no KB files found; skipping KB")
        return

    embed_fn = None
    if real_embeddings:
        embed_fn = await _make_real_embed_fn(session_maker)

    async with session_maker() as s:
        for f in files:
            meta, body = parse_frontmatter(f.read_text(encoding="utf-8"))
            title = str(meta.get("title") or f.stem)
            category = str(meta.get("category") or "general").lower()
            tags = list(meta.get("tags") or [])

            existing = (await s.execute(select(KBArticle).where(KBArticle.title == title))).scalar_one_or_none()
            if existing and not force_articles:
                print(f"kb {title!r}: already present; skipping (use --force-articles to overwrite body)")
                continue
            if existing and force_articles:
                existing.body = body
                existing.category = category
                existing.tags = tags
                existing.version = existing.version + 1
                article = existing
                # wipe stale chunks if we'll re-publish
                await s.execute(KBChunk.__table__.delete().where(KBChunk.article_id == article.id))
                print(f"kb {title!r}: updated body, version bumped to {article.version}")
            else:
                article = KBArticle(
                    title=title, body=body, category=category, tags=tags,
                    status="draft", version=1,
                )
                s.add(article)
                await s.flush()
                print(f"kb {title!r}: inserted as draft")

            if keep_drafts:
                continue

            chunks = chunk_text(body)
            if not chunks:
                print(f"kb {title!r}: empty body, leaving as draft")
                continue

            normalized = [normalize_fa(c) for c in chunks]
            if real_embeddings:
                assert embed_fn is not None
                vectors = await embed_fn(normalized)
            else:
                vectors = [deterministic_unit_vector(t) for t in normalized]

            for idx, (raw, norm, vec) in enumerate(zip(chunks, normalized, vectors)):
                s.add(KBChunk(
                    article_id=article.id,
                    chunk_index=idx,
                    text=raw,
                    text_normalized=norm,
                    embedding=vec,
                    meta={
                        "article_title": title,
                        "category": category,
                        "tags": tags,
                        "source": "article",
                        "seed": True,
                        "embedding_mode": "real" if real_embeddings else "fake-deterministic",
                    },
                ))
            article.status = "published"
            from datetime import datetime
            article.published_at = datetime.utcnow()
            print(f"kb {title!r}: published with {len(chunks)} chunk(s)")
        try:
            await s.commit()
        except IntegrityError as e:
            await s.rollback()
            print(f"commit failed: {e}", file=sys.stderr)
            raise


async def _make_real_embed_fn(session_maker):
    """Build a callable(list[str]) -> list[list[float]] using the configured router.

    Imported lazily so the script can run without provider keys when --real-embeddings is not set.
    """
    from energybot.providers.factory import build_providers
    from energybot.providers.router import ProviderRouter
    from energybot.settings import get_settings
    from energybot.kb.embedding import EmbeddingService

    s = get_settings()
    router = ProviderRouter(providers=build_providers(s), session_factory=session_maker)
    embed = EmbeddingService(router=router)
    return embed.embed_all


# ---------- Main ----------

async def main() -> None:
    parser = argparse.ArgumentParser(description="Seed energybot dev DB with prompts, model configs, and KB.")
    parser.add_argument("--reset-prompts", action="store_true", help="bump prompt versions even if already present")
    parser.add_argument("--reset-models", action="store_true", help="overwrite default model_configs")
    parser.add_argument("--real-embeddings", action="store_true", help="call configured embed provider (requires keys)")
    parser.add_argument("--keep-drafts", action="store_true", help="insert KB articles but leave them as draft")
    parser.add_argument("--force-articles", action="store_true", help="overwrite existing KB article bodies and re-chunk")
    parser.add_argument("--skip", choices=["prompts", "models", "kb"], action="append", default=[],
                        help="skip a section (repeatable)")
    args = parser.parse_args()

    session_maker = get_sessionmaker()

    if "prompts" not in args.skip:
        print("== prompts ==")
        await seed_prompts(session_maker, reset=args.reset_prompts)
    if "models" not in args.skip:
        print("== model_configs ==")
        await seed_model_configs(session_maker, reset=args.reset_models)
    if "kb" not in args.skip:
        print("== knowledge base ==")
        await seed_kb(
            session_maker,
            keep_drafts=args.keep_drafts,
            real_embeddings=args.real_embeddings,
            force_articles=args.force_articles,
        )

    print("done.")


if __name__ == "__main__":
    asyncio.run(main())
