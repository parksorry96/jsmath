# CLAUDE.md

## Project: JSMath — 수학 문제은행 + OCR + LMS 플랫폼

### Architecture (Hybrid)
- **Frontend**: Next.js 15 (App Router) — `apps/web` — `:3000`
- **Backend A (LMS Core)**: NestJS — `apps/lms-api` — `:3001`
- **Backend B (OCR/AI Pipeline)**: FastAPI + Celery — `apps/ocr-api` — `:8000`
- **DB**: PostgreSQL 16 + pgvector (단일 DB, 스키마 분리: `lms` / `ocr`)
- **Queue**: Redis (BullMQ for NestJS, Celery for FastAPI)
- **Storage**: S3
- **OCR**: Mathpix API → FastAPI Celery workers
- **AI**: OpenAI API (분류/보정/비전)

### Tech Stack
- TypeScript: Next.js, NestJS, shared-types
- Python: FastAPI, SQLAlchemy 2.0, Celery, Pillow, opencv-python, sympy
- ORM: Prisma (LMS), SQLAlchemy (OCR)
- Monorepo: pnpm workspace + Turborepo

### Key Paths
- `apps/web/` — Next.js frontend
- `apps/lms-api/` — NestJS backend
- `apps/ocr-api/` — FastAPI backend
- `packages/shared-types/` — 공유 TypeScript 타입
- `packages/db-schema/` — Prisma 스키마
- `plan.md` — 전체 계획서 (항상 참고)

### Commands
```bash
# Dev
pnpm dev:web          # Next.js
pnpm dev:lms          # NestJS
pnpm dev:ocr          # FastAPI (uvicorn)

# Infra
docker compose up -d  # PostgreSQL + Redis

# DB
pnpm --filter @jsmath/db-schema db:migrate
pnpm --filter @jsmath/db-schema db:generate

# OCR workers
cd apps/ocr-api && .venv/bin/celery -A app.celery_app worker -l info --concurrency=5

# Install
pnpm install                              # Node deps
cd apps/ocr-api && .venv/bin/pip install -e ".[dev]"  # Python deps
```

### Service Communication
- NestJS → FastAPI: Redis Pub/Sub (`ocr:submit`)
- FastAPI → NestJS: Redis Pub/Sub (`ocr:completed`, `ocr:failed`, `review:needed`)
- 동기 호출 최소화, 이벤트 기반 비동기 우선

---

## Behavioral Guidelines (Karpathy-inspired)

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

### Branch Strategy (Git Flow Simplified)

```
main          ← Production-ready (stable, deployable)
  └── develop ← Development integration branch
       ├── feat/*    ← Feature branches (from develop)
       ├── fix/*     ← Bug fix branches (from develop)
       └── hotfix/*  ← Production hotfixes (from main)
```

**Rules:**
- `main`: Protected. No direct push. Merge only via PR from `develop` (or `hotfix/*` for emergencies).
- `develop`: Protected. No direct push. Merge via PR from `feat/*` or `fix/*`.
- Feature branches: `feat/<feature-name>` from `develop`. Delete after merge.
- Bug fixes: `fix/<bug-name>` from `develop`. Delete after merge.
- Hotfixes: `hotfix/<issue>` from `main`. Merge to both `main` and `develop`.

**Workflow:**
```bash
# New feature
git checkout develop && git pull
git checkout -b feat/my-feature
# ... work ...
# Create PR to develop

# Release to production
# Create PR from develop to main
```

### Project-Specific Rules

1. **Language**: 코드/커밋/주석은 영어, 사용자 대화는 한국어.
2. **OCR is king**: OCR 파이프라인 품질이 제품의 핵심 차별점. 성능/정확도 타협 금지.
3. **Schema boundary**: NestJS는 `lms.*` 테이블만, FastAPI는 `ocr.*` 테이블만 직접 접근. 교차 필요 시 Redis 이벤트. (예외: `student-ai` 모듈은 `ocr.*` 읽기 허용)
4. **No env secrets in code**: `.env` 값 하드코딩 절대 금지. 항상 config/settings에서 로드.
5. **Test with real PDFs**: OCR 관련 변경은 실제 수학 교재 PDF로 검증.
6. **Branch naming**: `feat/`, `fix/`, `hotfix/` prefix 필수. 직접 `main`/`develop` push 금지.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
