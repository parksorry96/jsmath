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

from celery import chord, group
from sqlalchemy import select

from app.celery_app import celery
from app.database import worker_session
from app.models.problem import AnalysisStatus, Problem
from app.services.redis_events import notify_analysis_completed, notify_analysis_failed, notify_progress

logger = logging.getLogger(__name__)

BATCH_SIZE = 50
TEXTBOOK_BATCH_SIZE = 50

# Max concurrent GPT calls per Celery task
# High value to maximize parallelism — OpenAI handles rate limiting server-side
MAX_CONCURRENT_GPT = 100

# ─── Pipeline entry point ───


def start_analysis_pipeline(
    ocr_job_id: str, problem_ids: list[str], *, is_textbook: bool = False,
) -> str:
    """Kick off AI analysis for problems in batches.

    Each batch fires concurrent per-problem pipelines with no stage gating.
    """
    batch_size = TEXTBOOK_BATCH_SIZE if is_textbook else BATCH_SIZE
    batches = [
        problem_ids[i : i + batch_size]
        for i in range(0, len(problem_ids), batch_size)
    ]

    batch_tasks = [
        batch_analyze.s(problem_ids=batch) for batch in batches
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
    soft_time_limit=600,
    time_limit=660,
)
def batch_analyze(self, *, problem_ids: list[str]) -> list[dict]:
    """Process a batch: per-problem streaming pipeline with no stage gating."""
    return asyncio.run(_process_batch(problem_ids))


async def _process_batch(problem_ids: list[str]) -> list[dict]:
    """Stream each problem through the full pipeline independently.

    No stage gating: as soon as a problem's GPT call completes,
    it immediately flows through rules→embed→similar→review
    without waiting for other problems.
    """
    logger.info("Batch start: %d problems", len(problem_ids))

    sem = asyncio.Semaphore(MAX_CONCURRENT_GPT)
    results = await asyncio.gather(
        *[_process_single(pid, sem) for pid in problem_ids],
        return_exceptions=True,
    )

    final: list[dict] = []
    for pid, result in zip(problem_ids, results):
        if isinstance(result, Exception):
            logger.error("Pipeline failed for %s: %s", pid, result)
            await _mark_problem_failed(pid, str(result))
            final.append({"problem_id": pid, "decision": "failed", "error": str(result)})
        elif isinstance(result, dict):
            final.append(result)
        else:
            final.append({"problem_id": pid, "decision": "failed", "error": "Unknown error"})

    ok = sum(1 for r in final if r.get("decision") != "failed")
    logger.info("Batch done: %d/%d succeeded", ok, len(problem_ids))
    return final


async def _process_single(problem_id: str, sem: asyncio.Semaphore) -> dict:
    """Full pipeline for a single problem — no waiting on other problems.

    GPT call is semaphore-gated; downstream steps run immediately after.
    """
    from app.workers.detect_exam_pattern import _apply_rules
    from app.workers.generate_embedding import generate_embedding_async
    from app.workers.find_similar import _find
    from app.workers.auto_review import _review
    from app.workers.unified_analysis import analyze_problem

    # Stage 1: GPT analysis (semaphore-controlled)
    async with sem:
        gpt_result = await analyze_problem(problem_id)

    if not gpt_result.get("problem_id"):
        return {"problem_id": problem_id, "decision": "failed", "error": "GPT returned no result"}

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
        return {"problem_id": problem_id, "decision": "failed", "error": str(exc)}


# ─── Helper: mark problem as failed ───


async def _mark_problem_failed(problem_id: str, error_msg: str) -> None:
    async with worker_session() as session:
        result = await session.execute(
            select(Problem).where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if problem:
            problem.analysis_status = AnalysisStatus.failed
            error_entry = {"_error": error_msg}
            if isinstance(problem.common_mistakes, list):
                problem.common_mistakes = [error_entry] + problem.common_mistakes
            else:
                problem.common_mistakes = [error_entry]
            await session.commit()
            logger.info("Marked problem %s as failed: %s", problem_id, error_msg)


# ─── Finalize task ───


@celery.task(
    bind=True,
    name="task.analysis.finalize",
    acks_late=True,
)
def finalize_analysis(self, batch_results: list, *, ocr_job_id: str, total: int) -> dict:
    """Finalize analysis — flatten batch results, count, and notify NestJS."""
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

    notify_progress(ocr_job_id, "analysis_complete", current=completed, total=total, message="AI 분석 완료")

    if failed > 0 and completed == 0:
        notify_analysis_failed(ocr_job_id, f"All {failed} problems failed analysis")
    else:
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
def merge_stage1_results(self, stage1_results: list[dict], *, problem_id: str) -> dict:
    """Merge parallel Stage 1 results and save to database (legacy mode)."""
    return asyncio.run(_merge(problem_id, stage1_results))


async def _merge(problem_id: str, results: list[dict]) -> dict:
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
            "subject", "unit_major", "unit_minor", "unit_sub",
            "difficulty_refined", "is_common", "classification_confidence",
            "exam_source", "position_type", "point_value", "question_format",
        ]
        for key in field_map:
            val = merged.get(key)
            if val is not None and hasattr(problem, key):
                setattr(problem, key, val)

        # Link to curriculum node based on classification labels
        _subject = merged.get("subject") or problem.subject
        _unit_major = merged.get("unit_major") or problem.unit_major
        _unit_minor = merged.get("unit_minor") or problem.unit_minor
        if _subject:
            from app.models.curriculum_node import find_curriculum_node

            node = await find_curriculum_node(
                session, _subject, _unit_major, _unit_minor,
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
def on_problem_error(self, failed_task_id, *, problem_id: str) -> dict:
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
