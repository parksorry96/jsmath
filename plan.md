# LMS + 수학 문제은행 + OCR 자동화 플랫폼 계획서

## 1) 요약
- 목표: 교재 PDF 업로드만으로 `교재 식별 → 수학 OCR → 문제 단위 분할 → 그래프/도형 크롭 → 문제은행 저장 → LMS 수업/과제/퀴즈 활용`까지 자동화.
- 1차 범위: `LMS 기본 포함`(교사/학생, 강좌, 과제/퀴즈, 성적) + 문제은행 자동 구축.
- 핵심 변경: LMS는 외부 제품(Moodle/Open edX 등) 확장 없이 `직접 개발`로 고정.
- **아키텍처**: `하이브리드` — LMS Core는 NestJS(TypeScript), **OCR/AI 파이프라인은 FastAPI(Python)**로 분리.
- 기술 방향: Next.js(프론트) + NestJS(LMS 백엔드) + FastAPI(OCR/AI 백엔드) + PostgreSQL/pgvector + AWS 관리형.

## 2) 벤치마크 결론 (2026-03-03 기준)
- `Chegg`: 학생용 학습지원/풀이 중심 강점. 교사용 교재 OCR 기반 문제은행 자동 구축과는 포지션이 다름.
- `Moodle/Canvas/Blackboard/Open edX`: 문제은행/퀴즈 운영은 강하지만, 수학 교재 OCR 자동 수집/분류/그래프 자산화는 별도 커스텀 필요.
- 결론: 우리 제품은 `LMS + 문제은행 + OCR`을 통합하되, LMS 도메인도 자체 구현해 데이터/워크플로우를 완전히 통제.

## 3) 최종 기술 스택 (결정사항)

### 프론트엔드
- `Next.js 15 (App Router) + TypeScript + Tailwind + TanStack Query`.

### 백엔드 A — LMS Core (NestJS / TypeScript)
- `NestJS (REST) + Prisma + PostgreSQL 16`.
- 담당: 인증/RBAC, 사용자/조직, 강좌/수강, 과제/퀴즈/성적, 파일 업로드/S3 관리.
- 비동기: `Redis + BullMQ` (업로드 후 OCR 파이프라인 트리거).

### 백엔드 B — OCR/AI Pipeline (FastAPI / Python)
- `FastAPI + SQLAlchemy 2.0 + asyncpg + PostgreSQL 16 + pgvector`.
- 담당: Mathpix OCR 연동, 문제 분할, 그래프/도형 크롭, 자동 분류/태깅, 임베딩, 교재 식별.
- 비동기: `Celery + Redis` (OCR/AI 무거운 작업 워커).
- Python 생태계 활용: `Pillow`(이미지 크롭), `opencv-python`(도형 탐지), `sympy`(LaTeX 정규화), `numpy`(임베딩 전처리).

### 공유 인프라
- DB: `PostgreSQL 16 + pgvector` (단일 DB, 스키마 분리: `lms.*` / `ocr.*`).
- 캐시/큐: `Redis` (BullMQ + Celery 공용).
- 저장소: `S3` (원본 PDF, 페이지 이미지, 그래프 크롭 WebP).
- OCR: `Mathpix API` (`POST /v3/pdf`, 상태 조회, `lines.json` 수집).
- AI: `OpenAI API` (구조화 출력 기반 분류/분할 보정 + 비전 보조 탐지).
- 인증/권한: JWT + RBAC (`admin`, `teacher`, `student`) — NestJS에서 발급, FastAPI에서 검증.

### 서비스 간 통신
- NestJS → FastAPI: REST 내부 호출 또는 Redis 이벤트.
- FastAPI → NestJS: 작업 완료 시 Redis 이벤트 또는 Webhook 콜백.
- 공유 DB 직접 접근 (스키마 분리로 충돌 방지).

## 4) 핵심 워크플로우

### 서비스 경계 기준 흐름

```
교사 (브라우저)
  │
  ▼
Next.js (프론트)
  │
  ├─── LMS 요청 ──▶ NestJS (LMS Core)
  │                    │
  │                    ├─ 강좌/과제/퀴즈 CRUD
  │                    ├─ 인증/RBAC
  │                    └─ PDF 업로드 → S3 저장 → Redis 이벤트 발행
  │                                                │
  │                                    ┌────────────▼────────────┐
  │                                    │   FastAPI (OCR/AI)      │
  │                                    │                         │
  │                                    │  Celery Worker 1: OCR   │
  │                                    │  Celery Worker 2: 분할   │
  │                                    │  Celery Worker 3: 크롭   │
  │                                    │  Celery Worker 4: 분류   │
  │                                    │                         │
  │                                    └────────────┬────────────┘
  │                                                 │
  │                                    Redis 이벤트 (완료/실패)
  │                                                 │
  └─── 검수 UI / 결과 조회 ◀────── NestJS 수신 ◀──┘
```

1. 업로드 (NestJS)
- 교사가 PDF 업로드.
- 파일 해시 생성, 중복 검사, S3 저장.
- `ocr_jobs` 레코드 생성 → Redis 이벤트 `ocr:submit` 발행.

2. 교재 자동 식별 (FastAPI / Celery)
- PDF 메타데이터 + 앞부분 OCR 텍스트에서 ISBN/교재명 후보 추출.
- `Google Books API` 매칭 후 `match_confidence` 저장.
- 임계치 미만은 Redis 이벤트로 NestJS에 검수 요청 → 교사 검수 UI.

3. Mathpix OCR (FastAPI / Celery)
- 수학/도형 보존 옵션으로 Mathpix API 요청.
- 완료 시 페이지별 `lines.json` 파싱 및 DB 저장.
- 실패 시 Celery 자동 재시도(지수 백오프, 최대 3회), 이후 `manual_review`.

4. 문제 단위 분할 (FastAPI / Celery)
- 1차 규칙 기반(번호 패턴, 여백, 페이지 흐름) — Python 정규식/파서.
- 2차 OpenAI 구조화 보정(병합/분할).
- 결과 저장: `start_page/end_page`, `bbox`, `latex`, `plain_text`, `choices`.

5. 그래프/도형 크롭 (FastAPI / Celery)
- `Pillow`로 페이지 300dpi 렌더.
- `opencv-python`으로 line_data 좌표 기반 후보 추출 + 문제 bbox 매핑.
- `24px margin` 확장 후 WebP 크롭 → S3 저장.
- 미탐지 케이스는 OpenAI Vision 보조 탐지.

6. 자동 분류/태깅 (FastAPI / Celery)
- `학년/단원/난이도/문항유형/핵심개념` 태그 생성.
- `sympy`로 LaTeX 정규화, `numpy`로 임베딩 전처리.
- `classification_confidence` 저장.
- 임계치 미만 → Redis 이벤트로 NestJS 검수 큐 이동.

7. LMS 자체 기능 연결 (NestJS)
- 교사: 강좌 생성, 문제 검색/선택, 과제/퀴즈 생성, 성적 관리.
- 학생: 과제 제출, 퀴즈 응시, 결과/피드백 확인.
- 객관식 자동채점 + 주관식 수동채점.

## 5) 공개 API / 인터페이스

### NestJS (LMS Core) — `localhost:3001`
1. `POST /v1/files/pdf` — PDF 업로드 → S3 + OCR 트리거
2. `POST /v1/courses` — 강좌 생성
3. `POST /v1/quizzes` — 퀴즈 생성
4. `POST /v1/assignments` — 과제 생성
5. `GET /v1/problems` — 문제 검색 (DB 조회, 프론트용)
6. `POST /v1/problems/:id/review` — 검수 승인/반려

### FastAPI (OCR/AI Pipeline) — `localhost:8000`
1. `POST /v1/ocr/jobs` — OCR 작업 생성 (NestJS 내부 호출)
2. `GET /v1/ocr/jobs/{id}` — OCR 작업 상태 조회
3. `GET /v1/ocr/jobs/{id}/results` — OCR 결과 상세
4. `GET /v1/textbooks/{id}` — 교재 식별 결과
5. `POST /v1/problems/{id}/reclassify` — 재분류 요청
6. `GET /v1/analytics/ocr` — OCR 파이프라인 통계/대시보드
7. `GET /v1/pipeline/health` — 워커 상태, 큐 깊이, 처리율 모니터링

### 이벤트 계약 (Redis Pub/Sub + Celery)

#### NestJS → FastAPI (Redis 채널)
1. `ocr:submit { fileId, s3Key, textbookCandidateId }` — PDF 업로드 완료, OCR 시작 요청

#### FastAPI 내부 (Celery 체인)
1. `task.ocr.fetch { ocrJobId, pdfId }` — Mathpix OCR 호출
2. `task.textbook.identify { ocrJobId }` — 교재 식별
3. `task.problem.segment { ocrJobId, pageRange }` — 문제 분할
4. `task.graph.crop { problemId, pageId, bbox }` — 그래프 크롭
5. `task.problem.classify { problemId }` — 분류/태깅
6. `task.problem.embed { problemId }` — 벡터 임베딩

#### FastAPI → NestJS (Redis 채널)
1. `ocr:completed { ocrJobId, problemCount }` — 파이프라인 완료
2. `ocr:failed { ocrJobId, reason, retryable }` — 실패 알림
3. `review:needed { problemId, reason, confidence }` — 검수 필요

## 6) 데이터 모델 (초기)
- `users, organizations, courses, enrollments`
- `textbooks, textbook_versions, source_files`
- `ocr_jobs, ocr_pages, ocr_lines`
- `problems, problem_choices, problem_assets`
- `problem_tags, tag_dictionary`
- `quizzes, quiz_items, quiz_attempts`
- `assignments, submissions, grades`

### 인덱스
1. `problems(stem_text tsvector)`
2. `problems(embedding vector_cosine_ops)`
3. `problem_assets(problem_id, kind)`
4. `ocr_jobs(status, created_at)`

## 7) 테스트 및 검증
- 기능
1. 50개 PDF 업로드 시 OCR 완료율 98% 이상
2. ISBN 포함 교재 Top-1 식별 정확도 90% 이상
3. 문제 분할 F1 0.90 이상
4. 그래프 크롭 Recall 95% 이상
5. 분류 태그 정확도 85% 이상(교사 검수 기준)

- 회귀/통합
1. 중복 업로드 정책 검증
2. OCR 실패/재시도/복구 검증
3. 문제 수정 후 퀴즈 반영 일관성 검증
4. 권한 검증(`teacher`만 업로드/문제편집 가능)

- 성능
1. 200페이지 PDF 파이프라인 30분 이내
2. 동시 업로드 20건 적체/복구 검증
3. 문제 검색 P95 500ms 이하

## 8) 릴리스 단계 (하이브리드 아키텍처 반영)
1. Phase 0 (1주): 모노레포 구성, 인증/RBAC, 사용자/조직 도메인, **FastAPI 프로젝트 스캐폴딩**
2. Phase 1 (2주): **병렬 트랙 시작**
   - 트랙A (NestJS): LMS Core 1차(강좌/수강/과제 기본)
   - 트랙B (FastAPI): Mathpix OCR 연동 + Celery 워커 기본 구조
3. Phase 2 (3주): **병렬 계속**
   - 트랙A (NestJS): PDF 업로드 → S3 → Redis 이벤트 발행 + 검수 UI
   - 트랙B (FastAPI): OCR 파이프라인 완성(문제 분할 + 그래프 크롭 + 교재 식별)
4. Phase 3 (3주): **통합 + 고도화**
   - 트랙A (NestJS): 퀴즈/성적 기능 고도화 + 문제은행 검색 API
   - 트랙B (FastAPI): 자동 분류/태깅 + 임베딩 + 파이프라인 모니터링
   - 통합: Redis 이벤트 연동 E2E 테스트
5. Phase 4 (2주): 품질 튜닝, 비용 최적화, 운영 대시보드, 파이프라인 성능 벤치마크

## 9) 운영/보안/비용
- 보안
1. S3 암호화 + 서명 URL 15분 만료
2. 개인정보 최소 수집
3. API rate limit + 감사 로그

- 비용
1. OCR/AI 호출량 대시보드
2. 규칙 기반 우선, AI 보조 최소화
3. 페이지당 처리비용 KPI 추적

- 데이터
1. 원본 PDF/크롭 자산 버전 관리
2. 삭제 요청 시 하드 삭제 옵션
3. 문제 편집 이력 저장

## 10) 명시적 가정
- LMS는 외부 솔루션 연동 없이 자체 구현.
- **아키텍처는 하이브리드: NestJS(LMS) + FastAPI(OCR/AI). OCR 파이프라인이 제품의 핵심 차별점.**
- 언어는 한국어/영어 혼합 수학 교재 대상.
- OCR은 Mathpix 고정, 분류/보정은 OpenAI 사용.
- 1차는 웹 중심(모바일 앱 제외), 결제/멀티테넌시 고급 기능은 2차.
- DB는 단일 PostgreSQL, 스키마 분리(`lms` / `ocr`)로 서비스 경계 유지.
- 두 백엔드 간 통신은 Redis Pub/Sub 기반, 동기 호출 최소화.

## 11) 모노레포 구조 (예상)

```
jsmath/
├── apps/
│   ├── web/                  # Next.js 15 (프론트엔드)
│   ├── lms-api/              # NestJS (LMS Core 백엔드)
│   └── ocr-api/              # FastAPI (OCR/AI Pipeline 백엔드)
│       ├── app/
│       │   ├── main.py
│       │   ├── api/          # FastAPI 라우터
│       │   ├── workers/      # Celery 워커 (ocr, segment, crop, classify)
│       │   ├── services/     # Mathpix, OpenAI, 이미지 처리 서비스
│       │   ├── models/       # SQLAlchemy 모델
│       │   └── schemas/      # Pydantic 스키마
│       ├── pyproject.toml
│       └── Dockerfile
├── packages/
│   ├── shared-types/         # 프론트-NestJS 공유 TypeScript 타입
│   └── db-schema/            # Prisma 스키마 (LMS 도메인)
├── docker-compose.yml        # PostgreSQL + Redis + 서비스 오케스트레이션
└── turbo.json / pnpm-workspace.yaml
```

## 12) 참고 링크
- Chegg Study: <https://www.chegg.com/study>
- Moodle Question Bank: <https://docs.moodle.org/en/Question_bank>
- Canvas Item Bank: <https://community.canvaslms.com/t5/Instructor-Guide/How-do-I-share-an-item-bank-in-New-Quizzes/ta-p/1027>
- Blackboard Question Pools: <https://help.blackboard.com/Learn/Instructor/Original/Tests_Pools_Surveys/Question_Pools>
- Open edX Architecture: <https://openedx.atlassian.net/wiki/spaces/COMM/pages/3826278012/Architecture+Overview>
- Mathpix Docs: <https://docs.mathpix.com/>
- OpenAI Vision: <https://platform.openai.com/docs/guides/vision>
- OpenAI Structured Outputs: <https://platform.openai.com/docs/guides/structured-outputs>
- Google Books API: <https://developers.google.com/books/docs/v1/using>
