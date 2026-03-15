import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.health_routes import router as health_router
from app.api.ocr_routes import router as ocr_router
from app.config import settings
from app.services.event_listener import listen_for_events, listen_for_events_stream

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    """Start Redis event listeners on startup, clean up on shutdown."""
    pubsub_task = asyncio.create_task(listen_for_events())
    stream_task = asyncio.create_task(listen_for_events_stream())
    logger.info("OCR event listeners started (Pub/Sub + Streams)")
    yield
    pubsub_task.cancel()
    stream_task.cancel()
    for task in (pubsub_task, stream_task):
        try:
            await task
        except asyncio.CancelledError:
            pass


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
app.include_router(health_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "ocr-api"}
