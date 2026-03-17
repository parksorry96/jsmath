import asyncio
import logging
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI

from app.api.health_routes import router as health_router
from app.api.ocr_routes import router as ocr_router
from app.api.single_ocr_routes import router as single_ocr_router
from app.config import settings
from app.services.event_listener import listen_for_events, listen_for_events_stream

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    """Start Redis event listeners on startup, clean up on shutdown."""
    app.state.redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    pubsub_task = (
        asyncio.create_task(listen_for_events())
        if settings.enable_legacy_pubsub
        else None
    )
    stream_task = asyncio.create_task(listen_for_events_stream())
    logger.info(
        "OCR event listeners started (%s + Streams)",
        "Pub/Sub" if pubsub_task else "no Pub/Sub",
    )
    yield
    if pubsub_task:
        pubsub_task.cancel()
    stream_task.cancel()
    for task in (pubsub_task, stream_task):
        if task is None:
            continue
        try:
            await task
        except asyncio.CancelledError:
            pass
    await app.state.redis.aclose()


app = FastAPI(
    title="JSMath OCR/AI Pipeline",
    version="0.0.1",
    docs_url="/docs" if settings.enable_api_docs else None,
    redoc_url="/redoc" if settings.enable_api_docs else None,
    openapi_url="/openapi.json" if settings.enable_api_docs else None,
    root_path="/v1",
    lifespan=lifespan,
)

app.include_router(ocr_router)
app.include_router(single_ocr_router)
app.include_router(health_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ocr-api"}
