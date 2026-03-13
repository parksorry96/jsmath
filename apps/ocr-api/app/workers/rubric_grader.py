"""Celery task: Rubric-based partial credit grading with Claude Vision.

Downloads the student's handwritten solution image from S3, builds a scoring
rubric from the matched problem's solutionSteps, and calls Anthropic Claude
Vision to grade each rubric step independently.

Publishes results to 'photo:rubric:completed' for NestJS to persist on
SubmissionAnswer (rubricResult, rubricScore, rubricVersion).

NOTE: Does NOT directly access lms.* tables — respects schema boundary.
"""

from __future__ import annotations

import base64
import json
import logging

import anthropic
import boto3

from app.celery_app import celery
from app.config import settings
from app.services.redis_events import publish_sync

logger = logging.getLogger(__name__)

RUBRIC_VERSION = 1

_MEDIA_TYPE_MAP = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}

RUBRIC_SYSTEM_PROMPT = """당신은 한국 수학 교육 전문가이자 채점관입니다.

# 목표
학생의 손글씨 풀이 사진을 루브릭(채점 기준표)에 따라 단계별로 부분 점수를 부여합니다.

# 채점 원칙
- 각 루브릭 단계를 독립적으로 평가합니다. 한 단계의 실수가 다른 단계 점수에 영향을 주지 않습니다.
- 사진에 보이는 내용만 근거로 채점합니다. 보이지 않는 계산이나 의도를 추측하지 마세요.
- 글씨가 흐리거나 잘린 경우, 확실히 읽히는 부분만 평가하고 불확실성은 feedback에 명시하세요.
- 풀이 과정이 다르더라도 수학적으로 올바르면 점수를 부여합니다 (대안 풀이 인정).
- 부분 점수는 0부터 해당 단계의 maxPoints까지 정수로 부여합니다.

# 출력 규칙
- JSON 객체 하나만 반환하세요.
- 마크다운, 코드블록, 설명 문장, 추가 키를 출력하지 마세요.
- feedback과 overallFeedback은 한국어로 작성하세요.
- 각 단계의 feedback은 1-2문장으로 간결하게 작성하세요."""


def _download_image(s3_key: str) -> tuple[str, str]:
    """Download image from S3, return (base64_data, media_type)."""
    s3 = boto3.client(
        "s3",
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        region_name=settings.s3_region,
    )
    response = s3.get_object(Bucket=settings.s3_bucket, Key=s3_key)
    image_bytes = response["Body"].read()
    base64_data = base64.b64encode(image_bytes).decode("utf-8")

    ext = s3_key.rsplit(".", 1)[-1].lower()
    media_type = _MEDIA_TYPE_MAP.get(ext, "image/jpeg")
    return base64_data, media_type


def _build_rubric(solution_steps: list[dict]) -> list[dict]:
    """Build rubric items from a problem's solutionSteps.

    Each step gets a proportional share of 10 total points.
    """
    n = len(solution_steps)
    if n == 0:
        return []

    base_points = 10 // n
    remainder = 10 % n

    rubric: list[dict] = []
    for i, step in enumerate(solution_steps):
        max_points = base_points + (1 if i < remainder else 0)
        rubric.append({
            "step": step.get("step", i + 1),
            "description": step.get("description", ""),
            "maxPoints": max_points,
            "criteria": step.get("criteria", step.get("description", "")),
        })
    return rubric


def _build_user_prompt(
    problem: dict,
    rubric: list[dict],
) -> str:
    """Build the user prompt with problem context and rubric."""
    answer_info = (
        problem.get("answerText")
        or problem.get("answerLatex")
        or "정답 정보 없음"
    )

    rubric_lines: list[str] = []
    for item in rubric:
        rubric_lines.append(
            f"  단계 {item['step']}: {item['description']} "
            f"(배점: {item['maxPoints']}점, 기준: {item['criteria']})"
        )

    return f"""다음은 수학 문제에 대한 학생의 손글씨 풀이 사진입니다.

문제: {problem.get("stemLatex", "문제 정보 없음")}
정답: {answer_info}

아래 채점 기준표(루브릭)에 따라 각 단계를 독립적으로 채점하세요.

[채점 기준표]
{chr(10).join(rubric_lines)}

총 배점: {sum(item["maxPoints"] for item in rubric)}점

사진에 보이는 풀이만 근거로 채점하고, 아래 JSON 형식으로만 응답하세요:
{{
    "rubric": [
        {{"step": number, "description": "단계 설명", "maxPoints": number, "criteria": "채점 기준"}}
    ],
    "grades": [
        {{"step": number, "earnedPoints": number, "maxPoints": number, "feedback": "채점 근거 (한국어)"}}
    ],
    "totalScore": number,
    "maxScore": 10,
    "overallFeedback": "전체적인 피드백 (한국어, 2-3문장)"
}}"""


def _parse_rubric_response(text: str) -> dict:
    """Extract JSON from LLM response, handling markdown code blocks."""
    clean = text
    if "```json" in clean:
        clean = clean.split("```json")[1].split("```")[0]
    elif "```" in clean:
        clean = clean.split("```")[1].split("```")[0]
    try:
        return json.loads(clean.strip())
    except json.JSONDecodeError:
        logger.error("Failed to parse rubric LLM response: %s", text[:200])
        return {
            "rubric": [],
            "grades": [],
            "totalScore": 0,
            "maxScore": 10,
            "overallFeedback": "채점 분석에 실패했습니다. 다시 시도해주세요.",
        }


@celery.task(
    bind=True,
    name="task.photo.rubric_grade",
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def rubric_grade_photo(self, payload: dict) -> dict:
    """Grade a student's handwritten solution using rubric-based partial credit.

    payload: {
        submissionPhotoId: str,
        submissionAnswerId: str,
        s3Key: str,
        problem: {id, stemLatex, answerText, answerLatex, solutionSteps},
    }
    """
    photo_id = payload["submissionPhotoId"]
    answer_id = payload.get("submissionAnswerId")
    problem = payload["problem"]

    try:
        if not settings.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY is not configured")

        solution_steps = problem.get("solutionSteps")
        if not solution_steps or not isinstance(solution_steps, list):
            logger.info(
                "Skipping rubric grading for %s: no solutionSteps", photo_id
            )
            return {}

        # 1. Build rubric from solutionSteps
        rubric = _build_rubric(solution_steps)
        if not rubric:
            return {}

        # 2. Download image from S3
        base64_data, media_type = _download_image(payload["s3Key"])

        # 3. Call Anthropic Vision API
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6-20250514",
            max_tokens=2000,
            system=RUBRIC_SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": base64_data,
                            },
                        },
                        {
                            "type": "text",
                            "text": _build_user_prompt(problem, rubric),
                        },
                    ],
                }
            ],
        )

        # 4. Parse response
        result = _parse_rubric_response(response.content[0].text)

        # 5. Publish completion event
        publish_sync("photo:rubric:completed", {
            "submissionPhotoId": photo_id,
            "submissionAnswerId": answer_id,
            "problemId": problem.get("id"),
            "rubricResult": result,
            "rubricScore": result.get("totalScore", 0),
            "rubricVersion": RUBRIC_VERSION,
        })

        logger.info(
            "Rubric grading completed for photo %s: %s/%s",
            photo_id,
            result.get("totalScore"),
            result.get("maxScore"),
        )
        return result

    except anthropic.APIError as exc:
        logger.error("Anthropic API error for rubric grading %s: %s", photo_id, exc)
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.error("Rubric grading failed for %s: %s", photo_id, exc)
        if self.request.retries >= self.max_retries:
            publish_sync("photo:rubric:failed", {
                "submissionPhotoId": photo_id,
                "submissionAnswerId": answer_id,
                "reason": str(exc),
            })
            raise
        raise self.retry(exc=exc)
