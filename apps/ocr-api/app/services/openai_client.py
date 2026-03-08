"""Shared OpenAI client factory for all workers.

Uses a module-level singleton to reuse TCP connections across calls.
"""

from openai import AsyncOpenAI

from app.config import settings

_client: AsyncOpenAI | None = None


def get_openai_client() -> AsyncOpenAI:
    """Return a shared AsyncOpenAI client (singleton for connection reuse)."""
    global _client
    if _client is None:
        kwargs: dict = {"api_key": settings.ai_api_key}
        if settings.ai_api_base_url:
            kwargs["base_url"] = settings.ai_api_base_url
        _client = AsyncOpenAI(**kwargs)
    return _client
