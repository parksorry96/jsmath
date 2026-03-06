"""Analysis pipeline orchestration — batch processing with batched GPT calls.

Groups problems into batches of BATCH_SIZE (default 5, textbook 10),
sends each batch as a single GPT call, then runs downstream steps
(rules, embedding, similarity, auto-review) for each successful result.
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

BATCH_SIZE = 10
TEXTBOOK_BATCH_SIZE = 10

# ─── Pipeline entry point ───


def start_analysis_pipeline(
    ocr_job_id: str, problem_ids: list[str], *, is_textbook: bool = False,
) -> str:
    """Kick off AI analysis for problems in batches.

    Each batch fires concurrent GPT calls, then processes
    downstream steps (rules, embedding, similarity, auto-review).
    Uses larger batch size for textbooks (simpler problems).
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
    """Process a batch of problems: batch GPT → rules → embedding → similar → review."""
    return asyncio.run(_process_batch(problem_ids))


async def _process_batch(problem_ids: list[str]) -> list[dict]:
    """Full pipeline for a batch. Single GPT call for all problems."""
    from app.workers.detect_exam_pattern import _apply_rules
    from app.workers.generate_embedding import generate_embedding_async
    from app.workers.find_similar import _find
    from app.workers.auto_review import _review
    from app.workers.unified_analysis import analyze_problems_batch

    logger.info("Batch start: %d problems %s", len(problem_ids), problem_ids)

    # ── Stage 1: Batch GPT analysis (single API call for all problems) ──
    succeeded: list[tuple[str, dict]] = []
    failed_results: list[dict] = []

    try:
        batch_results = await analyze_problems_batch(problem_ids)
        result_map = {r["problem_id"]: r for r in batch_results}
        for pid in problem_ids:
            if pid in result_map:
                succeeded.append((pid, result_map[pid]))
            else:
                logger.error("Problem %s missing from batch GPT result", pid)
                await _mark_problem_failed(pid, "Missing from batch GPT result")
                failed_results.append({"problem_id": pid, "decision": "failed", "error": "Missing from batch result"})
    except Exception as exc:
        logger.error("Batch GPT analysis failed for %d problems: %s", len(problem_ids), exc)
        for pid in problem_ids:
            await _mark_problem_failed(pid, str(exc))
            failed_results.append({"problem_id": pid, "decision": "failed", "error": str(exc)})
        return failed_results

    if not succeeded:
        return failed_results

    # ── Stage 2: Apply deterministic rules + save to DB (concurrent, fast) ──
    await asyncio.gather(
        *[_apply_rules(pid, result) for pid, result in succeeded],
        return_exceptions=True,
    )

    # ── Stage 3: Generate embeddings (concurrent API calls) ──
    await asyncio.gather(
        *[generate_embedding_async(pid, result) for pid, result in succeeded],
        return_exceptions=True,
    )

    # ── Stage 4: Find similar problems (concurrent pgvector queries) ──
    await asyncio.gather(
        *[_find(pid) for pid, _ in succeeded],
        return_exceptions=True,
    )

    # ── Stage 5: Auto review (concurrent, fast) ──
    review_results = await asyncio.gather(
        *[_review(pid) for pid, _ in succeeded],
        return_exceptions=True,
    )

    final_results = list(failed_results)
    for (pid, _), review in zip(succeeded, review_results):
        if isinstance(review, dict):
            final_results.append(review)
        else:
            logger.error("Review failed for %s: %s", pid, review)
            final_results.append({"problem_id": pid, "decision": "failed", "error": str(review)})

    ok = sum(1 for r in final_results if r.get("decision") != "failed")
    logger.info("Batch done: %d/%d succeeded", ok, len(problem_ids))
    return final_results


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
    # Flatten: batch_results is list[list[dict]]
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


# ─── Legacy support: merge_stage1_results (kept for backwards compatibility) ──


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
            "solution_strategy", "required_concepts", "solution_steps",
            "estimated_time_sec", "common_mistakes", "subject", "unit_major",
            "unit_minor", "unit_sub", "difficulty_refined", "is_common",
            "classification_confidence", "exam_source", "position_type",
            "point_value", "question_format",
        ]
        for key in field_map:
            val = merged.get(key)
            if val is not None and hasattr(problem, key):
                setattr(problem, key, val)
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
