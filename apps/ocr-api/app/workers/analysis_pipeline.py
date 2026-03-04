"""Analysis pipeline orchestration — chains AI analysis tasks.

Unified mode (default): single GPT call per problem via unified_analysis
Legacy mode: parallel chord of 3 separate GPT calls → merge → Stage 2
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from celery import chain, chord, group
from sqlalchemy import select

from app.celery_app import celery
from app.config import settings
from app.database import worker_session
from app.models.problem import AnalysisStatus, Problem
from app.services.redis_events import notify_analysis_completed, notify_analysis_failed, notify_progress
from app.workers.auto_review import auto_review
from app.workers.detect_exam_pattern import apply_deterministic_rules
from app.workers.find_similar import find_similar
from app.workers.generate_embedding import generate_embedding

logger = logging.getLogger(__name__)


def start_analysis_pipeline(ocr_job_id: str, problem_ids: list[str]) -> str:
    """Kick off AI analysis for a batch of problems.

    Unified mode (default): single GPT call per problem
    Legacy mode: parallel chord of 3 separate GPT calls
    """
    workflows = []
    for pid in problem_ids:
        if settings.use_unified_analysis:
            from app.workers.unified_analysis import unified_analysis
            stage1 = unified_analysis.s(problem_id=pid)
        else:
            from app.workers.analyze_solution import analyze_solution
            from app.workers.detect_exam_pattern import detect_exam_pattern
            from app.workers.refine_classification import refine_classification
            stage1 = chord(
                group(
                    analyze_solution.s(problem_id=pid),
                    refine_classification.s(problem_id=pid),
                    detect_exam_pattern.s(problem_id=pid),
                ),
                merge_stage1_results.s(problem_id=pid),
            )

        stage2 = chain(
            apply_deterministic_rules.s(problem_id=pid),
            generate_embedding.s(problem_id=pid),
            find_similar.s(problem_id=pid),
            auto_review.s(problem_id=pid),
        )
        per_problem = chain(stage1, stage2)
        per_problem.on_error(on_problem_error.s(problem_id=pid))
        workflows.append(per_problem)

    batch = chord(
        group(workflows),
        finalize_analysis.s(ocr_job_id=ocr_job_id, total=len(problem_ids)),
    )
    result = batch.apply_async()
    mode = "unified" if settings.use_unified_analysis else "legacy"
    logger.info(
        "Analysis pipeline (%s) started for job %s: %d problems, task_id=%s",
        mode, ocr_job_id, len(problem_ids), result.id,
    )
    return result.id


@celery.task(
    bind=True,
    name="task.analysis.on_problem_error",
    acks_late=True,
)
def on_problem_error(self, failed_task_id, *, problem_id: str) -> dict:
    """Error callback for per-problem pipeline failures.

    Marks the problem as analysis_status='failed' and stores the error message.
    """
    error_msg = f"Task {failed_task_id} failed"
    logger.error(
        "Analysis pipeline failed for problem %s: %s", problem_id, error_msg
    )
    try:
        asyncio.run(_mark_problem_failed(problem_id, error_msg))
    except Exception:
        logger.exception("Failed to mark problem %s as failed in DB", problem_id)
    return {"problem_id": problem_id, "decision": "failed", "error": error_msg}


async def _mark_problem_failed(problem_id: str, error_msg: str) -> None:
    async with worker_session() as session:
        result = await session.execute(
            select(Problem).where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if problem:
            problem.analysis_status = AnalysisStatus.failed
            # Store error message in common_mistakes as structured data
            error_entry = {"_error": error_msg}
            if isinstance(problem.common_mistakes, list):
                problem.common_mistakes = [error_entry] + problem.common_mistakes
            else:
                problem.common_mistakes = [error_entry]
            await session.commit()
            logger.info("Marked problem %s as analysis_status=failed: %s", problem_id, error_msg)


@celery.task(
    bind=True,
    name="task.analysis.merge_stage1",
    max_retries=2,
    default_retry_delay=5,
    acks_late=True,
)
def merge_stage1_results(self, stage1_results: list[dict], *, problem_id: str) -> dict:
    """Merge parallel Stage 1 results and save to database."""
    return asyncio.run(_merge(problem_id, stage1_results))


async def _merge(problem_id: str, results: list[dict]) -> dict:
    merged: dict = {"problem_id": problem_id}
    for i, result in enumerate(results):
        if isinstance(result, dict):
            merged.update(result)
        else:
            logger.warning(
                "Stage 1 task %d returned non-dict for problem %s: %r",
                i, problem_id, result,
            )
    # Ensure problem_id is preserved
    merged["problem_id"] = problem_id

    async with worker_session() as session:
        query = await session.execute(
            select(Problem).where(Problem.id == problem_id)
        )
        problem = query.scalar_one_or_none()
        if not problem:
            raise ValueError(f"Problem {problem_id} not found")

        # Update analysis status
        problem.analysis_status = AnalysisStatus.analyzing

        # Save Stage 1 results
        if merged.get("solution_strategy"):
            problem.solution_strategy = merged["solution_strategy"]
        if merged.get("required_concepts"):
            problem.required_concepts = merged["required_concepts"]
        if merged.get("solution_steps"):
            problem.solution_steps = merged["solution_steps"]
        if merged.get("estimated_time_sec") is not None:
            problem.estimated_time_sec = merged["estimated_time_sec"]
        if merged.get("common_mistakes"):
            problem.common_mistakes = merged["common_mistakes"]

        # Refined classification
        if merged.get("subject"):
            problem.subject = merged["subject"]
        if merged.get("unit_major"):
            problem.unit_major = merged["unit_major"]
        if merged.get("unit_minor"):
            problem.unit_minor = merged["unit_minor"]
        if merged.get("unit_sub"):
            problem.unit_sub = merged["unit_sub"]
        if merged.get("difficulty_refined") is not None:
            problem.difficulty_refined = merged["difficulty_refined"]
        if merged.get("is_common") is not None:
            problem.is_common = merged["is_common"]
        if merged.get("classification_confidence") is not None:
            problem.classification_confidence = merged["classification_confidence"]

        # Exam pattern
        if merged.get("exam_source"):
            problem.exam_source = merged["exam_source"]
        if merged.get("position_type"):
            problem.position_type = merged["position_type"]
        if merged.get("point_value") is not None:
            problem.point_value = merged["point_value"]
        if merged.get("question_format"):
            problem.question_format = merged["question_format"]

        await session.commit()

    logger.info("Merged Stage 1 results for problem %s", problem_id)
    return merged


@celery.task(
    bind=True,
    name="task.analysis.finalize",
    acks_late=True,
)
def finalize_analysis(self, results: list, *, ocr_job_id: str, total: int) -> dict:
    """Finalize analysis batch — count results and notify NestJS."""
    actual = len(results) if results else 0
    if actual != total:
        logger.warning(
            "Analysis finalize mismatch for job %s: expected %d results, got %d",
            ocr_job_id, total, actual,
        )

    auto_approved = 0
    completed = 0
    failed = 0
    problem_ids: list[str] = []

    for result in results:
        if isinstance(result, dict):
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
        else:
            failed += 1

    notify_progress(ocr_job_id, "analysis_complete", current=completed, total=total, message="AI 분석 완료")

    if failed > 0 and completed == 0:
        notify_analysis_failed(ocr_job_id, f"All {failed} problems failed analysis")
    else:
        notify_analysis_completed(ocr_job_id, completed, auto_approved, problem_ids)

    logger.info(
        "Analysis finalized for job %s: %d completed, %d auto-approved, %d failed (expected %d)",
        ocr_job_id, completed, auto_approved, failed, total,
    )
    return {
        "ocr_job_id": ocr_job_id,
        "completed": completed,
        "auto_approved": auto_approved,
        "failed": failed,
    }
