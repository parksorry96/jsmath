# AI Analysis Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Celery-based AI analysis pipeline that analyzes OCR-extracted math problems (solution strategy, refined classification, difficulty, embeddings, similarity) triggered from the review UI.

**Architecture:** New Celery workers in `apps/ocr-api/app/workers/` handle 2-stage analysis (parallel GPT-4o calls → embedding + similarity + auto-review). NestJS triggers via Redis event, FastAPI processes, results stored in OCR schema and mirrored to LMS schema via Redis events.

**Tech Stack:** Python (Celery, OpenAI SDK, pgvector), PostgreSQL + pgvector, Redis Pub/Sub, NestJS (Prisma), Next.js (review UI trigger)

---

## Task 1: Remove middle school from taxonomy and update to CSAT-only

**Files:**
- Modify: `apps/ocr-api/app/schemas/taxonomy.py`
- Modify: `apps/ocr-api/app/schemas/problem.py`

**Step 1: Update taxonomy.py**

Remove `MIDDLE_MATH` subject entirely. Remove it from `ALL_SUBJECTS`. Update curriculum to match 수능 structure with more detailed topics.

```python
# Remove MIDDLE_MATH entirely
# Update ALL_SUBJECTS to only high school:
ALL_SUBJECTS = (MATH_1, MATH_2, PROB_AND_STAT, CALCULUS, GEOMETRY)
```

**Step 2: Update problem.py constants**

```python
GRADE_LEVELS = ["high_1", "high_2", "high_3"]

SUBJECTS = ["수학I", "수학II", "확률과 통계", "미적분", "기하"]
```

Remove all `middle_*` references from `CURRICULUM_TREE`.

**Step 3: Commit**

```bash
git add apps/ocr-api/app/schemas/taxonomy.py apps/ocr-api/app/schemas/problem.py
git commit -m "refactor: remove middle school math, CSAT-only taxonomy"
```

---

## Task 2: Add new columns to Problem model (SQLAlchemy)

**Files:**
- Modify: `apps/ocr-api/app/models/problem.py`

**Step 1: Add AnalysisStatus enum and new columns**

```python
class AnalysisStatus(str, enum.Enum):
    pending = "pending"
    analyzing = "analyzing"
    completed = "completed"
    failed = "failed"

class QuestionFormat(str, enum.Enum):
    multiple_choice_5 = "multiple_choice_5"  # 5지선다
    short_answer = "short_answer"  # 단답형

class PositionType(str, enum.Enum):
    normal = "normal"
    semi_killer = "semi_killer"  # 준킬러
    killer = "killer"  # 킬러
```

Add to `Problem` class:

```python
    # CSAT-specific metadata
    is_common: Mapped[bool | None] = mapped_column(default=True)  # 공통 vs 선택
    point_value: Mapped[int | None] = mapped_column(SmallInteger)  # 2, 3, 4
    question_format: Mapped[QuestionFormat | None] = mapped_column()
    position_type: Mapped[PositionType | None] = mapped_column()
    exam_source: Mapped[dict | None] = mapped_column(JSONB)  # {"year","month","type","number"}

    # AI analysis results
    solution_strategy: Mapped[str | None] = mapped_column(Text)
    required_concepts: Mapped[list | None] = mapped_column(JSONB)
    solution_steps: Mapped[list | None] = mapped_column(JSONB)
    estimated_time_sec: Mapped[int | None] = mapped_column(Integer)
    common_mistakes: Mapped[list | None] = mapped_column(JSONB)
    difficulty_refined: Mapped[float | None] = mapped_column(Float)
    analysis_status: Mapped[AnalysisStatus] = mapped_column(default=AnalysisStatus.pending)
    analyzed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
```

**Step 2: Commit**

```bash
git add apps/ocr-api/app/models/problem.py
git commit -m "feat: add CSAT metadata and AI analysis columns to Problem model"
```

---

## Task 3: Create ProblemSimilarity model

**Files:**
- Create: `apps/ocr-api/app/models/similarity.py`
- Modify: `apps/ocr-api/app/models/__init__.py`

**Step 1: Create similarity.py**

```python
"""Problem similarity tracking — stores vector similarity results."""

from __future__ import annotations

import enum

from sqlalchemy import Float, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin


class SimilarityType(str, enum.Enum):
    content = "content"      # text/LaTeX similarity
    concept = "concept"      # shared concepts
    structure = "structure"  # similar problem structure


class ProblemSimilarity(Base, TimestampMixin):
    __tablename__ = "problem_similarities"

    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    problem_id: Mapped[str] = mapped_column(
        ForeignKey("problems.id"), nullable=False
    )
    similar_problem_id: Mapped[str] = mapped_column(
        ForeignKey("problems.id"), nullable=False
    )
    similarity_score: Mapped[float] = mapped_column(Float, nullable=False)
    similarity_type: Mapped[SimilarityType] = mapped_column(nullable=False)

    problem: Mapped["Problem"] = relationship(foreign_keys=[problem_id])
    similar_problem: Mapped["Problem"] = relationship(foreign_keys=[similar_problem_id])

    __table_args__ = (
        UniqueConstraint("problem_id", "similar_problem_id", name="uq_problem_similarity"),
        Index("ix_similarity_problem", "problem_id"),
        Index("ix_similarity_score", "similarity_score"),
    )
```

**Step 2: Update `__init__.py`**

Add import:
```python
from .similarity import ProblemSimilarity, SimilarityType  # noqa: F401
```

**Step 3: Commit**

```bash
git add apps/ocr-api/app/models/similarity.py apps/ocr-api/app/models/__init__.py
git commit -m "feat: add ProblemSimilarity model for vector search results"
```

---

## Task 4: Create Alembic migration for new columns and table

**Files:**
- Create: `apps/ocr-api/alembic/versions/xxxx_add_analysis_columns.py` (auto-generated)

**Step 1: Generate migration**

```bash
cd apps/ocr-api && .venv/bin/alembic revision --autogenerate -m "add_analysis_columns_and_similarity_table"
```

**Step 2: Review and run migration**

```bash
cd apps/ocr-api && .venv/bin/alembic upgrade head
```

**Step 3: Commit**

```bash
git add apps/ocr-api/alembic/
git commit -m "feat: migration for analysis columns and similarity table"
```

---

## Task 5: Mirror schema changes in Prisma (LMS side)

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`
- Modify: `packages/shared-types/src/index.ts`

**Step 1: Add columns to Prisma Problem model**

```prisma
  // CSAT-specific
  isCommon             Boolean?      @map("is_common")
  pointValue           Int?          @db.SmallInt @map("point_value")
  questionFormat       String?       @map("question_format")
  positionType         String?       @map("position_type")
  examSource           Json?         @map("exam_source")

  // AI analysis
  solutionStrategy     String?       @map("solution_strategy")
  requiredConcepts     Json?         @map("required_concepts")
  solutionSteps        Json?        @map("solution_steps")
  estimatedTimeSec     Int?          @map("estimated_time_sec")
  commonMistakes       Json?         @map("common_mistakes")
  difficultyRefined    Float?        @map("difficulty_refined")
  analysisStatus       String        @default("pending") @map("analysis_status")
  analyzedAt           DateTime?     @map("analyzed_at")
```

Add `ProblemSimilarity` model:

```prisma
model ProblemSimilarity {
  id                String   @id @default(cuid())
  problemId         String   @map("problem_id")
  similarProblemId  String   @map("similar_problem_id")
  similarityScore   Float    @map("similarity_score")
  similarityType    String   @map("similarity_type")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  @@unique([problemId, similarProblemId])
  @@index([problemId])
  @@map("problem_similarities")
}
```

**Step 2: Update shared-types**

Add to `packages/shared-types/src/index.ts`:

```typescript
export type AnalysisStatus = "pending" | "analyzing" | "completed" | "failed";
export type QuestionFormat = "multiple_choice_5" | "short_answer";
export type PositionType = "normal" | "semi_killer" | "killer";

// Remove middle school from GradeLevel
export type GradeLevel = "high_1" | "high_2" | "high_3";

export type CsatSubject = "수학I" | "수학II" | "확률과 통계" | "미적분" | "기하";

export interface ExamSource {
  year: number;
  month: number;
  type: "수능" | "모의평가" | "학력평가";
  number?: number;
}

export interface SolutionStep {
  step: number;
  description: string;
  concept: string;
}

// Add to Problem interface:
// isCommon, pointValue, questionFormat, positionType, examSource
// solutionStrategy, requiredConcepts, solutionSteps, estimatedTimeSec
// commonMistakes, difficultyRefined, analysisStatus, analyzedAt

export interface ProblemSimilarity {
  id: string;
  problemId: string;
  similarProblemId: string;
  similarityScore: number;
  similarityType: "content" | "concept" | "structure";
}

// Redis events
export interface AnalysisRequestPayload {
  ocrJobId: string;
  problemIds: string[];
}

export interface AnalysisCompletedPayload {
  ocrJobId: string;
  analyzedCount: number;
  autoApprovedCount: number;
}
```

**Step 3: Run Prisma generate**

```bash
pnpm --filter @jsmath/db-schema db:generate
```

**Step 4: Commit**

```bash
git add packages/db-schema/prisma/schema.prisma packages/shared-types/src/index.ts
git commit -m "feat: mirror analysis schema in Prisma and shared types"
```

---

## Task 6: Create Stage 1 worker — analyze_solution

**Files:**
- Create: `apps/ocr-api/app/workers/analyze_solution.py`

**Step 1: Implement analyze_solution Celery task**

This worker calls GPT-4o with structured output to analyze:
- `solution_strategy`: text explanation of how to solve
- `required_concepts`: list of math concepts needed
- `solution_steps`: ordered steps with concepts
- `estimated_time_sec`: estimated solve time
- `common_mistakes`: typical errors students make

Prompt should include the full problem text (stem + choices) and ask for JSON output.

**Step 2: Commit**

```bash
git add apps/ocr-api/app/workers/analyze_solution.py
git commit -m "feat: add analyze_solution Celery worker (GPT-4o)"
```

---

## Task 7: Create Stage 1 worker — refine_classification

**Files:**
- Create: `apps/ocr-api/app/workers/refine_classification.py`

**Step 1: Implement refine_classification Celery task**

Re-classifies with CSAT-only taxonomy (no middle school). Uses the updated `CURRICULUM_TREE` and `SUBJECTS`. Also determines:
- `difficulty_refined`: float 1.0-5.0
- Verifies/corrects subject and unit assignments
- Sets `is_common` based on whether subject is 수학I/수학II or elective

**Step 2: Commit**

```bash
git add apps/ocr-api/app/workers/refine_classification.py
git commit -m "feat: add refine_classification Celery worker"
```

---

## Task 8: Create Stage 1 worker — detect_exam_pattern

**Files:**
- Create: `apps/ocr-api/app/workers/detect_exam_pattern.py`

**Step 1: Implement detect_exam_pattern Celery task**

Analyzes problem to determine:
- `exam_source`: if it matches a known 수능/모의평가 pattern, populate year/month/type/number
- `position_type`: normal / semi_killer / killer based on difficulty and structure
- `point_value`: estimated 2/3/4 points based on problem complexity
- `question_format`: multiple_choice_5 or short_answer

Uses GPT-4o with structured output including CSAT exam structure context.

**Step 2: Commit**

```bash
git add apps/ocr-api/app/workers/detect_exam_pattern.py
git commit -m "feat: add detect_exam_pattern Celery worker"
```

---

## Task 9: Create Stage 2 worker — generate_embedding

**Files:**
- Create: `apps/ocr-api/app/workers/generate_embedding.py`

**Step 1: Implement generate_embedding Celery task**

Combines `stem_text` + choices text + `solution_strategy` (from Stage 1) into a single string. Calls OpenAI `text-embedding-3-small` to get 1536-dim vector. Stores in `Problem.embedding` column via pgvector.

**Step 2: Commit**

```bash
git add apps/ocr-api/app/workers/generate_embedding.py
git commit -m "feat: add generate_embedding Celery worker (OpenAI embeddings)"
```

---

## Task 10: Create Stage 2 worker — find_similar_problems

**Files:**
- Create: `apps/ocr-api/app/workers/find_similar.py`

**Step 1: Implement find_similar Celery task**

After embedding is stored, query pgvector for top-10 similar problems using cosine distance:
```sql
SELECT id, 1 - (embedding <=> :query_embedding) AS score
FROM ocr.problems
WHERE id != :problem_id AND embedding IS NOT NULL
ORDER BY embedding <=> :query_embedding
LIMIT 10
```

Store results in `problem_similarities` table with `similarity_type = 'content'`.

**Step 2: Commit**

```bash
git add apps/ocr-api/app/workers/find_similar.py
git commit -m "feat: add find_similar Celery worker (pgvector cosine search)"
```

---

## Task 11: Create Stage 2 worker — auto_review

**Files:**
- Create: `apps/ocr-api/app/workers/auto_review.py`

**Step 1: Implement auto_review Celery task**

Cross-validates all Stage 1 + Stage 2 results:
1. Subject/unit matches solution_strategy concepts
2. Difficulty correlates with estimated_time_sec
3. Similar problems share same subject/unit (if any found)
4. All required fields populated

Decision logic:
- All checks pass AND avg confidence > 0.85 → `review_status = auto_approved`
- Otherwise → stays `pending_review`

Updates `analysis_status = completed` and `analyzed_at = now()`.

**Step 2: Commit**

```bash
git add apps/ocr-api/app/workers/auto_review.py
git commit -m "feat: add auto_review Celery worker"
```

---

## Task 12: Create analysis pipeline orchestrator

**Files:**
- Create: `apps/ocr-api/app/workers/analysis_pipeline.py`
- Modify: `apps/ocr-api/app/workers/__init__.py`

**Step 1: Implement start_analysis_pipeline**

Orchestrates the 2-stage pipeline using Celery `chord` (parallel) + `chain` (sequential):

```python
from celery import chain, chord, group

def start_analysis_pipeline(ocr_job_id: str, problem_ids: list[str]) -> str:
    """2-stage analysis pipeline per problem."""
    workflows = []
    for pid in problem_ids:
        stage1 = group(
            analyze_solution.s(problem_id=pid),
            refine_classification.s(problem_id=pid),
            detect_exam_pattern.s(problem_id=pid),
        )
        stage2 = chain(
            generate_embedding.s(problem_id=pid),
            find_similar.s(problem_id=pid),
            auto_review.s(problem_id=pid),
        )
        workflow = chain(chord(stage1, merge_stage1_results.s(problem_id=pid)), stage2)
        workflows.append(workflow)

    # Run all problem analyses in parallel
    result = group(workflows).apply_async()
    return result.id
```

Also create a `merge_stage1_results` task that combines the 3 parallel results and saves to DB.

**Step 2: Update `__init__.py` with new worker imports**

**Step 3: Commit**

```bash
git add apps/ocr-api/app/workers/analysis_pipeline.py apps/ocr-api/app/workers/__init__.py
git commit -m "feat: add analysis pipeline orchestrator with chord+chain"
```

---

## Task 13: Add Redis event listener for analysis:request

**Files:**
- Modify: `apps/ocr-api/app/services/redis_events.py`
- Modify: `apps/ocr-api/app/services/event_listener.py`

**Step 1: Add new channels**

Add to `redis_events.py`:
- `notify_analysis_completed(ocr_job_id, analyzed_count, auto_approved_count)`
- `notify_analysis_failed(ocr_job_id, reason)`

**Step 2: Add listener for `analysis:request` channel**

In `event_listener.py`, subscribe to `analysis:request` and call `start_analysis_pipeline` when received.

**Step 3: Commit**

```bash
git add apps/ocr-api/app/services/redis_events.py apps/ocr-api/app/services/event_listener.py
git commit -m "feat: add analysis:request Redis event listener"
```

---

## Task 14: Add NestJS analysis trigger endpoint

**Files:**
- Modify: `apps/lms-api/src/problems/problems.controller.ts`
- Modify: `apps/lms-api/src/problems/problems.service.ts`

**Step 1: Add POST /problems/analyze endpoint**

Accepts `{ ocrJobId: string, problemIds?: string[] }`. If problemIds not provided, analyze all problems in the job. Publishes Redis event `analysis:request`.

**Step 2: Add analysis status query**

Add `analysisStatus` filter to the existing `findAll` query.
Add `GET /problems/:id/analysis` endpoint that returns full analysis results including similar problems.

**Step 3: Commit**

```bash
git add apps/lms-api/src/problems/
git commit -m "feat: add analysis trigger and status endpoints in NestJS"
```

---

## Task 15: Add "AI 분석" button to review UI

**Files:**
- Modify: `apps/web/src/app/(authenticated)/review/page.tsx`

**Step 1: Add analysis trigger button**

Add "AI 분석 시작" button that calls `POST /problems/analyze`. Show loading state while `analysis_status === 'analyzing'`. Display results (solution strategy, difficulty, similar problems) when completed.

**Step 2: Show analysis results in problem detail**

Display: solution_strategy, required_concepts, difficulty_refined, estimated_time_sec, similar problems list with scores.

**Step 3: Commit**

```bash
git add apps/web/src/app/(authenticated)/review/page.tsx
git commit -m "feat: add AI analysis trigger and results display in review UI"
```

---

## Dependency Graph

```
Task 1 (taxonomy) ──┐
Task 2 (columns)  ──┤
Task 3 (similarity)─┤── Task 4 (migration) ── Task 5 (Prisma)
                    │
                    ├── Task 6 (analyze_solution)  ─┐
                    ├── Task 7 (refine_class)       ├── Task 12 (orchestrator)
                    ├── Task 8 (exam_pattern)       │
                    ├── Task 9 (embedding)      ────┤
                    ├── Task 10 (find_similar)  ────┤
                    └── Task 11 (auto_review)   ────┘
                                                    │
                    Task 13 (Redis events) ─────────┤
                    Task 14 (NestJS API)    ────────┤
                    Task 15 (Review UI)     ────────┘
```

**Parallel tracks:**
- Track A: Tasks 1-5 (schema changes) — must be done first
- Track B: Tasks 6-12 (workers) — can parallelize 6/7/8 and 9/10/11
- Track C: Tasks 13-15 (integration) — after Track A+B

## Team Assignment

| Task | Assignee | Agent Type |
|------|----------|-----------|
| 1, 7, 8 | CSAT Math Expert | math-intelligence |
| 6, 9, 11, 12 | AI Expert | math-intelligence |
| 2, 3, 4, 5, 10 | Vector DB Expert | db-architect |
| 13, 14, 15 | OCR Expert | ocr-pipeline |
