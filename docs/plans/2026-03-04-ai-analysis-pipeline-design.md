# AI Problem Analysis Pipeline Design

## Overview

After OCR extraction, teachers trigger AI analysis from the review UI.
AI analyzes each math problem for solution strategy, classification refinement,
difficulty scoring, and embedding generation. Results are stored for:
- Automated test paper generation
- Similar problem search (vector similarity)
- Student weakness analysis and personalized recommendations

## Scope: 수능 Math Only

No middle school content. Five subjects only:

| Subject | Type | Korean |
|---------|------|--------|
| math1 | Common | 수학I |
| math2 | Common | 수학II |
| calculus | Elective | 미적분 |
| probability_statistics | Elective | 확률과 통계 |
| geometry | Elective | 기하 |

## Curriculum Taxonomy (2015 개정교육과정)

### 수학I (Common)
- 지수함수와 로그함수
  - 지수와 로그의 뜻과 성질
  - 지수함수와 로그함수의 그래프
  - 지수함수와 로그함수의 활용
- 삼각함수
  - 삼각함수의 뜻과 그래프
  - 삼각함수의 활용 (덧셈정리, 배각, 반각)
  - 사인법칙과 코사인법칙
- 수열
  - 등차수열과 등비수열
  - 수열의 합
  - 수학적 귀납법

### 수학II (Common)
- 함수의 극한과 연속
  - 함수의 극한
  - 함수의 연속
- 미분
  - 미분계수와 도함수
  - 도함수의 활용 (접선, 증감, 극값)
  - 방정식과 부등식에의 활용
- 적분
  - 부정적분과 정적분
  - 정적분의 활용 (넓이, 속도)

### 미적분 (Elective)
- 수열의 극한
  - 수열의 극한 (수렴·발산)
  - 급수
- 미분법
  - 여러 가지 함수의 미분 (삼각·지수·로그)
  - 여러 가지 미분법 (합성, 매개변수, 음함수)
  - 도함수의 활용
- 적분법
  - 여러 가지 적분법 (치환, 부분적분)
  - 정적분의 활용

### 확률과 통계 (Elective)
- 경우의 수
  - 순열과 조합
  - 이항정리
  - 분할과 중복조합
- 확률
  - 확률의 뜻과 활용
  - 조건부확률
  - 독립시행
- 통계
  - 확률분포 (이산, 연속)
  - 정규분포
  - 통계적 추정

### 기하 (Elective)
- 이차곡선
  - 포물선, 타원, 쌍곡선
  - 이차곡선과 직선
- 평면벡터
  - 벡터의 연산
  - 벡터의 내적
- 공간도형과 공간좌표
  - 공간도형
  - 공간좌표

## 수능 Exam Structure

- Total: 30 questions, 100 points, 100 minutes
- Common (수학I + 수학II): 22 questions, 74 points
- Elective (택1): 8 questions, 26 points
- Formats: 5지선다 (multiple choice) + 단답형 (short answer)
- Point values: 2, 3, or 4 points per question
- Killer questions: typically #21 (common), #29-30 (elective)

## Pipeline Architecture

### Trigger
Teacher clicks "AI 분석" button in review UI for a specific OCR job or problem batch.

### Flow
```
NestJS → Redis event (analysis:request) → FastAPI Celery

Stage 1 (parallel, GPT-4o):
├── analyze_solution     → solution_strategy, required_concepts, solution_steps,
│                          estimated_time_sec, common_mistakes
├── refine_classification → subject, unit verification, difficulty_refined (1.0-5.0)
└── detect_exam_pattern  → exam_source matching, position_type (normal/semi_killer/killer)

Stage 2 (depends on Stage 1):
├── generate_embedding   → stem + choices + strategy → OpenAI text-embedding-3-small → Vector(1536)
├── find_similar         → pgvector cosine similarity top-K
└── auto_review          → cross-validate all results → auto_approve if confidence > 0.85
```

### Inter-service Communication
- NestJS → FastAPI: Redis event `analysis:request` with `{ocrJobId, problemIds}`
- FastAPI → NestJS: Redis event `analysis:completed` with results
- FastAPI → NestJS: Redis event `analysis:failed` with error info

## DB Schema Changes

### Problem table extensions (ocr.problems)
```sql
-- CSAT-specific metadata
ALTER TABLE ocr.problems ADD COLUMN is_common BOOLEAN DEFAULT TRUE;
ALTER TABLE ocr.problems ADD COLUMN point_value INTEGER;  -- 2, 3, 4
ALTER TABLE ocr.problems ADD COLUMN question_format VARCHAR(20);  -- multiple_choice_5, short_answer
ALTER TABLE ocr.problems ADD COLUMN position_type VARCHAR(20);  -- normal, semi_killer, killer
ALTER TABLE ocr.problems ADD COLUMN exam_source JSONB;  -- {"year":2025,"month":11,"type":"수능","number":21}

-- AI analysis results
ALTER TABLE ocr.problems ADD COLUMN solution_strategy TEXT;
ALTER TABLE ocr.problems ADD COLUMN required_concepts JSONB;  -- ["concept1", "concept2"]
ALTER TABLE ocr.problems ADD COLUMN solution_steps JSONB;     -- [{step, description, concept}]
ALTER TABLE ocr.problems ADD COLUMN estimated_time_sec INTEGER;
ALTER TABLE ocr.problems ADD COLUMN common_mistakes JSONB;    -- ["mistake1", "mistake2"]
ALTER TABLE ocr.problems ADD COLUMN difficulty_refined FLOAT;  -- 1.0 ~ 5.0
ALTER TABLE ocr.problems ADD COLUMN analysis_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE ocr.problems ADD COLUMN analyzed_at TIMESTAMP;
```

### New table: problem_similarities (ocr schema)
```sql
CREATE TABLE ocr.problem_similarities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  problem_id UUID NOT NULL REFERENCES ocr.problems(id),
  similar_problem_id UUID NOT NULL REFERENCES ocr.problems(id),
  similarity_score FLOAT NOT NULL,  -- 0.0 ~ 1.0
  similarity_type VARCHAR(20) NOT NULL,  -- content, concept, structure
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(problem_id, similar_problem_id)
);
CREATE INDEX idx_similarity_problem ON ocr.problem_similarities(problem_id);
CREATE INDEX idx_similarity_score ON ocr.problem_similarities(similarity_score DESC);
```

### Prisma schema mirror (lms schema)
Mirror the same columns in lms.Problem for NestJS access.

## Auto-Review Logic

AI cross-validates:
1. Subject/unit classification matches solution strategy concepts
2. Difficulty correlates with estimated solve time
3. Similar problems (by embedding) share same subject/unit
4. All required fields are populated

Decision:
- confidence > 0.85 AND all checks pass → `auto_approved`
- confidence > 0.85 BUT some checks fail → `pending_review` with flags
- confidence <= 0.85 → `pending_review`

## AI Model Usage

- All analysis: OpenAI GPT-4o (structured output / JSON mode)
- Embeddings: OpenAI text-embedding-3-small (1536 dimensions)
- No model abstraction layer needed (GPT-4o only)

## Implementation Team

| Role | Agent Type | Responsibility |
|------|-----------|----------------|
| OCR Expert | ocr-pipeline | Celery workers, pipeline integration |
| CSAT Math Expert | math-intelligence | Taxonomy, prompt engineering, validation |
| AI Expert | math-intelligence | OpenAI integration, embedding, auto-review |
| Vector DB Expert | db-architect | pgvector setup, similarity search, schema migration |
