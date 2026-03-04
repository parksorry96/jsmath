# OCR+AI Pipeline Optimization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the OCR+AI pipeline from a manual multi-step workflow into an automated one-stop pipeline with unified prompts, SSE real-time updates, and corrected curriculum taxonomy.

**Architecture:** OCR finalize auto-triggers AI analysis via NestJS event handler. Three Stage 1 AI workers merge into one unified prompt with Pydantic strict schema. Frontend replaces polling with SSE for real-time multi-stage progress.

**Tech Stack:** FastAPI + Celery (Python), NestJS (TypeScript), OpenAI GPT-5 Mini, Redis Pub/Sub, SSE, Prisma, SQLAlchemy, pgvector

---

## Phase 1: Critical Bug Fixes

### Task 1: Fix `analysis:completed` payload — add problemIds

**Files:**
- Modify: `apps/ocr-api/app/workers/analysis_pipeline.py:189-234`
- Modify: `apps/ocr-api/app/services/redis_events.py:69-79`

**Step 1: Update `finalize_analysis` to collect problem IDs from results**

In `analysis_pipeline.py`, the `finalize_analysis` task receives `results` — a list of dicts from `auto_review`. Each dict has a `problem_id` field. Collect these IDs:

```python
# analysis_pipeline.py — finalize_analysis function body, replace lines 203-223
    auto_approved = 0
    completed = 0
    failed = 0
    problem_ids: list[str] = []

    for result in results:
        if isinstance(result, dict):
            pid = result.get("problem_id")
            if pid:
                problem_ids.append(pid)
            decision = result.get("decision")
            if decision == "auto_approved":
                auto_approved += 1
                completed += 1
            elif decision == "pending_review":
                completed += 1
            else:
                failed += 1
        else:
            failed += 1

    if failed > 0 and completed == 0:
        notify_analysis_failed(ocr_job_id, f"All {failed} problems failed analysis")
    else:
        notify_analysis_completed(ocr_job_id, completed, auto_approved, problem_ids)
```

**Step 2: Update `notify_analysis_completed` to accept and include problemIds**

```python
# redis_events.py — replace notify_analysis_completed (lines 69-79)
def notify_analysis_completed(
    ocr_job_id: str,
    analyzed_count: int,
    auto_approved_count: int,
    problem_ids: list[str] | None = None,
) -> None:
    """Notify NestJS that AI analysis completed for a batch."""
    publish_sync("analysis:completed", {
        "ocrJobId": ocr_job_id,
        "analyzedCount": analyzed_count,
        "autoApprovedCount": auto_approved_count,
        "problemIds": problem_ids or [],
    })
```

**Step 3: Verify NestJS handler already expects problemIds**

Check `apps/lms-api/src/files/files.service.ts:128-137` — it already reads `payload.problemIds`. No change needed on NestJS side.

**Step 4: Commit**
```bash
git add apps/ocr-api/app/workers/analysis_pipeline.py apps/ocr-api/app/services/redis_events.py
git commit -m "fix: include problemIds in analysis:completed event payload"
```

---

### Task 2: Fix error message storage in `_mark_problem_failed`

**Files:**
- Modify: `apps/ocr-api/app/workers/analysis_pipeline.py:93-106`

**Step 1: Store error_msg in the problem record**

```python
# Replace _mark_problem_failed (lines 93-106)
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
```

**Step 2: Commit**
```bash
git add apps/ocr-api/app/workers/analysis_pipeline.py
git commit -m "fix: store error message when marking problem analysis as failed"
```

---

### Task 3: Add Redis publish fallback queue

**Files:**
- Modify: `apps/ocr-api/app/services/redis_events.py:26-33`

**Step 1: Add subscriber check and LPUSH fallback**

```python
# Replace publish_sync (lines 26-33)
def publish_sync(channel: str, payload: dict[str, Any]) -> None:
    """Publish a JSON event to a Redis channel (sync, safe for Celery workers).

    If no subscribers are listening, pushes to a fallback queue for later processing.
    """
    r = redis.from_url(settings.redis_url, decode_responses=True)
    try:
        data = json.dumps(payload)
        receivers = r.publish(channel, data)
        if receivers == 0:
            fallback_key = f"fallback:{channel}"
            r.lpush(fallback_key, data)
            logger.warning("No subscribers for %s — saved to %s", channel, fallback_key)
        else:
            logger.info("Published to %s (%d receivers): %s", channel, receivers, payload.get("ocrJobId", ""))
    finally:
        r.close()
```

**Step 2: Commit**
```bash
git add apps/ocr-api/app/services/redis_events.py
git commit -m "fix: add fallback queue when no Redis subscribers are listening"
```

---

## Phase 2: Unified Analysis Prompt + Auto-Trigger

### Task 4: Fix curriculum taxonomy errors

**Files:**
- Modify: `apps/ocr-api/app/schemas/problem.py:14-41`

**Step 1: Fix comment and CURRICULUM_TREE**

```python
# Replace lines 14-41 in problem.py
# 2015 개정교육과정 hierarchy (applies through 2027 수능)
CURRICULUM_TREE: dict[str, dict[str, list[str]]] = {
    "수학I": {
        "지수함수와 로그함수": ["거듭제곱근", "지수의 확장", "로그의 뜻과 성질", "상용로그", "지수함수", "로그함수"],
        "삼각함수": ["일반각과 호도법", "삼각함수의 뜻", "삼각함수의 그래프", "사인법칙", "코사인법칙"],
        "수열": ["등차수열", "등비수열", "수열의 합", "수학적 귀납법"],
    },
    "수학II": {
        "함수의 극한과 연속": ["함수의 극한", "함수의 연속"],
        "미분": ["평균변화율", "미분계수", "도함수", "접선의 방정식", "함수의 증감", "극대극소", "최댓값최솟값"],
        "적분": ["부정적분", "정적분", "정적분과 급수의 관계", "넓이"],
    },
    "확률과 통계": {
        "경우의 수": ["순열", "조합", "중복순열", "중복조합"],
        "확률": ["확률의 뜻", "조건부확률", "사건의 독립과 종속", "독립시행"],
        "통계": ["확률분포", "정규분포", "통계적 추정"],
    },
    "미적분": {
        "수열의 극한": ["수열의 극한", "급수"],
        "미분법": ["지수로그미분", "삼각함수미분", "매개변수미분법", "음함수미분법", "여러가지미분법", "도함수의 활용"],
        "적분법": ["치환적분", "부분적분", "여러가지적분법", "정적분의 활용", "넓이와 부피"],
    },
    "기하": {
        "이차곡선": ["포물선", "타원", "쌍곡선"],
        "평면벡터": ["벡터의 연산", "평면벡터의 성분", "내적", "직선과 원의 방정식"],
        "공간도형과 공간벡터": ["공간도형의 성질", "정사영", "공간좌표", "공간벡터"],
    },
}
```

**Step 2: Commit**
```bash
git add apps/ocr-api/app/schemas/problem.py
git commit -m "fix: correct curriculum taxonomy names and add missing topics"
```

---

### Task 5: Add `USE_UNIFIED_ANALYSIS` config flag

**Files:**
- Modify: `apps/ocr-api/app/config.py`

**Step 1: Add flag to Settings**

```python
# Add after line 25 (ai_model) in config.py
    use_unified_analysis: bool = True
```

**Step 2: Commit**
```bash
git add apps/ocr-api/app/config.py
git commit -m "feat: add USE_UNIFIED_ANALYSIS config flag for gradual rollout"
```

---

### Task 6: Create unified_analysis worker

**Files:**
- Create: `apps/ocr-api/app/workers/unified_analysis.py`

**Step 1: Create the unified analysis worker**

This replaces the Stage 1 chord of (analyze_solution + refine_classification + detect_exam_pattern) with a single GPT call + deterministic exam pattern rules.

```python
"""Unified AI analysis — single GPT call replacing 3 separate workers.

Combines: analyze_solution + refine_classification + detect_exam_pattern
into one structured output call. Deterministic exam rules applied post-GPT.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from openai import AsyncOpenAI, RateLimitError, APITimeoutError, APIConnectionError
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.celery_app import celery
from app.config import settings
from app.database import worker_session
from app.models.problem import Problem
from app.schemas.problem import CURRICULUM_TREE, SUBJECTS

logger = logging.getLogger(__name__)

COMMON_SUBJECTS = {"수학I", "수학II"}


# ─── Pydantic Output Schema ───

class SolutionStep(BaseModel):
    step: int
    description: str
    concept: str


class ExamSource(BaseModel):
    year: int
    month: int
    type: str
    number: int


class UnifiedAnalysisResult(BaseModel):
    """Strict schema for GPT-5 Mini structured output."""
    # Classification (FIRST — forces reasoning before deciding)
    classification_reasoning: str = Field(description="Explain why you chose this subject and unit")
    subject: str = Field(description="One of: 수학I, 수학II, 확률과 통계, 미적분, 기하")
    unit_major: str
    unit_minor: Optional[str] = None
    unit_sub: Optional[str] = None
    difficulty_refined: float = Field(ge=1.0, le=5.0)
    is_common: bool
    classification_confidence: float = Field(ge=0.0, le=1.0)

    # Solution analysis (SECOND — independent from classification)
    solution_strategy: str = Field(description="Step-by-step solution in Korean")
    required_concepts: list[str]
    solution_steps: list[SolutionStep]
    estimated_time_sec: int = Field(ge=30, le=900)
    common_mistakes: list[str]
    solution_confidence: float = Field(ge=0.0, le=1.0)

    # Exam source (LAST — optional)
    exam_source: Optional[ExamSource] = None


# ─── System Prompt ───

SYSTEM_PROMPT = """You are a Korean CSAT (수능) math education expert specializing in the 2015 개정교육과정.
You perform comprehensive analysis: curriculum classification AND solution analysis.

IMPORTANT: Classify FIRST, then analyze the solution independently.
Do NOT let solution analysis influence your classification decision.

Available subjects: 수학I, 수학II, 확률과 통계, 미적분, 기하

Subject details:
- 수학I: 지수함수와 로그함수, 삼각함수, 수열. 수능 공통과목.
- 수학II: 함수의 극한과 연속, 미분(다항함수), 적분(다항함수). 수능 공통과목.
- 확률과 통계: 경우의 수, 확률, 통계. 선택과목.
- 미적분: 수열의 극한, 급수, 여러 가지 미분법/적분법. 선택과목.
- 기하: 이차곡선, 평면벡터, 공간도형과 공간벡터. 선택과목.

COMMON MISCLASSIFICATION WARNINGS:
- "수열의 극한" / "급수" → 미적분 (NOT 수학I or 수학II)
- "함수의 극한" for polynomial functions → 수학II; for exp/log/trig → 미적분
- "적분" of polynomial only → 수학II; involving trig/exp → 미적분
- "지수·로그" with derivatives → 미적분 (NOT 수학I)
- "수열" in probability/counting context → 확률과 통계 (NOT 수학I)
- "조건부확률" with 순열/조합 → 확률과 통계

Difficulty scale (수능 기준):
1.0 (기초): 교과서 기본 예제. 정답률 95%+. Q1-Q2급.
2.0 (쉬움): 교과서 응용. 정답률 85-95%. Q3-Q6급.
3.0 (보통): 수능 기본 3점. 정답률 60-85%. Q7-Q12급.
3.5 (약간어려움): 4점 중간. 정답률 40-60%.
4.0 (어려움): 세미킬러급. 정답률 20-40%. Q15, Q20, Q28급.
4.5 (매우어려움): 준킬러급. 정답률 10-20%.
5.0 (최상): 킬러급. 정답률 <10%. Q21, Q29, Q30급.

Difficulty modifiers:
- 조건을 만족시키는 모든 정수 (box-type): +0.5
- ㄱ, ㄴ, ㄷ 보기 format: +0.5
- Graph reading + calculation combo: +0.5
- Multi-step function composition: +1.0

Curriculum hierarchy:
{curriculum_json}

If you can identify the specific CSAT exam source (수능, 6월모의평가, 9월모의평가, etc.), include it in exam_source. Otherwise set exam_source to null."""


# ─── User Prompt Template ───

USER_PROMPT_TEMPLATE = """Analyze this math problem comprehensively.

Problem (LaTeX):
{stem_latex}

Problem (plain text):
{stem_text}

{choices_text}

Problem number: {problem_number}
Current classification (may be incorrect):
- Subject: {current_subject}
- Unit: {current_unit_major}
- Difficulty: {current_difficulty}"""


# ─── Celery Task ───

@celery.task(
    bind=True,
    name="task.analysis.unified",
    max_retries=3,
    default_retry_delay=10,
    retry_backoff=True,
    acks_late=True,
)
def unified_analysis(self, *, problem_id: str, prev_result: dict | None = None) -> dict:
    """Single GPT call replacing analyze_solution + refine_classification + detect_exam_pattern."""
    if not problem_id:
        return {"problem_id": problem_id, "error": "missing problem_id"}
    return asyncio.run(_unified_analyze(self, problem_id))


async def _unified_analyze(task, problem_id: str) -> dict:
    async with worker_session() as session:
        result = await session.execute(
            select(Problem)
            .where(Problem.id == problem_id)
            .options(selectinload(Problem.choices))
        )
        problem = result.scalar_one_or_none()
        if not problem:
            return {"problem_id": problem_id, "error": "not found"}

        # Build choices text
        choices_text = ""
        if problem.choices:
            sorted_choices = sorted(problem.choices, key=lambda c: c.position)
            lines = [f"{c.label} {c.content_text}" for c in sorted_choices]
            choices_text = "Choices:\n" + "\n".join(lines)

        # Build prompts
        system = SYSTEM_PROMPT.format(curriculum_json=json.dumps(CURRICULUM_TREE, ensure_ascii=False, indent=2))
        user = USER_PROMPT_TEMPLATE.format(
            stem_latex=problem.stem_latex or "",
            stem_text=problem.stem_text or "",
            choices_text=choices_text,
            problem_number=problem.problem_number or "unknown",
            current_subject=problem.subject or "unknown",
            current_unit_major=problem.unit_major or "unknown",
            current_difficulty=problem.difficulty or "unknown",
        )

    # GPT call
    if not settings.ai_api_key:
        logger.warning("No AI API key — returning heuristic fallback for %s", problem_id)
        return _heuristic_fallback(problem_id)

    client = AsyncOpenAI(api_key=settings.ai_api_key, base_url=settings.ai_api_base_url)
    try:
        response = await client.chat.completions.create(
            model=settings.ai_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "unified_analysis",
                    "strict": True,
                    "schema": UnifiedAnalysisResult.model_json_schema(),
                },
            },
            max_completion_tokens=3000,
        )
    except (RateLimitError, APITimeoutError, APIConnectionError) as exc:
        logger.warning("OpenAI API error for %s: %s — retrying", problem_id, exc)
        raise task.retry(exc=exc)

    raw = response.choices[0].message.content
    try:
        parsed = UnifiedAnalysisResult.model_validate_json(raw)
    except Exception:
        logger.warning("Failed to parse unified response for %s, falling back to json.loads", problem_id)
        data = json.loads(raw)
        parsed = UnifiedAnalysisResult.model_validate(data)

    # Validate subject
    if parsed.subject not in SUBJECTS:
        logger.warning("Invalid subject '%s' for %s, keeping as-is", parsed.subject, problem_id)

    # Enforce is_common
    result_dict = parsed.model_dump()
    result_dict["is_common"] = parsed.subject in COMMON_SUBJECTS
    result_dict["problem_id"] = problem_id

    # Clamp difficulty
    result_dict["difficulty_refined"] = max(1.0, min(5.0, result_dict["difficulty_refined"]))

    return result_dict


def _heuristic_fallback(problem_id: str) -> dict:
    """Return minimal results when API key is missing."""
    return {
        "problem_id": problem_id,
        "classification_reasoning": "No API key available",
        "subject": "수학I",
        "unit_major": "",
        "unit_minor": None,
        "unit_sub": None,
        "difficulty_refined": 3.0,
        "is_common": True,
        "classification_confidence": 0.1,
        "solution_strategy": "",
        "required_concepts": [],
        "solution_steps": [],
        "estimated_time_sec": 120,
        "common_mistakes": [],
        "solution_confidence": 0.1,
        "exam_source": None,
    }
```

**Step 2: Register in `__init__.py`**

Add to `apps/ocr-api/app/workers/__init__.py`:
```python
from app.workers.unified_analysis import unified_analysis  # noqa: F401
```

**Step 3: Commit**
```bash
git add apps/ocr-api/app/workers/unified_analysis.py apps/ocr-api/app/workers/__init__.py
git commit -m "feat: add unified_analysis worker — single GPT call replacing 3 workers"
```

---

### Task 7: Rewire analysis pipeline to use unified prompt

**Files:**
- Modify: `apps/ocr-api/app/workers/analysis_pipeline.py:1-69`

**Step 1: Update imports and `start_analysis_pipeline`**

Replace the Stage 1 chord with a single `unified_analysis` task. Keep Stage 2 chain as-is. Add config flag check.

```python
# Replace imports (lines 1-27) — add unified_analysis, config
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
from app.services.redis_events import notify_analysis_completed, notify_analysis_failed
from app.workers.auto_review import auto_review
from app.workers.find_similar import find_similar
from app.workers.generate_embedding import generate_embedding

logger = logging.getLogger(__name__)
```

```python
# Replace start_analysis_pipeline (lines 30-69)
def start_analysis_pipeline(ocr_job_id: str, problem_ids: list[str]) -> str:
    """Kick off AI analysis for a batch of problems.

    Unified mode (default): single GPT call per problem
    Legacy mode: parallel chord of 3 separate GPT calls (analyze_solution + refine + detect)
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

        # Apply deterministic exam rules after GPT (unified or legacy)
        from app.workers.detect_exam_pattern import apply_deterministic_rules
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
```

**Step 2: Extract deterministic exam rules into a separate Celery task**

Add `apply_deterministic_rules` to `detect_exam_pattern.py` — a Celery task that applies the existing `_rules_from_number()` logic and saves to DB. This runs AFTER the unified GPT call, in the Stage 2 chain.

```python
# Add to detect_exam_pattern.py after the existing detect_exam_pattern task

@celery.task(
    bind=True,
    name="task.analysis.apply_exam_rules",
    acks_late=True,
)
def apply_deterministic_rules(self, prev_result: dict | None = None, *, problem_id: str) -> dict:
    """Apply deterministic CSAT exam rules (position_type, point_value, question_format).

    Runs after unified_analysis or legacy merge. Reads problem_number from DB,
    applies rules, and saves to DB.
    """
    return asyncio.run(_apply_rules(problem_id, prev_result or {}))


async def _apply_rules(problem_id: str, prev_result: dict) -> dict:
    async with worker_session() as session:
        result = await session.execute(
            select(Problem).where(Problem.id == problem_id)
        )
        problem = result.scalar_one_or_none()
        if not problem:
            return {**prev_result, "problem_id": problem_id}

        q_num = _parse_question_number(problem.problem_number)
        rules = _rules_from_number(q_num) if q_num else None

        if rules:
            problem.position_type = rules["position_type"]
            problem.point_value = rules["point_value"]
            if not problem.question_format:
                problem.question_format = rules["question_format"]
        elif problem.difficulty_refined:
            d = int(round(problem.difficulty_refined))
            problem.point_value = _point_from_difficulty(d)
            problem.position_type = _position_from_difficulty(problem.difficulty_refined)

        # Save unified analysis results to DB if present in prev_result
        for field in [
            "solution_strategy", "required_concepts", "solution_steps",
            "estimated_time_sec", "common_mistakes", "subject", "unit_major",
            "unit_minor", "unit_sub", "difficulty_refined", "is_common",
            "classification_confidence", "exam_source",
        ]:
            val = prev_result.get(field)
            if val is not None and hasattr(problem, field):
                setattr(problem, field, val)

        # Save solution_confidence as a separate field (or in metadata)
        # For now, keep classification_confidence from prev_result
        problem.analysis_status = AnalysisStatus.analyzing
        await session.commit()

    merged = {**prev_result, "problem_id": problem_id}
    return merged
```

**Step 3: Commit**
```bash
git add apps/ocr-api/app/workers/analysis_pipeline.py apps/ocr-api/app/workers/detect_exam_pattern.py
git commit -m "feat: rewire pipeline to use unified analysis with config flag"
```

---

### Task 8: Auto-trigger analysis after OCR completion

**Files:**
- Modify: `apps/lms-api/src/files/files.service.ts:89-111`

**Step 1: Add auto-trigger after problem creation**

In the `ocr:completed` handler, after `createProblemsFromOcr()`, automatically publish `analysis:request`:

```typescript
// Replace lines 89-111 in files.service.ts
      if (channel === "ocr:completed") {
        const maybeCount = payload.problemCount;
        const job = await this.prisma.ocrJob.update({
          where: { id: payload.ocrJobId },
          data: {
            status: "completed",
            problemCount:
              typeof maybeCount === "number" ? maybeCount : undefined,
            errorMessage: null,
            completedAt: new Date(),
          },
        });

        // Create Problem records from pipeline results
        if (Array.isArray(payload.problems) && payload.problems.length > 0) {
          await this.createProblemsFromOcr(
            payload.ocrJobId!,
            job.sourceFileId,
            payload.problems,
          );

          // AUTO-TRIGGER: Start AI analysis immediately
          const createdProblems = await this.prisma.problem.findMany({
            where: { ocrJobId: payload.ocrJobId },
            select: { id: true },
          });
          const problemIds = createdProblems.map((p) => p.id);
          if (problemIds.length > 0) {
            await this.prisma.problem.updateMany({
              where: { id: { in: problemIds } },
              data: { analysisStatus: "analyzing" },
            });
            await this.redisPublisher.publish(
              "analysis:request",
              JSON.stringify({
                ocrJobId: payload.ocrJobId,
                problemIds,
              }),
            );
            this.logger.log(
              `Auto-triggered analysis for ${problemIds.length} problems (job ${payload.ocrJobId})`,
            );
          }
        }
        return;
      }
```

**Step 2: Commit**
```bash
git add apps/lms-api/src/files/files.service.ts
git commit -m "feat: auto-trigger AI analysis after OCR completion"
```

---

## Phase 3: SSE Real-Time Updates

### Task 9: Add pipeline progress Redis channel from Celery workers

**Files:**
- Modify: `apps/ocr-api/app/services/redis_events.py`

**Step 1: Add `notify_progress` function**

```python
# Add to redis_events.py after notify_analysis_failed

def notify_progress(
    ocr_job_id: str,
    stage: str,
    current: int = 0,
    total: int = 0,
    message: str = "",
) -> None:
    """Publish pipeline progress for real-time SSE updates."""
    publish_sync("pipeline:progress", {
        "ocrJobId": ocr_job_id,
        "stage": stage,
        "current": current,
        "total": total,
        "message": message,
    })
```

**Step 2: Add progress calls to key pipeline stages**

Add `notify_progress()` calls in:
- `apps/ocr-api/app/workers/ocr_submit.py` — after Mathpix submit: `notify_progress(job_id, "ocr_submit")`
- `apps/ocr-api/app/workers/ocr_poll.py` — each poll iteration: `notify_progress(job_id, "ocr_processing", pages_completed, num_pages)`
- `apps/ocr-api/app/workers/parse_results.py` — after parse: `notify_progress(job_id, "parsing")`
- `apps/ocr-api/app/workers/segment_problems.py` — after segment: `notify_progress(job_id, "segmentation", problem_count=N)`
- `apps/ocr-api/app/workers/finalize.py` — on finalize: `notify_progress(job_id, "ocr_complete")`
- `apps/ocr-api/app/workers/analysis_pipeline.py` — in merge_stage1: `notify_progress(job_id, "analyzing", completed, total)`
- `apps/ocr-api/app/workers/analysis_pipeline.py` — in finalize_analysis: `notify_progress(job_id, "analysis_complete")`

Each call is 1-2 lines. Import `notify_progress` and call at the relevant point.

**Step 3: Commit**
```bash
git add apps/ocr-api/app/services/redis_events.py apps/ocr-api/app/workers/
git commit -m "feat: add pipeline:progress events from Celery workers for SSE"
```

---

### Task 10: Create NestJS SSE endpoint

**Files:**
- Create: `apps/lms-api/src/files/files.sse.controller.ts` (or add to existing controller)
- Modify: `apps/lms-api/src/files/files.service.ts` — subscribe to `pipeline:progress`

**Step 1: Add SSE controller**

Create a NestJS `@Sse()` endpoint that streams pipeline progress:

```typescript
// files.sse.controller.ts
import { Controller, Sse, Param, MessageEvent } from "@nestjs/common";
import { Observable, Subject, filter, map } from "rxjs";
import { FilesService } from "./files.service";

@Controller("v1/files")
export class FilesSseController {
  constructor(private readonly filesService: FilesService) {}

  @Sse(":fileId/events")
  events(@Param("fileId") fileId: string): Observable<MessageEvent> {
    return this.filesService.getProgressStream().pipe(
      filter((event) => event.ocrJobId === fileId || event.sourceFileId === fileId),
      map((event) => ({
        data: JSON.stringify(event),
        type: "progress",
      })),
    );
  }
}
```

**Step 2: Add progress stream to FilesService**

In `files.service.ts`, subscribe to `pipeline:progress` channel and push to an RxJS Subject:

```typescript
// Add to FilesService class
private progressSubject = new Subject<{
  ocrJobId: string;
  sourceFileId?: string;
  stage: string;
  current: number;
  total: number;
  message: string;
}>();

getProgressStream() {
  return this.progressSubject.asObservable();
}
```

In `onModuleInit()`, add subscription to `pipeline:progress`:
```typescript
await this.redisSubscriber.subscribe(
  "ocr:completed", "ocr:failed",
  "analysis:completed", "analysis:failed",
  "pipeline:progress",  // NEW
);
```

In `handleOcrPipelineEvent`, add handler:
```typescript
if (channel === "pipeline:progress") {
  this.progressSubject.next(payload as any);
  return;
}
```

**Step 3: Register controller in module, commit**
```bash
git add apps/lms-api/src/files/
git commit -m "feat: add SSE endpoint for real-time pipeline progress"
```

---

### Task 11: Replace frontend polling with SSE

**Files:**
- Modify: `apps/web/src/app/(authenticated)/upload/page.tsx`
- Modify: `apps/web/src/app/(authenticated)/review/page.tsx`

**Step 1: Create a `useSSE` hook**

```typescript
// apps/web/src/hooks/useSSE.ts
import { useEffect, useState, useCallback } from "react";

interface PipelineProgress {
  ocrJobId: string;
  stage: string;
  current: number;
  total: number;
  message: string;
}

export function usePipelineSSE(fileId: string | null) {
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!fileId) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
    const es = new EventSource(`${apiUrl}/v1/files/${fileId}/events`);

    es.onopen = () => setConnected(true);
    es.addEventListener("progress", (e) => {
      const data = JSON.parse(e.data) as PipelineProgress;
      setProgress(data);
    });
    es.onerror = () => setConnected(false);

    return () => es.close();
  }, [fileId]);

  return { progress, connected };
}
```

**Step 2: Replace polling in upload page**

Replace the `setInterval(3000)` polling in the upload page with the `usePipelineSSE` hook. Map `stage` to progress percentage using the table from the design doc.

**Step 3: Replace polling in review page**

Replace `refetchInterval: 3000` in the review page with SSE-triggered refetch. When SSE emits `analysis_complete`, trigger a single refetch.

**Step 4: Commit**
```bash
git add apps/web/src/hooks/useSSE.ts apps/web/src/app/
git commit -m "feat: replace polling with SSE for real-time pipeline progress"
```

---

## Phase 4: Cleanup & Polish

### Task 12: Cache DB engine in worker_session

**Files:**
- Modify: `apps/ocr-api/app/database.py`

**Step 1: Cache the engine instance**

```python
# Replace worker_session in database.py
_cached_engine = None

@asynccontextmanager
async def worker_session():
    global _cached_engine
    if _cached_engine is None:
        _cached_engine = create_async_engine(
            settings.async_database_url,
            poolclass=NullPool,
            echo=False,
        )
    factory = async_sessionmaker(_cached_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
```

**Step 2: Commit**
```bash
git add apps/ocr-api/app/database.py
git commit -m "perf: cache DB engine instance in worker_session"
```

---

### Task 13: Extract shared OpenAI client factory

**Files:**
- Create: `apps/ocr-api/app/services/openai_client.py`
- Modify: `apps/ocr-api/app/workers/unified_analysis.py` — use shared client

**Step 1: Create factory**

```python
# apps/ocr-api/app/services/openai_client.py
"""Shared OpenAI client factory for all workers."""

from openai import AsyncOpenAI
from app.config import settings


def get_openai_client() -> AsyncOpenAI:
    """Create an AsyncOpenAI client from settings."""
    return AsyncOpenAI(
        api_key=settings.ai_api_key,
        base_url=settings.ai_api_base_url,
    )
```

**Step 2: Use in unified_analysis.py — replace inline client creation with `get_openai_client()`**

**Step 3: Commit**
```bash
git add apps/ocr-api/app/services/openai_client.py apps/ocr-api/app/workers/unified_analysis.py
git commit -m "refactor: extract shared OpenAI client factory"
```

---

### Task 14: Remove dead code

**Files:**
- Modify: `apps/ocr-api/app/workers/__init__.py` — remove classify_problems import
- Check: `apps/ocr-api/app/workers/classify_problems.py` — confirm not used in any chain, then delete

**Step 1: Verify classify_problems is dead code**

Search for any references to `classify_problems` in pipeline.py, event_listener.py, or any other file. If none found (expected), delete it.

**Step 2: Remove and commit**
```bash
git rm apps/ocr-api/app/workers/classify_problems.py
git add apps/ocr-api/app/workers/__init__.py
git commit -m "chore: remove dead classify_problems worker"
```

---

### Task 15: Add toast notification on pipeline completion

**Files:**
- Modify: `apps/web/src/app/(authenticated)/upload/page.tsx`

**Step 1: Add sonner/react-hot-toast**

```bash
cd apps/web && pnpm add sonner
```

**Step 2: Show toast when SSE emits `analysis_complete`**

In the upload page component, listen for the `analysis_complete` stage:

```typescript
useEffect(() => {
  if (progress?.stage === "analysis_complete") {
    toast.success("분석 완료! 검수 페이지에서 확인하세요.", {
      action: { label: "검수하기", onClick: () => router.push("/review") },
    });
  }
}, [progress?.stage]);
```

**Step 3: Commit**
```bash
git add apps/web/
git commit -m "feat: add toast notification on pipeline completion"
```

---

## Validation Checklist

After all tasks:
- [ ] PDF upload triggers OCR → AI analysis with zero manual steps
- [ ] `analysis:completed` event includes `problemIds` and NestJS receives them
- [ ] Curriculum tree has correct unit names and no missing topics
- [ ] Unified prompt returns both `classification_confidence` and `solution_confidence`
- [ ] SSE endpoint streams multi-stage progress to frontend
- [ ] Frontend shows continuous 0-100% progress bar (no flickering)
- [ ] Toast notification appears on analysis completion
- [ ] `USE_UNIFIED_ANALYSIS=false` falls back to legacy 3-worker mode
- [ ] Redis fallback queue captures events when no subscribers present
