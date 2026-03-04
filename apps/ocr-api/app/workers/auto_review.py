"""Celery task: auto-review analyzed problems.

Cross-validates all analysis results and determines whether to auto-approve
or keep as pending_review.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.celery_app import celery
from app.database import worker_session
from app.models.problem import AnalysisStatus, Problem, ReviewStatus
from app.schemas.problem import CURRICULUM_TREE, SUBJECTS

logger = logging.getLogger(__name__)

AUTO_APPROVE_THRESHOLD = 0.85


@celery.task(
    bind=True,
    name="task.analysis.auto_review",
    max_retries=2,
    default_retry_delay=5,
    acks_late=True,
)
def auto_review(self, previous_result=None, *, problem_id: str | None = None) -> dict:
    """Auto-review a problem after all analysis stages complete."""
    if previous_result and isinstance(previous_result, dict):
        problem_id = problem_id or previous_result.get("problem_id")
    if not problem_id:
        raise ValueError("problem_id is required")

    return asyncio.run(_review(problem_id))


async def _review(problem_id: str) -> dict:
    checks = []

    async with worker_session() as session:
        result = await session.execute(
            select(Problem).where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if not problem:
            raise ValueError(f"Problem {problem_id} not found")

        # Check 1: Subject is valid CSAT subject
        subject_valid = problem.subject in SUBJECTS
        checks.append(("subject_valid", subject_valid))

        # Check 2: Unit matches subject in curriculum tree
        unit_matches = False
        if problem.subject and problem.unit_major:
            subject_tree = CURRICULUM_TREE.get(problem.subject, {})
            unit_matches = problem.unit_major in subject_tree
        checks.append(("unit_matches_subject", unit_matches))

        # Check 3: Solution strategy is populated
        has_strategy = bool(problem.solution_strategy)
        checks.append(("has_solution_strategy", has_strategy))

        # Check 4: Required concepts populated
        has_concepts = bool(problem.required_concepts and len(problem.required_concepts) > 0)
        checks.append(("has_required_concepts", has_concepts))

        # Check 5: Difficulty is reasonable (refined exists and in range)
        difficulty_ok = (
            problem.difficulty_refined is not None
            and 1.0 <= problem.difficulty_refined <= 5.0
        )
        checks.append(("difficulty_in_range", difficulty_ok))

        # Check 6: Confidence above threshold
        confidence = problem.classification_confidence or 0.0
        confidence_ok = confidence >= AUTO_APPROVE_THRESHOLD
        checks.append(("confidence_above_threshold", confidence_ok))

        # Decision
        all_passed = all(passed for _, passed in checks)
        failed_checks = [name for name, passed in checks if not passed]

        if all_passed and confidence_ok:
            problem.review_status = ReviewStatus.auto_approved
            decision = "auto_approved"
        else:
            problem.review_status = ReviewStatus.pending_review
            decision = "pending_review"

        # Mark analysis as complete
        problem.analysis_status = AnalysisStatus.completed
        problem.analyzed_at = datetime.now(timezone.utc)
        await session.commit()

    logger.info(
        "Auto-review for %s: %s (failed checks: %s)",
        problem_id,
        decision,
        failed_checks or "none",
    )

    return {
        "problem_id": problem_id,
        "decision": decision,
        "checks": {name: passed for name, passed in checks},
        "failed_checks": failed_checks,
    }
