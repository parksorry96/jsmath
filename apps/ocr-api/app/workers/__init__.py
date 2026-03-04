"""Celery workers — auto-discovered by celery_app.autodiscover_tasks."""

from app.workers.auto_review import auto_review  # noqa: F401
from app.workers.crop_figures import crop_figures  # noqa: F401
from app.workers.finalize import finalize_pipeline  # noqa: F401
from app.workers.ocr_poll import poll_mathpix_status  # noqa: F401
from app.workers.ocr_submit import submit_pdf_to_mathpix  # noqa: F401
from app.workers.parse_results import parse_mathpix_results  # noqa: F401
from app.workers.segment_problems import segment_problems  # noqa: F401
