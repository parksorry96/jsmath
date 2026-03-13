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

SYSTEM_PROMPT = """당신은 한국 수학 과외 선생님이자 첨삭자입니다.

# 목표
학생의 손글씨 풀이 사진에서 실제로 보이는 내용만 근거로 채점하고 피드백을 제공합니다.

# 판단 원칙
- 사진에 보이지 않는 계산이나 의도를 추측해서 단정하지 마세요.
- 글씨가 흐리거나 잘린 경우, 확실히 읽히는 부분만 평가하고 불확실성은 feedback 또는 overallFeedback에 반영하세요.
- 문제 후보가 여러 개면 가장 잘 맞는 하나만 고르되, 낮은 확신이면 보수적으로 채점하세요.
- 점수는 정답 여부뿐 아니라 풀이의 진행 정도를 반영하세요.
- steps는 사진에서 보이는 순서대로 작성하세요.

# 출력 규칙
- JSON 객체 하나만 반환하세요.
- 마크다운, 코드블록, 설명 문장, 추가 키를 출력하지 마세요.
- overallFeedback은 한국어 2-3문장으로 작성하세요."""


def _build_user_prompt(payload: dict) -> str:
    problem_candidates = payload.get("problems")
    if isinstance(problem_candidates, list) and problem_candidates:
        candidate_sections: list[str] = []
        for index, problem in enumerate(problem_candidates, start=1):
            answer_info = (
                problem.get("answerText")
                or problem.get("answerLatex")
                or "정답 정보 없음"
            )

            solution_context = ""
            steps = problem.get("solutionSteps")
            if steps and isinstance(steps, list):
                lines = [
                    f"  {s.get('step', i + 1)}. {s.get('description', '')}"
                    for i, s in enumerate(steps)
                    if isinstance(s, dict)
                ]
                if lines:
                    solution_context = "\n풀이 단계:\n" + "\n".join(lines)

            candidate_sections.append(
                f"""[문항 후보 {index}]
문항 ID: {problem.get("id", "알 수 없음")}
문제: {problem.get("stemLatex", "문제 정보 없음")}
정답: {answer_info}
{solution_context}"""
            )

        return f"""다음은 수학 과제의 손글씨 풀이 사진입니다.

아래 문항 후보 중에서 사진과 가장 잘 맞는 문제를 먼저 판단한 뒤, 그 문제 기준으로 풀이를 분석하세요.
후보가 많아도 반드시 하나만 선택하세요.
사진이 불분명하면 보이는 범위까지만 평가하고, 억지로 완성된 풀이를 상상하지 마세요.

{chr(10).join(candidate_sections)}

학생의 풀이를 분석하고 아래 JSON 형식으로만 응답하세요:
{{
    "matchedProblemId": "선택한 문항 ID",
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

사진이 불분명하면 보이는 범위까지만 평가하고, 확실하지 않은 부분은 추측하지 마세요.

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


def _maybe_chain_rubric_grading(payload: dict, feedback: dict) -> None:
    """Dispatch rubric grading if the matched problem has solutionSteps."""
    matched_id = feedback.get("matchedProblemId")
    problems = payload.get("problems")
    if not matched_id or not isinstance(problems, list):
        return

    matched = next((p for p in problems if p.get("id") == matched_id), None)
    if not matched:
        return

    steps = matched.get("solutionSteps")
    if not steps or not isinstance(steps, list):
        return

    from app.workers.rubric_grader import rubric_grade_photo

    rubric_grade_photo.delay({
        "submissionPhotoId": payload["submissionPhotoId"],
        "submissionAnswerId": None,
        "s3Key": payload["s3Key"],
        "problem": matched,
    })
    logger.info(
        "Chained rubric grading for photo %s (problem %s)",
        payload["submissionPhotoId"],
        matched_id,
    )


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
        problems: list[dict] | None,
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

        # 5. Chain rubric grading if matched problem has solutionSteps
        _maybe_chain_rubric_grading(payload, feedback)

        return feedback

    except anthropic.APIError as exc:
        logger.error("Anthropic API error for %s: %s", photo_id, exc)
        raise self.retry(exc=exc)
    except Exception as exc:
        logger.error("Photo analysis failed for %s: %s", photo_id, exc)
        if self.request.retries >= self.max_retries:
            publish_sync("photo:analysis:failed", {
                "submissionPhotoId": photo_id,
                "reason": str(exc),
            })
            raise
        raise self.retry(exc=exc)
