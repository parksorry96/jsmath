"""Shared OpenAI client factory for all workers."""

from openai import AsyncOpenAI

from app.config import settings


def get_openai_client() -> AsyncOpenAI:
    """Create an AsyncOpenAI client from settings."""
    kwargs: dict = {"api_key": settings.ai_api_key}
    if settings.ai_api_base_url:
        kwargs["base_url"] = settings.ai_api_base_url
    return AsyncOpenAI(**kwargs)
