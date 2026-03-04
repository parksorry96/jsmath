# OCR+AI Pipeline Optimization Design

**Date**: 2026-03-05
**Status**: Pending Approval
**Team**: 5-expert research team (prompt-engineer, ocr-expert, math-expert, ux-expert, code-reviewer)

---

## 1. Problem Statement

Current OCR+AI pipeline has critical UX and performance issues:
- User must manually trigger AI analysis after OCR completion (broken: `analysis:request` listener missing)
- 3 separate OpenAI API calls per problem (~40 calls for 10 problems)
- Polling-based status updates (3s intervals, no real-time feedback)
- `analysis:completed` event payload missing `problemIds` (analysis results never sync to LMS)
- Curriculum taxonomy has errors (wrong unit names, missing topics)

## 2. Goals

1. **One-stop pipeline**: PDF upload → OCR → AI analysis → completion notification (zero manual steps)
2. **API call reduction**: 3 calls/problem → 1 call/problem (67% reduction)
3. **Real-time UX**: SSE-based multi-stage progress (replace polling)
4. **Classification accuracy**: Fix curriculum errors, add misclassification warnings
5. **Bug fixes**: Fix 4 critical bugs discovered during research

## 3. Non-Goals

- Multi-model tiering (GPT-5 Nano / o4-mini) — keep GPT-5 Mini single model
- OpenAI Batch API (24h SLA) — keep real-time processing
- Multi-problem batching in single prompt — risk of cross-contamination
- Redis Streams migration — fallback queue is sufficient for now
- Full schema boundary compliance — accept pragmatic NestJS reads from `ocr.*`

---

## 4. Architecture

### Before
```
PDF Upload → OCR (5 stages) → ✋ Manual trigger → AI Analysis (3 API calls × N problems) → Manual check
                                                    ↑ broken: no listener
```

### After
```
PDF Upload → OCR (5 stages) → Auto AI Analysis (1 API call × N problems) → SSE notification → Smart review
                                └─ unified_analysis (1 GPT call)
                                └─ embedding + similarity (1 API call)
                                └─ auto_review (local computation)
```

### Pipeline Flow
```
NestJS: Upload PDF → S3 → Redis "ocr:submit"
FastAPI: OCR pipeline (submit → poll → parse → segment → finalize)
FastAPI → Redis "ocr:completed" → NestJS creates Problem records
NestJS: Auto-trigger → Redis "analysis:request" (with problemIds)
FastAPI: Analysis pipeline per problem (parallel via Celery group):
  unified_analysis (1 GPT-5 Mini call) + deterministic exam rules
  → generate_embedding (1 OpenAI embedding call)
  → find_similar (pgvector query)
  → auto_review (local composite scoring)
FastAPI → Redis "analysis:completed" (with problemIds) → NestJS updates
NestJS → SSE → Frontend real-time progress
```

### API Call Comparison (10 problems)
| | Before | After |
|--|--------|-------|
| Classification + Solution + Pattern | 30 calls | **10 calls** |
| Embedding | 10 calls | 10 calls |
| **Total** | **~40 calls** | **~20 calls** |
| **Cost/problem** | ~$0.0066 | ~$0.0044 (33% savings) |

---

## 5. Unified Analysis Prompt Design

### 5.1 System Prompt
```
You are a Korean CSAT (수능) math education expert specializing in the 2015 개정교육과정.
You perform comprehensive analysis: curriculum classification AND solution analysis.

IMPORTANT: Classify FIRST, then analyze the solution independently.
Do NOT let solution analysis influence your classification decision.

Available subjects: 수학I, 수학II, 확률과 통계, 미적분, 기하

[Subject details with discriminating rules]

COMMON MISCLASSIFICATION WARNINGS:
- "수열의 극한" / "급수" → 미적분 (NOT 수학I)
- "함수의 극한" (다항함수) → 수학II; (지수/로그/삼각) → 미적분
- "적분" (다항함수만) → 수학II; (삼각/지수 포함) → 미적분
- "지수·로그" + 미분 → 미적분 (NOT 수학I)
- "수열" in probability context → 확률과 통계 (NOT 수학I)

[Difficulty scale with CSAT-specific anchors]
[Curriculum hierarchy JSON]
```

### 5.2 Output Schema (Pydantic Strict)
```python
class UnifiedAnalysis(BaseModel):
    # Classification (FIRST - forces reasoning before deciding)
    classification_reasoning: str
    subject: str  # 수학I | 수학II | 확률과 통계 | 미적분 | 기하
    unit_major: str
    unit_minor: Optional[str] = None
    unit_sub: Optional[str] = None
    difficulty_refined: float  # 1.0-5.0
    is_common: bool
    classification_confidence: float  # 0.0-1.0

    # Solution analysis (SECOND - independent from classification)
    solution_strategy: str
    required_concepts: list[str]
    solution_steps: list[SolutionStep]
    estimated_time_sec: int  # 30-900
    common_mistakes: list[str]
    solution_confidence: float  # 0.0-1.0

    # Exam source identification (LAST - optional)
    exam_source: Optional[ExamSource] = None
```

Key decisions:
- Use `response_format={"type": "json_schema", "strict": True}` (100% schema compliance)
- Separate `classification_confidence` and `solution_confidence` (math-expert unanimous requirement)
- `classification_reasoning` as FIRST field to force chain-of-thought
- `max_completion_tokens=3000`
- Deterministic exam rules (position_type, point_value, question_format) stay in Python

### 5.3 Fallback Strategy
- Config flag: `USE_UNIFIED_ANALYSIS=true` for gradual rollout
- On unified prompt failure: retry once, then fall back to individual 3-call workflow
- A/B validation: run unified vs 3-call on 50+ known problems before production switch

---

## 6. Curriculum Taxonomy Fixes

### Critical Fixes (from math-expert)
1. `"지수와 로그"` → `"지수함수와 로그함수"` (대단원명 오류)
2. Comments: `"2022 Revised Curriculum"` → `"2015 개정교육과정"` (실제 내용은 2015)
3. Add missing topics:
   - 수학I: 상용로그, 일반각과 호도법
   - 수학II: 평균변화율, 정적분과 급수의 관계
   - 확률과 통계: 중복순열, 중복조합, 사건의 독립과 종속
   - 미적분: 매개변수 미분법, 음함수 미분법, 치환적분, 부분적분
   - 기하: 평면벡터의 성분, 정사영

### Auto-Review Improvements
- Add `classification_confidence` + `solution_confidence` dual scoring
- Add discriminating keywords (not just subject keywords)
- Recalibrate difficulty-time ranges (Level 3 lower bound: 120→60s, Level 5 upper: 900→480s)
- Soften killer/semi-killer hardcoding (factor in AI difficulty assessment)

---

## 7. UX Design

### 7.1 Unified Progress Flow
Frontend shows ONE continuous progress bar from upload to analysis completion:

| Stage | Progress | Display Text |
|-------|----------|-------------|
| Upload | 0-20% | "파일 업로드 중..." |
| OCR Submit | 20-25% | "OCR 처리 시작..." |
| OCR Processing | 25-50% | "OCR 처리 중... (페이지 3/15)" |
| Parsing | 50-55% | "결과 파싱 중..." |
| Segmentation | 55-65% | "문제 분할 중..." |
| OCR Finalize | 65-70% | "N개 문제 추출 완료" |
| AI Analysis | 70-90% | "AI 분석 중... (12/15)" |
| Embedding/Similar | 90-95% | "유사문제 검색 중..." |
| Complete | 95-100% | "분석 완료!" |

**No intermediate "completed" state** — prevents flickering (ux-expert concern).

### 7.2 SSE (Server-Sent Events)
Replace all 3s polling with SSE:
- `GET /v1/files/{fileId}/events` — upload + OCR progress
- `GET /v1/problems/events?ocrJobId={id}` — analysis progress
- NestJS `@Sse()` decorator (built-in, no extra libraries)
- Celery workers → Redis `pipeline:progress` channel → NestJS → SSE → browser

### 7.3 Notifications
- **Toast notification** on completion (must-have)
- **Sidebar badge** for pending review count (must-have)
- **Browser notification** when tab unfocused (nice-to-have)

### 7.4 Smart Review Queue
- Sort by confidence ascending (low confidence = needs human attention first)
- Group: "검수 필요" (<0.75) / "확인 권장" (0.75-0.9) / "자동승인" (>0.9)
- Dual confidence display: "분류 92% / 풀이 78%"
- Batch actions: "전체 승인" for high-confidence batch

---

## 8. Critical Bug Fixes (Pre-requisites)

| # | Bug | Fix | Priority |
|---|-----|-----|----------|
| 1 | `analysis:completed` payload missing `problemIds` | Add `problemIds` to `finalize_analysis` Redis event | P0 |
| 2 | `analysis:request` has no consumer (or payload mismatch) | Verify `event_listener.py` handler, fix payload format | P0 |
| 3 | `parse_mathpix_results` creates duplicates on retry | Add upsert by `ocr_job_id + page_number` | P1 |
| 4 | Error messages silently discarded in `_mark_problem_failed()` | Store `error_msg` in problem record | P1 |

---

## 9. Infrastructure Improvements

### 9.1 DB Session Pooling
Cache engine instance with NullPool (Option B from ocr-expert):
```python
_cached_engine = None

@asynccontextmanager
async def worker_session():
    global _cached_engine
    if _cached_engine is None:
        _cached_engine = create_async_engine(url, poolclass=NullPool)
    # ... reuse engine, don't dispose
```

### 9.2 Redis Reliability
- Add subscriber count check in `publish_sync()` — if 0, `LPUSH` to fallback queue
- NestJS periodic job checks fallback queues on startup
- NOT migrating to Redis Streams (overkill for current scale)

### 9.3 Shared OpenAI Client
Extract `get_openai_client() -> AsyncOpenAI` factory — eliminate 5x duplication.

### 9.4 Dead Code Cleanup
- Remove `classify_problems.py` (replaced by `refine_classification`)
- Remove unused `crop_figures.py` functions
- Remove `detect_exam_pattern.py:_default_pattern()`

---

## 10. Migration Plan

### Phase 1: Bug Fixes (Day 1)
- Fix `analysis:completed` payload
- Fix `analysis:request` listener/payload
- Make `parse_mathpix_results` idempotent
- Fix error message storage

### Phase 2: Auto-trigger + Unified Prompt (Day 2-3)
- Create `unified_analysis.py` worker
- Add auto-trigger in NestJS `ocr:completed` handler
- Fix curriculum taxonomy (unit names, missing topics)
- Add `USE_UNIFIED_ANALYSIS` config flag
- A/B validate on 50+ problems

### Phase 3: UX — SSE + Progress (Day 4-5)
- Add `pipeline:progress` Redis channel from Celery workers
- Create NestJS SSE endpoints
- Replace frontend polling with EventSource
- Add multi-stage progress bar
- Add toast notifications + sidebar badge

### Phase 4: Cleanup + Polish (Day 6)
- Remove dead code
- Extract shared OpenAI client
- Cache DB engine
- Add Redis fallback queue
- Smart review queue sorting

---

## 11. Validation Criteria

- [ ] PDF upload → analysis completion with zero manual steps
- [ ] API calls reduced from ~40 to ~20 for 10 problems
- [ ] Frontend shows real-time multi-stage progress via SSE
- [ ] Classification accuracy >= current level (A/B test on 50+ problems)
- [ ] `classification_confidence` and `solution_confidence` separately reported
- [ ] Curriculum taxonomy passes manual review (correct unit names, complete topics)
- [ ] Partial failure recovery: retry only failed problems
- [ ] No flickering in progress UI (continuous 0-100%)
