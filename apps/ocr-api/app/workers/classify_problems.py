"""Celery task: classify segmented problems using OpenAI structured output.

Assigns: grade_level, subject, unit_major, unit_minor, unit_sub, difficulty, concept tags.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

from openai import AsyncOpenAI
from sqlalchemy import select

from app.celery_app import celery
from app.config import settings
from app.database import worker_session
from app.models.job import JobStatus, OcrJobTracking
from app.models.ocr import OcrPage
from app.schemas.problem import CURRICULUM_TREE, DIFFICULTY_LEVELS, GRADE_LEVELS, SUBJECTS

logger = logging.getLogger(__name__)

CLASSIFICATION_PROMPT = """You are a Korean math education expert. Classify the following math problem.

Problem (LaTeX):
{stem_latex}

Problem (plain text):
{stem_text}

Classify into:
- grade_level: one of {grade_levels}
- subject: one of {subjects}
- unit_major: major unit name from Korean 2022 revised curriculum
- unit_minor: sub-unit name
- unit_sub: specific topic
- difficulty: 1 (기초) to 5 (최상)
- concept_tags: list of math concept keywords (Korean)
- confidence: your confidence in the classification (0.0 to 1.0)

Available curriculum structure:
{curriculum}

Respond in JSON format only."""

REVIEW_CONFIDENCE_THRESHOLD = 0.7


@celery.task(
    bind=True,
    name="task.problem.classify",
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def classify_problems(
    self,
    crop_result: dict | None = None,
    *,
    ocr_job_id: str | None = None,
    segments: list[dict] | None = None,
) -> dict:
    """Classify all segmented problems for an OCR job."""
    if crop_result:
        ocr_job_id = crop_result["ocr_job_id"]
        if segments is None:
            maybe_segments = crop_result.get("segments")
            if isinstance(maybe_segments, list):
                segments = maybe_segments
    if not ocr_job_id:
        raise ValueError("ocr_job_id is required")

    return asyncio.run(_classify(self, ocr_job_id, segments))


async def _classify(task, ocr_job_id: str, segments: list[dict] | None) -> dict:
    async with worker_session() as session:
        job_result = await session.execute(
            select(OcrJobTracking).where(OcrJobTracking.id == ocr_job_id)
        )
        job = job_result.scalar_one()
        job.status = JobStatus.classifying
        await session.commit()

    if segments is None:
        logger.warning(
            "No segments payload for job %s; treating as empty result",
            ocr_job_id,
        )
        segments = []

    client: AsyncOpenAI | None = None
    if settings.ai_api_key:
        client_kwargs: dict[str, str] = {"api_key": settings.ai_api_key}
        if settings.ai_api_base_url:
            client_kwargs["base_url"] = settings.ai_api_base_url
        client = AsyncOpenAI(**client_kwargs)
    else:
        logger.warning(
            "AI_API_KEY is missing; using heuristic classification fallback for job %s",
            ocr_job_id,
        )

    results = []
    review_needed = 0

    for segment in segments:
        try:
            if client is None:
                classification = _heuristic_classify(segment)
            else:
                classification = await _classify_single(client, segment)
            results.append(classification)

            if classification.get("confidence", 0) < REVIEW_CONFIDENCE_THRESHOLD:
                review_needed += 1

        except Exception as exc:
            logger.warning(
                "Classification failed for problem %s: %s",
                segment.get("problem_number"),
                exc,
            )
            results.append({
                "problem_number": segment.get("problem_number"),
                "error": str(exc),
                "confidence": 0.0,
            })
            review_needed += 1

    # Update job completion
    async with worker_session() as session:
        job_result = await session.execute(
            select(OcrJobTracking).where(OcrJobTracking.id == ocr_job_id)
        )
        job = job_result.scalar_one()
        job.status = JobStatus.completed
        job.problem_count = len(segments)
        job.completed_at = datetime.now(timezone.utc)
        await session.commit()

    # Build page_number → image_s3_key mapping
    page_image_map: dict[int, str | None] = {}
    async with worker_session() as session:
        pages_result = await session.execute(
            select(OcrPage.page_number, OcrPage.image_s3_key).where(
                OcrPage.ocr_job_id == ocr_job_id
            )
        )
        for row in pages_result.all():
            page_image_map[row.page_number] = row.image_s3_key

    # Merge segment data with classification results
    merged_problems = []
    for segment, classification in zip(segments, results):
        problem = {
            "problemNumber": segment.get("problem_number"),
            "displayNumber": segment.get("display_number"),
            "problemType": segment.get("problem_type", "short_answer"),
            "startPage": segment.get("start_page", 0),
            "endPage": segment.get("end_page", 0),
            "stemLatex": segment.get("stem_latex", ""),
            "stemText": segment.get("stem_text", ""),
            "gradeLevel": classification.get("grade_level"),
            "subject": classification.get("subject"),
            "unitMajor": classification.get("unit_major"),
            "unitMinor": classification.get("unit_minor"),
            "unitSub": classification.get("unit_sub"),
            "difficulty": classification.get("difficulty"),
            "classificationConfidence": classification.get("confidence", 0.0),
            "pageImageS3Key": page_image_map.get(segment.get("start_page", 0)),
            "problemImageS3Key": segment.get("problem_image_s3_key"),
        }
        # Include choices from segment if present
        choices = segment.get("choices")
        if choices:
            problem["choices"] = [
                {
                    "position": c.get("position", i + 1),
                    "label": c.get("label", ""),
                    "contentLatex": c.get("content_latex", ""),
                    "contentText": c.get("content_text", ""),
                }
                for i, c in enumerate(choices)
            ]
        merged_problems.append(problem)

    # Notify NestJS (sync call, safe for Celery workers)
    from app.services.redis_events import notify_completed

    notify_completed(ocr_job_id, len(segments), merged_problems)

    logger.info(
        "Classified %d problems for job %s (%d need review)",
        len(results),
        ocr_job_id,
        review_needed,
    )

    return {
        "ocr_job_id": ocr_job_id,
        "classified_count": len(results),
        "review_needed": review_needed,
        "results": results,
    }


async def _classify_single(client: AsyncOpenAI, segment: dict) -> dict:
    """Classify a single problem using OpenAI."""
    prompt = CLASSIFICATION_PROMPT.format(
        stem_latex=segment.get("stem_latex", ""),
        stem_text=segment.get("stem_text", ""),
        grade_levels=", ".join(GRADE_LEVELS),
        subjects=", ".join(SUBJECTS),
        curriculum=json.dumps(CURRICULUM_TREE, ensure_ascii=False, indent=2),
    )

    response = await client.chat.completions.create(
        model=settings.ai_model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=1,
        max_completion_tokens=500,
    )

    content = response.choices[0].message.content or "{}"
    result = json.loads(content)
    if not isinstance(result, dict):
        raise ValueError("AI classification response is not a JSON object")

    # Validate and normalize
    result["problem_number"] = segment.get("problem_number")
    if result.get("difficulty") and isinstance(result["difficulty"], int):
        result["difficulty"] = max(1, min(5, result["difficulty"]))

    return result


def _heuristic_classify(segment: dict) -> dict:
    """Fallback when AI API key is unavailable."""
    text = (segment.get("stem_text") or "").lower()

    subject = SUBJECTS[0] if SUBJECTS else "수학(중등)"
    grade_level = GRADE_LEVELS[0] if GRADE_LEVELS else "middle_1"

    if any(token in text for token in ("미적분", "적분", "도함수", "극한")):
        subject = "미적분"
        grade_level = "high_2"
    elif any(token in text for token in ("확률", "조합", "순열", "통계")):
        subject = "확률과 통계"
        grade_level = "high_2"
    elif any(token in text for token in ("삼각", "수열", "지수", "로그")):
        subject = "수학I"
        grade_level = "high_1"

    return {
        "problem_number": segment.get("problem_number"),
        "grade_level": grade_level,
        "subject": subject,
        "unit_major": None,
        "unit_minor": None,
        "unit_sub": None,
        "difficulty": 3 if 3 in DIFFICULTY_LEVELS else 1,
        "concept_tags": [],
        "confidence": 0.4,
    }
