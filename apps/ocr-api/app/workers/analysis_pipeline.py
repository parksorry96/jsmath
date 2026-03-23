"""Analysis pipeline orchestration — maximum throughput parallel processing.

Speed optimizations:
1. Per-problem streaming pipeline (no batch gating)
   — Each problem flows GPT→rules→embed→similar→review independently
   — Fast problems don't wait for slow problems
2. Semaphore-controlled concurrency (avoid API rate limits)
3. Individual embedding (skip batching to enable pipelining)
4. Increased Celery batch size (50) to minimize task overhead
"""

from __future__ import annotations

import asyncio
import logging
import re
import unicodedata
from typing import Any

import redis
from celery import chord, group
from sqlalchemy import select

from app.celery_app import celery
from app.config import settings
from app.database import worker_session
from app.models.exam_meta import ExamQuestionMeta
from app.models.problem import AnalysisStatus, Problem
from app.services.redis_events import (
    notify_analysis_completed,
    notify_analysis_failed,
    notify_progress,
)

logger = logging.getLogger(__name__)

BATCH_SIZE = 50
TEXTBOOK_BATCH_SIZE = 50

# Max concurrent GPT calls per Celery task.
# Keep this bounded to avoid exhausting DB/OpenAI connections under worker concurrency.
MAX_CONCURRENT_GPT = 20
FALLBACK_MODEL = settings.ai_fallback_model.strip() if settings.ai_fallback_model else ""
COMMON_SUBJECTS = {"수학I", "수학II"}


def _analysis_progress_key(ocr_job_id: str) -> str:
    return f"analysis:progress:{ocr_job_id}"


def _reset_analysis_progress(ocr_job_id: str) -> None:
    client = redis.from_url(settings.redis_url, decode_responses=True)
    try:
        client.delete(_analysis_progress_key(ocr_job_id))
    finally:
        client.close()


def _increment_analysis_progress(ocr_job_id: str) -> int:
    client = redis.from_url(settings.redis_url, decode_responses=True)
    try:
        current = client.incr(_analysis_progress_key(ocr_job_id))
        client.expire(_analysis_progress_key(ocr_job_id), 3600)
        return int(current)
    finally:
        client.close()


def _normalize_answer_for_compare(answer: str | None) -> str | None:
    if not answer:
        return None

    normalized = unicodedata.normalize("NFKC", answer).strip()
    if not normalized:
        return None

    replacements = {
        "①": "1",
        "②": "2",
        "③": "3",
        "④": "4",
        "⑤": "5",
    }
    for before, after in replacements.items():
        normalized = normalized.replace(before, after)

    normalized = normalized.replace("\\left", "").replace("\\right", "")
    normalized = re.sub(r"\\(?:mathrm|text)\{([^{}]+)\}", r"\1", normalized)
    normalized = re.sub(r"\\frac\{([^{}]+)\}\{([^{}]+)\}", r"\1/\2", normalized)
    normalized = normalized.replace("$", "")
    normalized = re.sub(r"^(?:정답|답|해답)\s*[:：]?\s*", "", normalized)
    normalized = re.sub(r"\s+", "", normalized)
    match = re.fullmatch(r"\(?([1-5])\)?(?:번)?", normalized)
    if match:
        return match.group(1)
    return normalized.lower() or None


async def _get_retry_context(problem_id: str) -> dict[str, Any]:
    async with worker_session() as session:
        problem_result = await session.execute(
            select(Problem.exam_source, Problem.is_common).where(Problem.id == problem_id)
        )
        problem_row = problem_result.first()
        exam_source = problem_row[0] if problem_row else None
        stored_is_common = problem_row[1] if problem_row else None

        answers_result = await session.execute(
            select(ExamQuestionMeta.correct_answer)
            .where(ExamQuestionMeta.problem_id == problem_id)
            .where(ExamQuestionMeta.correct_answer.isnot(None))
        )
        raw_answers = [row[0] for row in answers_result.all()]

    normalized_answers = {
        normalized
        for normalized in (_normalize_answer_for_compare(answer) for answer in raw_answers)
        if normalized
    }
    return {
        "answers": normalized_answers,
        "exam_source": exam_source if isinstance(exam_source, dict) else {},
        "is_common": bool(stored_is_common) if stored_is_common is not None else None,
    }


async def _get_problem_analysis_mode(problem_id: str) -> str:
    async with worker_session() as session:
        result = await session.execute(
            select(
                Problem.book_source,
                Problem.solution_text,
                Problem.solution_latex,
            ).where(Problem.id == problem_id)
        )
        row = result.first()
    if not row:
        return "default"

    book_source, solution_text, solution_latex = row
    if book_source:
        return "textbook"
    if (
        isinstance(solution_text, str)
        and solution_text.strip()
    ) or (
        isinstance(solution_latex, str)
        and solution_latex.strip()
    ):
        return "reference_solution"
    return "default"


def _get_fallback_retry_reason(gpt_result: dict[str, Any], retry_context: dict[str, Any]) -> str | None:
    answers: set[str] = retry_context.get("answers", set())
    analysis_mode = gpt_result.get("analysis_mode")
    if analysis_mode not in {"textbook_metadata_v1", "exam_reference_metadata_v1"}:
        normalized_answer = _normalize_answer_for_compare(gpt_result.get("answer"))
        if answers and (normalized_answer is None or normalized_answer not in answers):
            return "metadata answer mismatch"

    exam_source = retry_context.get("exam_source", {})
    is_common = exam_source.get("isCommon")
    subject = gpt_result.get("subject")
    if is_common is True:
        if subject is None:
            return "common-question classification missing"
        if subject not in COMMON_SUBJECTS:
            return "common-question subject mismatch"
        if not gpt_result.get("unit_major"):
            return "common-question unit missing"

    return None

# ─── Pipeline entry point ───


def start_analysis_pipeline(
    ocr_job_id: str, problem_ids: list[str], *, is_textbook: bool = False,
) -> str:
    """Kick off AI analysis for problems in batches.

    Each batch fires concurrent per-problem pipelines with no stage gating.
    """
    batch_size = TEXTBOOK_BATCH_SIZE if is_textbook else BATCH_SIZE
    _reset_analysis_progress(ocr_job_id)
    notify_progress(
        ocr_job_id,
        "analyzing",
        current=0,
        total=len(problem_ids),
        message=f"AI 분석 시작 (0/{len(problem_ids)})",
    )
    batches = [
        problem_ids[i : i + batch_size]
        for i in range(0, len(problem_ids), batch_size)
    ]

    batch_tasks = [
        batch_analyze.s(problem_ids=batch, ocr_job_id=ocr_job_id, total=len(problem_ids))
        for batch in batches
    ]

    pipeline = chord(
        group(batch_tasks),
        finalize_analysis.s(ocr_job_id=ocr_job_id, total=len(problem_ids)),
    )
    result = pipeline.apply_async()
    logger.info(
        "Analysis pipeline started for job %s: %d problems in %d batches, task_id=%s",
        ocr_job_id, len(problem_ids), len(batches), result.id,
    )
    return result.id


# ─── Batch processing task ───


@celery.task(
    bind=True,
    name="task.analysis.batch",
    acks_late=True,
    max_retries=1,
    default_retry_delay=30,
    reject_on_worker_lost=True,
    soft_time_limit=600,
    time_limit=660,
)
def batch_analyze(
    self: Any,
    *,
    problem_ids: list[str],
    ocr_job_id: str,
    total: int,
) -> list[dict[str, Any]]:
    """Process a batch: per-problem streaming pipeline with no stage gating."""
    return asyncio.run(_process_batch(problem_ids, ocr_job_id, total))


async def _process_batch(
    problem_ids: list[str],
    ocr_job_id: str,
    total: int,
) -> list[dict[str, Any]]:
    """Stream each problem through the full pipeline independently.

    No stage gating: as soon as a problem's GPT call completes,
    it immediately flows through rules→embed→similar→review
    without waiting for other problems.
    """
    logger.info("Batch start: %d problems", len(problem_ids))

    sem = asyncio.Semaphore(MAX_CONCURRENT_GPT)
    final: list[dict[str, Any]] = []
    tasks = [
        asyncio.create_task(_process_single_safe(pid, sem))
        for pid in problem_ids
    ]
    for completed_task in asyncio.as_completed(tasks):
        result = await completed_task
        final.append(result)
        current = _increment_analysis_progress(ocr_job_id)
        notify_progress(
            ocr_job_id,
            "analyzing",
            current=current,
            total=total,
            message=f"AI 분석 진행 중 ({current}/{total})",
        )

    ok = sum(1 for r in final if r.get("decision") != "failed")
    logger.info("Batch done: %d/%d succeeded", ok, len(problem_ids))
    return final


async def _process_single(
    problem_id: str,
    sem: asyncio.Semaphore,
    *,
    model: str | None = None,
) -> dict[str, Any]:
    """Full pipeline for a single problem — no waiting on other problems.

    GPT call is semaphore-gated; downstream steps run immediately after.
    """
    from app.workers.auto_review import _review
    from app.workers.detect_exam_pattern import _apply_rules
    from app.workers.exam_reference_metadata_analysis import analyze_exam_reference_metadata
    from app.workers.find_similar import _find
    from app.workers.generate_embedding import generate_embedding_async
    from app.workers.textbook_metadata_analysis import analyze_textbook_metadata
    from app.workers.unified_analysis import analyze_problem

    analysis_mode = await _get_problem_analysis_mode(problem_id)
    if analysis_mode == "textbook":
        analyzer = analyze_textbook_metadata
    elif analysis_mode == "reference_solution":
        analyzer = analyze_exam_reference_metadata
    else:
        analyzer = analyze_problem

    # Stage 1: GPT analysis (semaphore-controlled)
    async with sem:
        gpt_result = await analyzer(problem_id, model=model)

    if not gpt_result.get("problem_id"):
        return {"problem_id": problem_id, "decision": "failed", "error": "GPT returned no result"}

    if model is None and FALLBACK_MODEL and FALLBACK_MODEL != settings.ai_model:
        retry_context = await _get_retry_context(problem_id)
        retry_reason = _get_fallback_retry_reason(gpt_result, retry_context)
        if retry_reason:
            logger.warning(
                "Retrying %s with fallback model %s due to %s",
                problem_id,
                FALLBACK_MODEL,
                retry_reason,
            )
            return await asyncio.wait_for(
                _process_single(problem_id, sem, model=FALLBACK_MODEL),
                timeout=settings.ai_fallback_timeout_sec,
            )

    # Stage 2-5: Run immediately, no waiting for other problems
    try:
        await _apply_rules(problem_id, gpt_result)
    except Exception as exc:
        logger.warning("Rules failed for %s: %s", problem_id, exc)

    try:
        await generate_embedding_async(problem_id, gpt_result)
    except Exception as exc:
        logger.warning("Embedding failed for %s: %s", problem_id, exc)

    try:
        await _find(problem_id)
    except Exception as exc:
        logger.warning("Similarity failed for %s: %s", problem_id, exc)

    try:
        review_result = await _review(problem_id)
        return review_result
    except Exception as exc:
        logger.warning("Review failed for %s: %s", problem_id, exc)
        await _mark_problem_failed(problem_id, _sanitize_error(exc))
        return {"problem_id": problem_id, "decision": "failed", "error": str(exc)}


SINGLE_PROBLEM_TIMEOUT = 120  # seconds


async def _retry_with_fallback_model(
    problem_id: str,
    sem: asyncio.Semaphore,
) -> dict[str, Any] | None:
    if not FALLBACK_MODEL or FALLBACK_MODEL == settings.ai_model:
        return None

    logger.warning(
        "Primary analysis timed out for %s; retrying with fallback model %s",
        problem_id,
        FALLBACK_MODEL,
    )
    return await asyncio.wait_for(
        _process_single(problem_id, sem, model=FALLBACK_MODEL),
        timeout=settings.ai_fallback_timeout_sec,
    )


async def _process_single_safe(
    problem_id: str,
    sem: asyncio.Semaphore,
) -> dict[str, Any]:
    try:
        result = await asyncio.wait_for(
            _process_single(problem_id, sem),
            timeout=SINGLE_PROBLEM_TIMEOUT,
        )
    except asyncio.TimeoutError:
        try:
            fallback_result = await _retry_with_fallback_model(problem_id, sem)
            if isinstance(fallback_result, dict):
                return fallback_result
        except asyncio.TimeoutError:
            error_msg = (
                f"Timed out after {SINGLE_PROBLEM_TIMEOUT}s; "
                f"fallback {FALLBACK_MODEL} also timed out after {settings.ai_fallback_timeout_sec}s"
            )
            logger.error("Pipeline timed out for %s even after fallback model", problem_id)
            await _mark_problem_failed(problem_id, error_msg)
            return {"problem_id": problem_id, "decision": "failed", "error": error_msg}
        except Exception as exc:
            safe_err = _sanitize_error(exc)
            error_msg = f"Primary timed out after {SINGLE_PROBLEM_TIMEOUT}s; fallback {FALLBACK_MODEL} failed: {safe_err}"
            logger.error("Fallback analysis failed for %s: %s", problem_id, safe_err)
            await _mark_problem_failed(problem_id, error_msg)
            return {"problem_id": problem_id, "decision": "failed", "error": error_msg}

        error_msg = f"Timed out after {SINGLE_PROBLEM_TIMEOUT}s"
        logger.error("Pipeline timed out for %s", problem_id)
        await _mark_problem_failed(problem_id, error_msg)
        return {"problem_id": problem_id, "decision": "failed", "error": error_msg}
    except Exception as exc:
        safe_err = _sanitize_error(exc)
        logger.error("Pipeline failed for %s: %s", problem_id, safe_err)
        await _mark_problem_failed(problem_id, safe_err)
        return {"problem_id": problem_id, "decision": "failed", "error": safe_err}

    if isinstance(result, dict):
        return result

    await _mark_problem_failed(problem_id, "Unknown error")
    return {"problem_id": problem_id, "decision": "failed", "error": "Unknown error"}


# ─── Helper: mark problem as failed ───


def _sanitize_error(exc: BaseException) -> str:
    """Return a safe error string without credentials or paths."""
    return f"{type(exc).__name__}: {str(exc)[:200]}"


async def _mark_problem_failed(problem_id: str, error_msg: str) -> None:
    async with worker_session() as session:
        result = await session.execute(
            select(Problem).where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if problem:
            problem.analysis_status = AnalysisStatus.failed
            # Store error in solution_tags (not common_mistakes, which is user-facing content)
            error_entry = {"_analysis_error": error_msg}
            if isinstance(problem.solution_tags, list):
                # Replace any prior error entries, keep real tags
                clean = [t for t in problem.solution_tags if not isinstance(t, dict) or "_analysis_error" not in t]
                problem.solution_tags = [error_entry] + clean
            else:
                problem.solution_tags = [error_entry]
            await session.commit()
            logger.info("Marked problem %s as failed: %s", problem_id, error_msg)


# ─── Finalize task ───


@celery.task(
    bind=True,
    name="task.analysis.finalize",
    acks_late=True,
    max_retries=1,
    default_retry_delay=10,
    reject_on_worker_lost=True,
)
def finalize_analysis(
    self: Any,
    batch_results: list[Any],
    *,
    ocr_job_id: str,
    total: int,
) -> dict[str, Any]:
    """Finalize analysis — flatten batch results, count, and notify NestJS."""
    # Idempotency: check Redis key to avoid double-finalize
    r = redis.from_url(settings.redis_url, decode_responses=True)
    finalize_key = f"analysis:finalized:{ocr_job_id}"
    try:
        if not r.set(finalize_key, "1", nx=True, ex=3600):
            logger.info("Skipping finalize_analysis for job %s — already finalized", ocr_job_id)
            return {"ocr_job_id": ocr_job_id, "skipped": True}
    finally:
        r.close()

    results: list[dict] = []
    for batch in batch_results:
        if isinstance(batch, list):
            results.extend(batch)
        elif isinstance(batch, dict):
            results.append(batch)

    auto_approved = 0
    completed = 0
    failed = 0
    problem_ids: list[str] = []
    failed_problem_ids: list[str] = []

    for result in results:
        if not isinstance(result, dict):
            failed += 1
            continue
        pid = result.get("problem_id")
        decision = result.get("decision")
        if decision == "auto_approved":
            auto_approved += 1
            completed += 1
            if pid:
                problem_ids.append(pid)
        elif decision == "pending_review":
            completed += 1
            if pid:
                problem_ids.append(pid)
        else:
            failed += 1
            if pid:
                failed_problem_ids.append(pid)

    notify_progress(ocr_job_id, "analysis_complete", current=completed, total=total, message="AI 분석 완료")

    if failed > 0 and completed == 0:
        notify_analysis_failed(ocr_job_id, f"All {failed} problems failed analysis", failed_problem_ids)
    else:
        if failed_problem_ids:
            notify_analysis_failed(ocr_job_id, f"{failed} problems failed analysis", failed_problem_ids)
        notify_analysis_completed(ocr_job_id, completed, auto_approved, problem_ids)

    logger.info(
        "Analysis finalized for job %s: %d completed, %d auto-approved, %d failed (total %d)",
        ocr_job_id, completed, auto_approved, failed, total,
    )
    return {
        "ocr_job_id": ocr_job_id,
        "completed": completed,
        "auto_approved": auto_approved,
        "failed": failed,
    }


# ─── Legacy support: merge_stage1_results ──


@celery.task(
    bind=True,
    name="task.analysis.merge_stage1",
    max_retries=2,
    default_retry_delay=5,
    acks_late=True,
)
def merge_stage1_results(
    self: Any,
    stage1_results: list[dict[str, Any]],
    *,
    problem_id: str,
) -> dict[str, Any]:
    """Merge parallel Stage 1 results and save to database (legacy mode)."""
    return asyncio.run(_merge(problem_id, stage1_results))


async def _merge(
    problem_id: str,
    results: list[dict[str, Any]],
) -> dict[str, Any]:
    merged: dict = {"problem_id": problem_id}
    for i, result in enumerate(results):
        if isinstance(result, dict):
            merged.update(result)
    merged["problem_id"] = problem_id

    async with worker_session() as session:
        query = await session.execute(
            select(Problem).where(Problem.id == problem_id)
        )
        problem = query.scalar_one_or_none()
        if not problem:
            raise ValueError(f"Problem {problem_id} not found")

        problem.analysis_status = AnalysisStatus.analyzing
        field_map = [
            "solution_tags", "solution_strategy", "required_concepts",
            "solution_steps", "estimated_time_sec", "common_mistakes",
            "classification_2015", "classification_2022",
            "subject", "unit_major", "unit_minor", "unit_sub",
            "difficulty_refined", "is_common", "classification_confidence",
            "exam_source", "position_type", "point_value", "question_format",
        ]
        for key in field_map:
            val = merged.get(key)
            if val is not None and hasattr(problem, key):
                setattr(problem, key, val)

        from app.models.curriculum_node import find_curriculum_node

        classification_2015 = merged.get("classification_2015") or problem.classification_2015
        if isinstance(classification_2015, dict):
            classification_2015 = dict(classification_2015)
            node_2015 = await find_curriculum_node(
                session,
                classification_2015.get("subject"),
                classification_2015.get("unitMajor"),
                classification_2015.get("unitMinor"),
                curriculum_year=2015,
            )
            classification_2015["curriculumNodeId"] = node_2015.id if node_2015 else None
            problem.classification_2015 = classification_2015

        classification_2022 = merged.get("classification_2022") or problem.classification_2022
        if isinstance(classification_2022, dict):
            classification_2022 = dict(classification_2022)
            node_2022 = await find_curriculum_node(
                session,
                classification_2022.get("subject"),
                classification_2022.get("unitMajor"),
                classification_2022.get("unitMinor"),
                curriculum_year=2022,
            )
            classification_2022["curriculumNodeId"] = node_2022.id if node_2022 else None
            problem.classification_2022 = classification_2022

        primary_classification = None
        primary_curriculum_year = 2015
        if isinstance(classification_2015, dict) and classification_2015.get("subject"):
            primary_classification = classification_2015
        elif isinstance(classification_2022, dict) and classification_2022.get("subject"):
            primary_classification = classification_2022
            primary_curriculum_year = 2022

        if primary_classification:
            if not problem.subject:
                problem.subject = primary_classification.get("subject")
            if not problem.unit_major:
                problem.unit_major = primary_classification.get("unitMajor")
            if not problem.unit_minor:
                problem.unit_minor = primary_classification.get("unitMinor")
            if not problem.unit_sub:
                problem.unit_sub = primary_classification.get("unitSub")
            if problem.classification_confidence is None:
                problem.classification_confidence = primary_classification.get("confidence")

        # Link to curriculum node based on classification labels
        _subject = merged.get("subject") or problem.subject
        _unit_major = merged.get("unit_major") or problem.unit_major
        _unit_minor = merged.get("unit_minor") or problem.unit_minor
        if _subject:
            curriculum_year = merged.get("primary_curriculum_year")
            if curriculum_year not in {2015, 2022}:
                if isinstance(classification_2015, dict) and classification_2015.get("subject") == _subject:
                    curriculum_year = 2015
                elif isinstance(classification_2022, dict) and classification_2022.get("subject") == _subject:
                    curriculum_year = 2022
                else:
                    curriculum_year = primary_curriculum_year
            node = await find_curriculum_node(
                session, _subject, _unit_major, _unit_minor, curriculum_year=curriculum_year,
            )
            problem.curriculum_node_id = node.id if node else None

        await session.commit()

    return merged


# ─── Legacy: on_problem_error ───


@celery.task(
    bind=True,
    name="task.analysis.on_problem_error",
    acks_late=True,
)
def on_problem_error(
    self: Any,
    failed_task_id: str,
    *,
    problem_id: str,
) -> dict[str, Any]:
    """Error callback for per-problem pipeline failures (legacy)."""
    error_msg = f"Task {failed_task_id} failed"
    logger.error("Analysis pipeline failed for problem %s: %s", problem_id, error_msg)
    try:
        asyncio.run(_mark_problem_failed_sync(problem_id, error_msg))
    except Exception:
        logger.exception("Failed to mark problem %s as failed in DB", problem_id)
    return {"problem_id": problem_id, "decision": "failed", "error": error_msg}


async def _mark_problem_failed_sync(problem_id: str, error_msg: str) -> None:
    await _mark_problem_failed(problem_id, error_msg)
