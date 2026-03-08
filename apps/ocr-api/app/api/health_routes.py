"""Health and monitoring routes for the OCR pipeline."""

from __future__ import annotations

import logging

import redis.asyncio as aioredis
from celery.app.control import Inspect
from fastapi import APIRouter, Depends

from app.api.security import verify_internal_api_token
from app.celery_app import celery
from app.config import settings
from app.schemas.ocr import PipelineHealthResponse

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/pipeline",
    tags=["pipeline"],
    dependencies=[Depends(verify_internal_api_token)],
)


@router.get("/health")
async def pipeline_health() -> PipelineHealthResponse:
    """Check pipeline health: Redis connectivity, worker count, queue depths."""
    redis_ok = False
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        await r.ping()
        redis_ok = True
        await r.aclose()
    except Exception:
        logger.warning("Redis health check failed")

    # Worker count
    worker_count = 0
    try:
        inspector: Inspect = celery.control.inspect()
        active = inspector.active()
        if active:
            worker_count = len(active)
    except Exception:
        logger.warning("Celery inspect failed")

    # Queue depths (best effort)
    queue_depths: dict[str, int] = {}
    try:
        r = aioredis.from_url(settings.redis_url, decode_responses=True)
        for queue_name in ["celery", "task.ocr.submit", "task.ocr.poll", "task.ocr.parse_results"]:
            depth = await r.llen(queue_name)
            queue_depths[queue_name] = depth
        await r.aclose()
    except Exception:
        pass

    status = "healthy" if redis_ok and worker_count > 0 else "degraded"

    return PipelineHealthResponse(
        status=status,
        redis_connected=redis_ok,
        celery_workers=worker_count,
        queue_depths=queue_depths,
    )
