"""Celery workers — auto-discovered by celery_app.autodiscover_tasks."""

from app.workers.analyze_solution import analyze_solution  # noqa: F401
from app.workers.analysis_pipeline import start_analysis_pipeline  # noqa: F401
from app.workers.auto_review import auto_review  # noqa: F401
from app.workers.crop_figures import crop_figures  # noqa: F401
from app.workers.detect_exam_pattern import detect_exam_pattern  # noqa: F401
from app.workers.find_similar import find_similar  # noqa: F401
from app.workers.finalize import finalize_pipeline  # noqa: F401
from app.workers.generate_embedding import generate_embedding  # noqa: F401
from app.workers.ocr_poll import poll_mathpix_status  # noqa: F401
from app.workers.ocr_submit import submit_pdf_to_mathpix  # noqa: F401
from app.workers.parse_results import parse_mathpix_results  # noqa: F401
from app.workers.refine_classification import refine_classification  # noqa: F401
from app.workers.segment_problems import segment_problems  # noqa: F401
from app.workers.unified_analysis import unified_analysis  # noqa: F401
