from celery import Celery

from app.config import settings

celery = Celery(
    "jsmath_ocr",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Seoul",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)

celery.conf.update(
    include=[
        "app.workers.ocr_submit",
        "app.workers.ocr_poll",
        "app.workers.parse_results",
        "app.workers.segment_problems",
        "app.workers.crop_figures",
        "app.workers.classify_problems",
        "app.workers.generate_embedding",
    ],
)
