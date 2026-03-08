"""Celery task: Vision LLM photo analysis.

Analyzes student handwritten solution photos using Anthropic Claude Vision API.
Receives work via Redis 'photo:analyze' channel, publishes results to
'photo:analysis:completed' or 'photo:analysis:failed'.

NOTE: Does NOT directly access lms.submission_photos — respects schema boundary.
NestJS handles DB updates upon receiving the Redis event.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging

import anthropic
import boto3

from app.celery_app import celery
from app.config import settings
from app.services.redis_events import publish_sync

logger = logging.getLogger(__name__)

_MEDIA_TYPE_MAP = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}

SYSTEM_PROMPT = (
    "당신은 수학 과외 선생님입니다. 학생의 손글씨 풀이를 정확하게 분석하고, "
    "친절하면서도 교육적인 피드백을 제공합니다. JSON으로만 응답하세요."
)


def _build_user_prompt(payload: dict) -> str:
    answer_info = payload.get("answerText") or payload.get("answerLatex") or "정답 정보 없음"

    solution_context = ""
    steps = payload.get("solutionSteps")
    if steps and isinstance(steps, list):
        lines = [
            f"  {s.get('step', i + 1)}. {s.get('description', '')}"
            for i, s in enumerate(steps)
        ]
        solution_context = "\n풀이 단계:\n" + "\n".join(lines)

    return f"""다음은 수학 문제에 대한 학생의 손글씨 풀이 사진입니다.

문제: {payload.get("problemStemLatex", "문제 정보 없음")}
정답: {answer_info}
{solution_context}

학생의 풀이를 분석하고 아래 JSON 형식으로만 응답하세요:
{{
    "isCorrect": boolean,
    "score": number (0-10),
    "maxScore": 10,
    "steps": [
        {{
            "step": number,
            "content": "학생이 쓴 내용 요약",
            "correct": boolean,
            "feedback": "틀렸으면 왜 틀렸는지 설명 (맞으면 생략 가능)"
        }}
    ],
    "errorType": "sign_error|calculation_error|concept_error|formula_error|logic_error|transcription_error|null",
    "conceptHint": "관련 개념이나 공식 힌트 (틀렸을 경우)",
    "overallFeedback": "전체적인 피드백 (한국어, 2-3문장)"
}}"""


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


def _parse_llm_response(text: str) -> dict:
    """Extract JSON from LLM response, handling markdown code blocks."""
    clean = text
    if "```json" in clean:
        clean = clean.split("```json")[1].split("```")[0]
    elif "```" in clean:
        clean = clean.split("```")[1].split("```")[0]
    try:
        return json.loads(clean.strip())
    except json.JSONDecodeError:
        logger.error("Failed to parse Vision LLM response: %s", text[:200])
        return {
            "isCorrect": False,
            "score": 0,
            "maxScore": 10,
            "steps": [],
            "errorType": None,
            "conceptHint": None,
            "overallFeedback": "풀이 분석에 실패했습니다. 다시 시도해주세요.",
        }


@celery.task(
    bind=True,
    name="task.photo.analyze",
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def analyze_submission_photo(self, payload: dict) -> dict:
    """Analyze a student's handwritten solution photo.

    payload: {
        submissionPhotoId: str,
        s3Key: str,
        problemStemLatex: str,
        answerText: str | None,
        answerLatex: str | None,
        solutionSteps: list | None,
    }
    """
    photo_id = payload["submissionPhotoId"]
    try:
        if not settings.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY is not configured")

        # 1. Download image from S3
        base64_data, media_type = _download_image(payload["s3Key"])

        # 2. Call Anthropic Vision API
        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6-20250514",
            max_tokens=2000,
            system=SYSTEM_PROMPT,
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
                            "text": _build_user_prompt(payload),
                        },
                    ],
                }
            ],
        )

        # 3. Parse response
        feedback = _parse_llm_response(response.content[0].text)

        # 4. Publish completion event — NestJS updates submission_photos
        publish_sync("photo:analysis:completed", {
            "submissionPhotoId": photo_id,
            "feedback": feedback,
        })

        logger.info(
            "Photo analysis completed for %s: score=%s/10",
            photo_id,
            feedback.get("score"),
        )
        return feedback

    except anthropic.APIError as exc:
        logger.error("Anthropic API error for %s: %s", photo_id, exc)
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.error("Photo analysis failed for %s: %s", photo_id, exc)
        publish_sync("photo:analysis:failed", {
            "submissionPhotoId": photo_id,
            "reason": str(exc),
        })
        raise self.retry(exc=exc)
