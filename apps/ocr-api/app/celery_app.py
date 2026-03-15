import logging

from celery import Celery
from celery.signals import task_failure

from app.config import settings

logger = logging.getLogger(__name__)

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
    worker_prefetch_multiplier=4,
    worker_concurrency=settings.celery_worker_concurrency,
)

@task_failure.connect
def on_task_failure(sender=None, task_id=None, exception=None, args=None, kwargs=None, traceback=None, einfo=None, **kw):
    """Record failed tasks to DLQ when all retries are exhausted."""
    max_retries = getattr(sender, "max_retries", 0) or 0
    retries = getattr(sender.request, "retries", 0) if sender and hasattr(sender, "request") else 0
    if retries < max_retries:
        return  # still has retries left

    from app.services.dlq_handler import record_dead_letter

    tb_str = str(einfo) if einfo else None
    record_dead_letter(
        task_id=task_id or "unknown",
        task_name=sender.name if sender else "unknown",
        args=args,
        kwargs=kwargs,
        exception=str(exception),
        traceback_str=tb_str,
    )


celery.conf.update(
    include=[
        "app.workers.pipeline",
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
        "app.workers.analyze_photo",
        "app.workers.rubric_grader",
    ],
)
