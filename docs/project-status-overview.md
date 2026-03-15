# JSMath 프로젝트 현황 통합 문서

> 작성일: 2026-03-14
> 브랜치: `feat/ai-analysis-pipeline`
> 기준: 계획 문서 13개 + 실제 코드베이스 전수 분석

---

## 1. 프로젝트 개요

**JSMath**는 수학 문제은행 + OCR + LMS 통합 플랫폼으로, 학원(학교) 선생님이 교재를 스캔하면 AI가 자동으로 문제를 인식·분류·분석하고, 학생에게 과제·시험·학습 경험을 제공하는 시스템이다.

### 아키텍처

| 레이어 | 기술 | 경로 | 포트 |
|--------|------|------|------|
| Web Frontend | Next.js 15 (App Router) | `apps/web` | :3000 |
| Mobile | React Native (Expo) | `apps/mobile` | — |
| LMS Backend | NestJS | `apps/lms-api` | :3001 |
| OCR/AI Backend | FastAPI + Celery | `apps/ocr-api` | :8000 |
| DB | PostgreSQL 16 + pgvector | — | :5432 |
| Queue | Redis (BullMQ + Celery) | — | :6379 |
| Storage | AWS S3 | — | — |
| OCR | Mathpix API | — | — |
| AI | OpenAI API (GPT-4o) + Anthropic Claude | — | — |

### 모노레포 구조

```
jsmath/
├── apps/
│   ├── web/          — Next.js 프론트엔드
│   ├── lms-api/      — NestJS 백엔드
│   ├── ocr-api/      — FastAPI + Celery 백엔드
│   └── mobile/       — React Native (Expo) 모바일
├── packages/
│   ├── db-schema/    — Prisma 스키마 + 마이그레이션
│   └── shared-types/ — 공유 TypeScript 타입
└── docs/             — 계획서 + 로드맵
```

---

## 2. 기능별 구현 현황

### 범례
- ✅ **완료** — 코드 구현 + 커밋 완료
- 🔧 **부분 구현** — 핵심 로직은 있으나 일부 미완성
- ❌ **미구현** — 계획만 존재, 코드 없음

---

### Phase 0: 인프라 기반 (Foundation)

| 기능 | 상태 | 설명 |
|------|------|------|
| 모노레포 스캐폴딩 | ✅ | pnpm workspace + Turborepo |
| PostgreSQL + pgvector | ✅ | Docker Compose, HNSW 인덱스 |
| Redis (BullMQ + Celery) | ✅ | 큐 + Pub/Sub |
| JWT 인증 + RBAC | ✅ | `auth` 모듈, `teacher`/`student`/`parent`/`admin` 역할 |
| 사용자/조직 API | ✅ | `users`, `organizations` 모듈 |
| Rate Limiting Guard | ✅ | `auth-rate-limit.guard.ts` |

---

### Phase 1: 문제은행 핵심 (Question Bank Core)

| ID | 기능 | 상태 | 구현 내용 |
|----|------|------|-----------|
| — | OCR 파이프라인 (시험지) | ✅ | Mathpix 연동 → 페이지 세그멘테이션 → 문제 분리 → 선택지 파싱 → 정답 매칭 → 최종화 |
| — | OCR 파이프라인 (교과서/EBS) | ✅ | 섹션 감지 → 교과서 세그멘테이션 → 한눈에 보는 정답 파싱 → 아이템 코드 인식 |
| — | AI 분석 파이프라인 | ✅ | unified_analysis (단일 GPT 호출로 분류+풀이+난이도 통합), 또는 개별 워커 모드 |
| — | 풀이 분석 (analyze_solution) | ✅ | GPT-4o로 단계별 풀이 생성 |
| — | 분류 보정 (refine_classification) | ✅ | 과목/단원/유형 AI 재분류 |
| — | 수능 패턴 감지 (detect_exam_pattern) | ✅ | 출제 패턴 + 오답률 분석 |
| — | 임베딩 생성 (generate_embedding) | ✅ | OpenAI text-embedding-3-small, pgvector 저장 |
| — | 유사 문제 검색 (find_similar) | ✅ | pgvector cosine distance |
| — | 자동 검수 (auto_review) | ✅ | 규칙 기반 자동 승인/반려 |
| — | 검수 UI (review page) | ✅ | 문제별 검수, LaTeX 렌더링, 승인/수정/반려 |
| — | 문제 목록/필터링 | ✅ | 과목/단원/난이도/유형/검수상태 필터 |
| — | SSE 실시간 진행률 | ✅ | pipeline:progress 이벤트, SSE 엔드포인트 |
| — | 파일 업로드 + S3 | ✅ | 시험지/교과서 업로드, S3 저장 |
| — | 수업/반 관리 | ✅ | `classes`, `lessons` 모듈 |
| — | 수강 등록 | ✅ | `enrollments` 모듈 |
| — | 과제 관리 | ✅ | `assignments` 모듈, 문제 배정 |
| — | 제출/채점 | ✅ | `submissions` 모듈, 자동 채점 |
| — | 알림 시스템 | ✅ | `notifications` 모듈 |
| — | 시험지 생성기 (Exam Builder) | ✅ | LaTeX → PDF 변환, 표지/본문/답안지/워크북 템플릿 |
| — | 사진 채점 | ✅ | Claude Vision으로 학생 답안 사진 분석 |

---

### Phase 1 확장: 문제은행 고도화 (Question Bank Enhancement)

| ID | 기능 | 상태 | 구현 내용 |
|----|------|------|-----------|
| 1-1 | 2015+2022 이중 교육과정 매핑 | ✅ | `CurriculumNode` 테이블, 시드 데이터, API, 문제 자동 연결 |
| 1-2 | 6단계 난이도 체계 | ✅ | 1-5 → 1-6 확장 (기초/쉬움/보통/약간 어려움/어려움/최상) |
| 1-3 | 수능/모의고사 출처 태깅 | ✅ | examSource JSON 필터, 연도/월/유형 필터 UI |
| 1-4 | 시맨틱 문제 검색 | ✅ | OpenAI 임베딩 → pgvector cosine search, 키워드/의미 검색 토글 |
| 1-5 | 풀이 전략 태깅 | ✅ | solutionTags JSON 배열, 24개 표준 태그, AI 자동 태깅 |
| 1-6 | OCR 파이프라인 커리큘럼 연결 | ✅ | finalize 시 curriculum_node_id 자동 설정 |
| 1-7 | 프론트엔드 교육과정 필터 | ✅ | 캐스케이딩 트리 필터 (교육과정 연도 → 과목 → 대단원 → 소단원) |

---

### Phase 2: 학생 학습 경험 (Student Learning Experience)

| ID | 기능 | 상태 | 구현 내용 |
|----|------|------|-----------|
| 2-1 | 자동 오답 노트 | ✅ | `wrong-answers` 모듈, 자동 수집 + 오류 분류 (개념/패턴/계산/실수), 필터링 UI |
| 2-2 | 숙달도 기반 진행 | ✅ | `mastery` 모듈, 커리큘럼 트리별 연속 정답 추적, 상태 관리 (미시작/학습중/연습중/숙달) |
| 2-3 | 단계별 풀이 표시 | ✅ | `SolutionViewer` 컴포넌트, LaTeX 렌더링, 다중 풀이법 |
| 2-4 | 자동 보정 과제 생성 | ✅ | `remediation` 모듈, pgvector 유사 문제로 맞춤형 과제 자동 생성 |
| 2-5 | SM-2 간격 반복 | ✅ | `ReviewSchedule` 모델, SM-2 알고리즘, 일일 복습 페이지 |

**프론트엔드 페이지:** `/wrong-answers`, `/mastery`, `/review-daily`
**모바일 화면:** 학생 오답노트, 숙달도, 일일복습

---

### Phase 3: AI 강화 + 분석 (AI Enhancement)

| ID | 기능 | 상태 | 구현 내용 |
|----|------|------|-----------|
| 3-1 | 적응형 진단 평가 | ✅ | `diagnostics` 모듈, IRT(1PL Rasch) 엔진, 능력 추정 + 주제별 프로필, 웹 UI |
| 3-2 | 지식 그래프 약점 분석 | ✅ | `KnowledgeGraphService`, 선수학습 DAG, BFS 역추적 알고리즘 |
| 3-3 | 소크라테스식 AI 튜터 | ✅ | `tutor` 모듈, GPT-4o 스트리밍 채팅, 힌트 3단계 (관찰→방향→마지막 힌트) |
| 3-4 | SmartScore 가중 채점 | ✅ | 난이도/일관성/연속정답 가중치, 추측 방지 |
| 3-5 | AI 변형 문제 생성 | ✅ | twin-problem 서비스, 난이도 조절 파라미터 |
| 3-6 | AI 서술형 부분 점수 | ✅ | `rubric_grader` 워커, Claude Vision으로 루브릭 기반 채점 |

**프론트엔드 페이지:** `/diagnostics`, `/knowledge-graph`, `/tutor`

---

### Phase 4: 운영 + 확장 (Operations & Expansion)

| ID | 기능 | 상태 | 구현 내용 |
|----|------|------|-----------|
| 4-1 | 학부모 대시보드 강화 | ✅ | `parent-analytics` 모듈, 주간 리포트 자동 생성, BullMQ 스케줄러 |
| 4-2 | 등급컷 관리 / 성적 예측 | ✅ | `grade-prediction` 모듈, 모의고사 → 수능 등급 변환, 추세 기반 예측 |
| 4-3 | 게이미피케이션 | ✅ | `gamification` 모듈, XP/스트릭/뱃지/업적/반별 리더보드 |
| 4-4 | 실시간 수업 모니터링 | ✅ | `class-monitor` 모듈, WebSocket 게이트웨이 |
| 4-5 | 학원 운영 관리 | ✅ | `operations` 모듈, 출석/청구/결제/상담 관리 |
| 4-6 | LTI/QTI 표준 연동 | ✅ | `integrations` 모듈, QTI 3.0 내보내기/가져오기, LTI 1.3 Advantage 연동 |

**프론트엔드 페이지:** `/parent-reports`, `/grade-prediction`, `/achievements`, `/class-monitor`, `/operations`, `/integrations`
**모바일 화면:** 학부모 대시보드/주간리포트, 학생 업적, 캘린더

---

### Phase 1.5: 품질 안정화 (Quality & Stability Layer)

| ID | 기능 | 상태 | 설명 |
|----|------|------|------|
| 1 | Redis Pub/Sub → Streams 마이그레이션 | ❌ | 메시지 유실 방지를 위한 Redis Streams 전환 |
| 2 | 파이프라인 멱등성 + DLQ | ❌ | 중복 처리 방지, Dead Letter Queue |
| 3 | 문제 리비전 추적 | ❌ | 편집 시 원본 OCR 데이터 보존 |
| 4 | 문제 이미지 크롭 최적화 | ❌ | crop_figures 워커 성능 개선 |
| 5 | 아이템 분석 통계 | ❌ | 변별도, 난이도 사후 분석 |
| 6 | tsvector 전문검색 활성화 | ❌ | stem_tsv GIN 인덱스 활용 |
| 7 | 커리큘럼 블루프린트 시험 | ❌ | 단원별 출제 비중 자동 검증 |
| 8 | 한국어 형태소 분석 | ❌ | 검색 정확도 향상 |
| 9-12 | 검색 고도화 + 블루프린트 | ❌ | cursor 페이지네이션, 고급 필터 등 |
| 13-15 | 실시간 이벤트 + Streams | ❌ | Pub/Sub 제거 후 Streams 전환 완료 |

---

## 3. 기술 스택 상세

### 데이터베이스 스키마 (Prisma)

**public 스키마 (LMS 도메인 — NestJS 접근):**

| 모델 | 용도 |
|------|------|
| User | 사용자 (teacher/student/parent/admin) |
| Organization | 학원/학교 |
| Class | 반 |
| Enrollment | 수강 등록 |
| Lesson | 수업 |
| Assignment | 과제 |
| AssignmentProblem | 과제-문제 연결 |
| Submission | 제출 |
| SubmissionAnswer | 제출 답안 |
| SubmissionPhoto | 사진 답안 |
| Notification | 알림 |
| WrongAnswer | 오답 |
| StudentMastery | 숙달도 |
| ReviewSchedule | 복습 스케줄 (SM-2) |
| DiagnosticSession | 진단 평가 세션 |
| DiagnosticResponse | 진단 평가 응답 |
| CurriculumPrerequisite | 선수학습 관계 (DAG) |
| ParentWeeklyReport | 학부모 주간 리포트 |
| GradeCutoff | 등급컷 데이터 |
| Achievement | 업적 정의 |
| StudentAchievement | 학생 업적 |
| StudentStreak | 학습 스트릭 |
| StudentXP | 경험치 |
| AttendanceRecord | 출석 |
| BillingRecord | 청구 |
| ParentStudent | 학부모-학생 연결 |
| ExamDocument | 시험지 문서 |
| LtiPlatform | LTI 플랫폼 |
| LtiIdentity | LTI 사용자 연결 |

**ocr 스키마 (OCR 도메인 — FastAPI 접근):**

| 모델 | 용도 |
|------|------|
| SourceFile | 업로드 원본 파일 |
| OcrJobTracking | OCR 작업 추적 |
| Problem | 문제 (메인 엔티티) |
| ProblemChoice | 객관식 선택지 |
| ProblemSimilarity | 유사 문제 관계 |
| CurriculumNode | 교육과정 트리 |

### 마이그레이션 이력 (17개)

```
20260304134544_add_ai_analysis_fields
20260304141512_ocr_schema_alignment
20260308071500_source_file_uploader_scope
20260308113000_submission_assignment_student_unique
20260308150000_add_exam_documents
20260310114247_curriculum_tree
20260310133000_add_missing_ocr_problem_runtime_columns
20260310160000_add_review_and_solution_confidence_columns
20260310170000_add_solution_tags
20260310193000_add_dual_curriculum_classification
20260311093000_add_source_file_answer_s3_key
20260313124000_add_ocr_job_auto_analyze
20260313150000_phase2_student_learning
20260313170000_targeted_remediation_assignments
20260313200000_phase3_ai_enhancement
20260313220000_phase4_operations
20260313233834_add_lti_identities
```

---

## 4. 서비스별 모듈 맵

### LMS API (NestJS) — 27개 모듈

| 모듈 | 컨트롤러 | 서비스 | 테스트 | 비고 |
|------|----------|--------|--------|------|
| auth | ✅ | ✅ | ✅ | JWT, RBAC, Rate Limit |
| users | ✅ | ✅ | — | |
| organizations | ✅ | ✅ | — | |
| classes | ✅ | ✅ | — | |
| lessons | ✅ | ✅ | — | |
| enrollments | ✅ | ✅ | — | |
| files | ✅ | ✅ | ✅ (normalizer) | S3 업로드, OCR 트리거 |
| problems | ✅ | ✅ | ✅ | 검색, 필터, 임베딩, 트윈 |
| reviews | — | ✅ | — | 검수 로직 |
| assignments | ✅ | ✅ | — | |
| submissions | — | ✅ | ✅ | 자동 채점 |
| submission-photos | — | — | — | 사진 채점 |
| curriculum | ✅ | ✅ | — | 교육과정 트리 API |
| wrong-answers | ✅ | ✅ | — | 오답 수집/관리 |
| mastery | — | ✅ | — | 숙달도 추적 |
| remediation | ✅ | ✅ | ✅ | 보정 과제 생성 |
| diagnostics | ✅ | ✅ | — | IRT 적응형 진단 |
| analytics | ✅ | ✅ | ✅ (KG) | 학습 분석 + 지식 그래프 |
| tutor | — | ✅ | ✅ | AI 튜터 (GPT-4o 스트리밍) |
| notifications | — | ✅ | — | |
| exam-documents | ✅ | ✅ | ✅ | LaTeX → PDF |
| parent-analytics | ✅ | ✅ | — | 학부모 주간 리포트 |
| parent-links | ✅ | ✅ | — | 학부모-학생 연결 |
| grade-prediction | ✅ | ✅ | — | 등급컷 + 성적 예측 |
| gamification | ✅ | ✅ | ✅ | XP, 스트릭, 업적, 리더보드 |
| operations | ✅ | — | — | 학원 운영 (출석/청구) |
| class-monitor | ✅ | — | — | 실시간 수업 모니터링 |
| integrations | ✅ | ✅ | ✅ | QTI + LTI |

### OCR API (FastAPI) — Celery 워커 18개

| 워커 | 용도 | 테스트 |
|------|------|--------|
| ocr_submit | Mathpix OCR 요청 | — |
| ocr_poll | Mathpix 결과 폴링 | — |
| parse_results | OCR 결과 파싱 | — |
| segment_problems | 시험지 문제 분리 | ✅ |
| segment_textbook | 교과서 세그멘테이션 | ✅ |
| detect_sections | EBS 섹션 감지 | ✅ |
| match_answers | 정답 매칭 | ✅ |
| choice_parser | 선택지 파싱 | — |
| crop_figures | 그림 크롭 | — |
| finalize | 시험지 최종화 | — |
| finalize_textbook | 교과서 최종화 | — |
| unified_analysis | 통합 AI 분석 (GPT-4o) | ✅ |
| analyze_solution | 풀이 생성 | — |
| refine_classification | 분류 보정 | — |
| detect_exam_pattern | 수능 패턴 감지 | — |
| generate_embedding | 임베딩 생성 | — |
| find_similar | 유사 문제 검색 | — |
| auto_review | 자동 검수 | ✅ |
| analyze_photo | 사진 분석 (Claude Vision) | — |
| rubric_grader | 루브릭 채점 (Claude Vision) | — |
| analysis_pipeline | 분석 오케스트레이터 | — |
| pipeline | 메인 파이프라인 오케스트레이터 | — |

### Web Frontend (Next.js) — 22개 페이지

| 경로 | 기능 |
|------|------|
| `/dashboard` | 대시보드 (교사/학생 분기) |
| `/upload` | 파일 업로드 + OCR 진행률 |
| `/problems` | 문제 목록 + 필터 + 검색 |
| `/review` | 문제 검수 |
| `/review-daily` | 일일 복습 |
| `/assignments` | 과제 관리 |
| `/exam-builder` | 시험지 생성기 |
| `/wrong-answers` | 오답 노트 |
| `/mastery` | 숙달도 대시보드 |
| `/diagnostics` | 적응형 진단 평가 |
| `/knowledge-graph` | 지식 그래프 시각화 |
| `/tutor` | AI 튜터 채팅 |
| `/analytics` | 학습 분석 |
| `/achievements` | 업적/뱃지 |
| `/grade-prediction` | 등급 예측 |
| `/calendar` | 수업 캘린더 |
| `/classes` | 반 관리 |
| `/class-monitor` | 실시간 수업 모니터링 |
| `/operations` | 학원 운영 |
| `/parent-reports` | 학부모 리포트 |
| `/integrations` | LTI/QTI 설정 |
| `/admin` | 관리자 |

### Mobile (React Native/Expo) — 3개 역할별 네비게이션

**학생 탭:**
- 홈 (오늘 과제/복습)
- 과제 목록 + 풀기
- 오답 노트
- 숙달도
- 일일 복습
- 업적
- 성적표
- 캘린더

**학부모 탭:**
- 홈 (자녀 카드)
- 자녀 대시보드
- 알림
- 캘린더

**교사 탭:**
- 홈
- 반 목록 + 상세
- 과제 관리
- 채점
- 캘린더

---

## 5. OCR/AI 파이프라인 흐름

```
[PDF 업로드] → S3 저장 → Redis 이벤트(ocr:submit)
    ↓
[FastAPI] ocr_submit → Mathpix API
    ↓
ocr_poll → 결과 수신
    ↓
parse_results → 페이지별 텍스트/수식 추출
    ↓
┌─── 시험지 ───┐        ┌─── 교과서/EBS ───┐
│ segment_problems │    │ detect_sections    │
│ match_answers    │    │ segment_textbook   │
│ choice_parser    │    │ match_answers      │
│ crop_figures     │    │ crop_figures       │
│ finalize         │    │ finalize_textbook  │
└──────────────────┘    └────────────────────┘
    ↓
Redis 이벤트(ocr:completed) → NestJS 문제 생성
    ↓
[자동 분석 트리거] (auto_analyze 플래그)
    ↓
analysis_pipeline (chord + chain):
  ├── unified_analysis (GPT-4o: 분류+풀이+난이도 통합)
  │   또는 개별 워커:
  │   ├── refine_classification
  │   ├── analyze_solution
  │   └── detect_exam_pattern
  ├── generate_embedding → pgvector 저장
  ├── find_similar → 유사 문제 매칭
  └── auto_review → 자동 검수 판정
    ↓
Redis 이벤트(analysis:completed) → NestJS 결과 업데이트
```

---

## 6. 서비스 간 통신 (Redis 이벤트)

| 채널 | 방향 | 용도 |
|------|------|------|
| `ocr:submit` | NestJS → FastAPI | OCR 작업 요청 |
| `ocr:completed` | FastAPI → NestJS | OCR 완료, 문제 데이터 전달 |
| `ocr:failed` | FastAPI → NestJS | OCR 실패 |
| `analysis:request` | NestJS → FastAPI | AI 분석 요청 |
| `analysis:completed` | FastAPI → NestJS | 분석 완료 |
| `analysis:failed` | FastAPI → NestJS | 분석 실패 |
| `pipeline:progress` | FastAPI → NestJS | 실시간 진행률 (SSE) |
| `photo:analyze` | NestJS → FastAPI | 사진 채점 요청 |
| `photo:analysis:completed` | FastAPI → NestJS | 사진 채점 완료 |
| `photo:rubric` | NestJS → FastAPI | 루브릭 채점 요청 |
| `photo:rubric:completed` | FastAPI → NestJS | 루브릭 채점 완료 |
| `review:needed` | FastAPI → NestJS | 검수 필요 알림 |

**현재 방식:** Redis Pub/Sub (메시지 유실 가능)
**계획:** Redis Streams + Consumer Groups (Phase 1.5 Task 1)

---

## 7. 테스트 현황

### LMS API (NestJS) — 14개 테스트 파일

| 파일 | 대상 |
|------|------|
| `auth.service.spec.ts` | 인증 서비스 |
| `auth-rate-limit.guard.spec.ts` | Rate Limiting |
| `problems.service.spec.ts` | 문제 서비스 |
| `twin-problem.service.spec.ts` | 트윈 문제 생성 |
| `ocr-problem-normalizer.spec.ts` | OCR 문제 정규화 |
| `submissions.service.spec.ts` | 제출/채점 |
| `remediation.service.spec.ts` | 보정 과제 |
| `knowledge-graph.service.spec.ts` | 지식 그래프 |
| `tutor.service.spec.ts` | AI 튜터 |
| `gamification.service.spec.ts` | 게이미피케이션 |
| `exam-documents.service.spec.ts` | 시험지 생성 |
| `latex-template.helpers.spec.ts` | LaTeX 헬퍼 |
| `lti.service.spec.ts` | LTI 연동 |
| `qti-export.service.spec.ts` | QTI 내보내기 |

### OCR API (Python) — 7개 테스트 파일

| 파일 | 대상 |
|------|------|
| `test_segment_problems.py` | 문제 분리 |
| `test_segment_textbook.py` | 교과서 세그멘테이션 |
| `test_segment_ebs.py` | EBS 세그멘테이션 |
| `test_detect_sections.py` | 섹션 감지 |
| `test_match_answers.py` | 정답 매칭 |
| `test_unified_analysis.py` | 통합 분석 |
| `test_auto_review.py` | 자동 검수 |

---

## 8. 미완성 / 향후 작업

### Phase 1.5 (품질 안정화) — 전체 미구현

가장 시급한 우선순위. 현재 기능은 넓으나 인프라 안정성이 부족:

1. **Redis Pub/Sub → Streams** — NestJS 재시작 시 OCR 결과 유실 가능
2. **파이프라인 멱등성** — finalize 중복 실행 시 문제 중복 생성
3. **문제 리비전 추적** — 편집 시 원본 OCR 데이터 영구 소실
4. **DLQ (Dead Letter Queue)** — 실패 작업 수동 재처리 불가
5. **아이템 분석 통계** — 변별도/난이도 사후 분석 없음
6. **tsvector 전문검색** — 스키마에 정의됐으나 미사용
7. **한국어 형태소 분석** — 검색 정확도 한계
8. **cursor 페이지네이션** — 대규모 데이터 성능 문제

### 성능 개선 (performance-and-feature-roadmap.md)

| 항목 | 상태 |
|------|------|
| HTTP 압축 (gzip) | ❌ |
| Redis 캐싱 레이어 | ❌ |
| ETag / Cache-Control | ❌ |
| Prisma connection pool 튜닝 | ❌ |
| Cursor 기반 페이지네이션 | ❌ |
| LaTeX 수식 검색 | ❌ |

### 기타 미완성 항목

- E2E 테스트 (Playwright 설정은 있으나 테스트 없음)
- Docker 프로덕션 빌드
- CI/CD 파이프라인
- AWS 배포 (ECS Fargate 등)
- 모니터링/로깅 (Grafana, Sentry 등)

---

## 9. 핵심 의존성

### Node.js (pnpm workspace)
- Next.js 15, NestJS 10, Prisma, BullMQ
- OpenAI SDK, Anthropic SDK
- KaTeX (수식 렌더링), recharts (차트)
- Tailwind CSS, Shadcn/ui

### Python (uv/pip)
- FastAPI, Celery, SQLAlchemy 2.0
- Pillow, opencv-python (이미지 처리)
- sympy (수식 파싱)
- httpx (Mathpix API 호출)
- openai (GPT-4o), anthropic (Claude)

---

## 10. 계획 문서 인덱스

프로젝트 진행 과정에서 작성된 모든 계획/설계 문서:

| # | 문서 | 날짜 | 내용 | 구현 |
|---|------|------|------|------|
| 1 | AI 분석 파이프라인 설계 | 2026-03-04 | Celery 기반 2단계 AI 분석 (GPT-4o) | ✅ |
| 2 | OCR+AI 파이프라인 최적화 | 2026-03-05 | unified_analysis 통합, SSE 진행률, 자동 트리거 | ✅ |
| 3 | 교과서 업로드 파이프라인 | 2026-03-06 | 교과서 세그멘테이션, 정답 매칭 | ✅ |
| 4 | EBS 교과서 OCR | 2026-03-06 | 아이템 코드, 섹션 상태 머신 | ✅ |
| 5 | UI/UX 개편 | 2026-03-07 | 검수 UI, LaTeX 렌더링, 레이아웃 | ✅ |
| 6 | LMS + 모바일 앱 설계 | 2026-03-08 | 캘린더, 과제, 채점, 모바일 3역할 | ✅ |
| 7 | 시험지/워크북 PDF 빌더 | 2026-03-08 | LaTeX 템플릿 엔진, xelatex 컴파일 | ✅ |
| 8 | 성능+기능 로드맵 | 2026-03-08 | 검색/캐싱/인프라 개선 계획 | ❌ |
| 9 | 기능 확장 로드맵 (Phase 1-4) | 2026-03-10 | 4단계 24개 피처 로드맵 | ✅ |
| 10 | Phase 1 구현 계획 | 2026-03-10 | 문제은행 고도화 8개 태스크 | ✅ |
| 11 | Phase 2 구현 계획 | 2026-03-10 | 학생 학습 경험 5개 피처 | ✅ |
| 12 | Phase 3 구현 계획 | 2026-03-10 | AI 강화 6개 피처 | ✅ |
| 13 | Phase 4 구현 계획 | 2026-03-10 | 운영 확장 6개 피처 | ✅ |
| 14 | Phase 1.5 품질 안정화 | 2026-03-14 | 데이터 무결성/검색/실시간 15개 태스크 | ❌ |

---

## 11. 요약

| 항목 | 수치 |
|------|------|
| 계획된 피처 (Phase 1-4) | 24개 |
| 구현 완료 | 24개 (100%) |
| Phase 1.5 품질 안정화 | 0/15 (0%) |
| 성능 개선 항목 | 0/6 (0%) |
| LMS API 모듈 | 28개 |
| LMS API 엔드포인트 | 150+ |
| OCR Celery 워커 | 22개 |
| Web 페이지 | 29개 (서브라우트 포함) |
| Mobile 화면 | 19개 (학생 10 + 학부모 5 + 교사 6) |
| DB 테이블 | 44개 (public 35 + ocr 9) |
| DB 마이그레이션 | 17개 |
| 계획 문서 | 14개 |
| NestJS 테스트 파일 | 14개 |
| Python 테스트 파일 | 7개 |
| Git 커밋 | 60+ |

**현재 상태:** Phase 1~4까지 모든 기능이 구현 완료되었으며, 기능 범위는 매우 넓다. 다음 단계는 **Phase 1.5 (품질 안정화)**로, 데이터 무결성(Redis Streams, 멱등성, 리비전)과 검색 성능(tsvector, 형태소 분석, 캐싱) 강화에 집중해야 한다. 이후 프로덕션 배포를 위한 인프라(Docker, CI/CD, 모니터링)도 필요하다.
