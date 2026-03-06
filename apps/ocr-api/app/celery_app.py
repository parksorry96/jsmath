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
    worker_concurrency=settings.celery_worker_concurrency,
)

celery.conf.update(
    include=[
        "app.workers.ocr_submit",
        "app.workers.ocr_poll",
        "app.workers.parse_results",
        "app.workers.segment_problems",
        "app.workers.crop_figures",
        "app.workers.analyze_solution",
        "app.workers.refine_classification",
        "app.workers.detect_exam_pattern",
        "app.workers.generate_embedding",
        "app.workers.find_similar",
        "app.workers.auto_review",
        "app.workers.analysis_pipeline",
        "app.workers.unified_analysis",
        "app.workers.detect_sections",
        "app.workers.segment_textbook",
        "app.workers.match_answers",
        "app.workers.finalize_textbook",
    ],
)
