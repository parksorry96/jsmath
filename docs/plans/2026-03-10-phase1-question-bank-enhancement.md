# Phase 1: Question Bank Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Strengthen the question bank foundation with dual curriculum mapping, 6-level difficulty, past exam tagging, semantic search, and solution strategy tagging.

**Architecture:** Extend existing Prisma schema + OCR analysis pipeline. Add a `CurriculumNode` table for hierarchical curriculum trees. Upgrade search from ILIKE to pgvector semantic search. All changes are additive — no breaking changes to existing data.

**Tech Stack:** Prisma (schema), NestJS (API), FastAPI/Celery (AI pipeline), PostgreSQL + pgvector, Next.js (frontend)

---

## Task 1: Curriculum Tree Database Schema

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`
- Create: `packages/db-schema/prisma/migrations/YYYYMMDD_curriculum_tree/migration.sql`
- Create: `packages/db-schema/prisma/seed-curriculum.ts`

**Context:** Currently gradeLevel/subject/unitMajor/unitMinor/unitSub are free-text strings on Problem (schema.prisma:405-409). The OCR pipeline hardcodes the 2015 curriculum tree in `apps/ocr-api/app/schemas/problem.py:15-41`. We need a proper curriculum table supporting both 2015 and 2022 curricula.

**Step 1: Add CurriculumNode model to Prisma schema**

Add after the Problem model in `packages/db-schema/prisma/schema.prisma`:

```prisma
model CurriculumNode {
  id              String           @id @default(uuid()) @db.Uuid
  curriculumYear  Int              @map("curriculum_year")  // 2015 or 2022
  level           Int              // 1=subject, 2=unitMajor, 3=unitMinor, 4=unitSub
  code            String           // machine-readable key e.g. "math1.polynomial.ops"
  label           String           // display name e.g. "다항식의 연산"
  parentId        String?          @map("parent_id") @db.Uuid
  parent          CurriculumNode?  @relation("CurriculumTree", fields: [parentId], references: [id])
  children        CurriculumNode[] @relation("CurriculumTree")
  sortOrder       Int              @default(0) @map("sort_order")
  gradeLevel      String?          @map("grade_level")  // "high_1", "high_2", "high_3"
  createdAt       DateTime         @default(now()) @map("created_at")

  @@unique([curriculumYear, code])
  @@index([curriculumYear, level])
  @@index([parentId])
  @@map("curriculum_nodes")
  @@schema("ocr")
}
```

Also add optional foreign key on Problem:
```prisma
// Add to Problem model after unitSub field (line ~409):
  curriculumNodeId String?          @map("curriculum_node_id") @db.Uuid
  curriculumNode   CurriculumNode?  @relation(fields: [curriculumNodeId], references: [id])
```

And add the reverse relation to CurriculumNode:
```prisma
  problems        Problem[]
```

**Step 2: Run migration**

```bash
cd packages/db-schema && pnpm db:migrate --name curriculum_tree
```

**Step 3: Create seed script for 2015 curriculum**

Create `packages/db-schema/prisma/seed-curriculum.ts`. Use the existing tree from `apps/ocr-api/app/schemas/problem.py:15-41` as source of truth. Structure:

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CURRICULUM_2015 = [
  {
    subject: '수학I',
    gradeLevel: 'high_2',
    units: [
      {
        major: '지수함수와 로그함수',
        minors: ['지수', '로그', '지수함수', '로그함수'],
      },
      {
        major: '삼각함수',
        minors: ['삼각함수', '삼각함수의 그래프', '사인법칙과 코사인법칙'],
      },
      {
        major: '수열',
        minors: ['등차수열과 등비수열', '수열의 합', '수학적 귀납법'],
      },
    ],
  },
  {
    subject: '수학II',
    gradeLevel: 'high_2',
    units: [
      {
        major: '함수의 극한과 연속',
        minors: ['함수의 극한', '함수의 연속'],
      },
      {
        major: '미분',
        minors: ['미분계수와 도함수', '도함수의 활용'],
      },
      {
        major: '적분',
        minors: ['부정적분과 정적분', '정적분의 활용'],
      },
    ],
  },
  {
    subject: '확률과 통계',
    gradeLevel: 'high_2',
    units: [
      {
        major: '경우의 수',
        minors: ['순열과 조합', '이항정리'],
      },
      {
        major: '확률',
        minors: ['확률의 뜻과 활용', '조건부확률'],
      },
      {
        major: '통계',
        minors: ['확률분포', '통계적 추정'],
      },
    ],
  },
  {
    subject: '미적분',
    gradeLevel: 'high_3',
    units: [
      {
        major: '수열의 극한',
        minors: ['수열의 극한', '급수'],
      },
      {
        major: '미분법',
        minors: ['여러 가지 미분법', '도함수의 활용'],
      },
      {
        major: '적분법',
        minors: ['여러 가지 적분법', '정적분의 활용'],
      },
    ],
  },
  {
    subject: '기하',
    gradeLevel: 'high_3',
    units: [
      {
        major: '이차곡선',
        minors: ['포물선', '타원', '쌍곡선'],
      },
      {
        major: '평면벡터',
        minors: ['벡터의 연산', '평면벡터의 성분과 내적'],
      },
      {
        major: '공간도형과 공간좌표',
        minors: ['공간도형', '공간좌표'],
      },
    ],
  },
];

const CURRICULUM_2022 = [
  {
    subject: '공통수학1',
    gradeLevel: 'high_1',
    units: [
      {
        major: '다항식',
        minors: ['다항식의 연산', '나머지정리와 인수분해'],
      },
      {
        major: '방정식과 부등식',
        minors: ['복소수와 이차방정식', '이차방정식과 이차함수', '여러 가지 부등식'],
      },
      {
        major: '경우의 수',
        minors: ['순열과 조합'],
      },
      {
        major: '행렬',
        minors: ['행렬과 그 연산', '역행렬'],
      },
    ],
  },
  {
    subject: '공통수학2',
    gradeLevel: 'high_1',
    units: [
      {
        major: '도형의 방정식',
        minors: ['직선의 방정식', '원의 방정식', '도형의 이동'],
      },
      {
        major: '집합과 명제',
        minors: ['집합', '명제'],
      },
      {
        major: '함수와 그래프',
        minors: ['함수', '유리함수와 무리함수'],
      },
    ],
  },
  {
    subject: '대수',
    gradeLevel: 'high_2',
    units: [
      {
        major: '지수와 로그',
        minors: ['지수', '로그'],
      },
      {
        major: '지수함수와 로그함수',
        minors: ['지수함수와 로그함수', '지수함수와 로그함수의 활용'],
      },
      {
        major: '삼각함수',
        minors: ['삼각함수', '삼각함수의 그래프', '삼각함수의 활용'],
      },
      {
        major: '수열',
        minors: ['등차수열과 등비수열', '수열의 합', '수학적 귀납법'],
      },
    ],
  },
  {
    subject: '미적분I',
    gradeLevel: 'high_2',
    units: [
      {
        major: '함수의 극한과 연속',
        minors: ['함수의 극한', '함수의 연속'],
      },
      {
        major: '미분',
        minors: ['미분계수와 도함수', '도함수의 활용'],
      },
      {
        major: '적분',
        minors: ['부정적분과 정적분', '정적분의 활용'],
      },
    ],
  },
  {
    subject: '확률과 통계',
    gradeLevel: 'high_2',
    units: [
      {
        major: '경우의 수',
        minors: ['순열과 조합', '이항정리'],
      },
      {
        major: '확률',
        minors: ['확률의 뜻과 활용', '조건부확률'],
      },
      {
        major: '통계',
        minors: ['확률분포', '통계적 추정'],
      },
    ],
  },
  {
    subject: '미적분II',
    gradeLevel: 'high_3',
    units: [
      {
        major: '수열의 극한',
        minors: ['수열의 극한', '급수'],
      },
      {
        major: '미분법',
        minors: ['여러 가지 미분법', '도함수의 활용'],
      },
      {
        major: '적분법',
        minors: ['여러 가지 적분법', '정적분의 활용'],
      },
    ],
  },
  {
    subject: '기하',
    gradeLevel: 'high_3',
    units: [
      {
        major: '이차곡선',
        minors: ['포물선', '타원', '쌍곡선'],
      },
      {
        major: '평면벡터',
        minors: ['벡터의 연산', '평면벡터의 성분과 내적'],
      },
      {
        major: '공간도형과 공간좌표',
        minors: ['공간도형', '공간좌표'],
      },
    ],
  },
];

async function seedCurriculum(year: number, tree: typeof CURRICULUM_2015) {
  for (const [si, subj] of tree.entries()) {
    const subjectNode = await prisma.curriculumNode.upsert({
      where: { curriculumYear_code: { curriculumYear: year, code: subj.subject } },
      update: {},
      create: {
        curriculumYear: year,
        level: 1,
        code: subj.subject,
        label: subj.subject,
        gradeLevel: subj.gradeLevel,
        sortOrder: si,
      },
    });

    for (const [mi, unit] of subj.units.entries()) {
      const majorCode = `${subj.subject}.${unit.major}`;
      const majorNode = await prisma.curriculumNode.upsert({
        where: { curriculumYear_code: { curriculumYear: year, code: majorCode } },
        update: {},
        create: {
          curriculumYear: year,
          level: 2,
          code: majorCode,
          label: unit.major,
          parentId: subjectNode.id,
          gradeLevel: subj.gradeLevel,
          sortOrder: mi,
        },
      });

      for (const [ni, minor] of unit.minors.entries()) {
        const minorCode = `${majorCode}.${minor}`;
        await prisma.curriculumNode.upsert({
          where: { curriculumYear_code: { curriculumYear: year, code: minorCode } },
          update: {},
          create: {
            curriculumYear: year,
            level: 3,
            code: minorCode,
            label: minor,
            parentId: majorNode.id,
            gradeLevel: subj.gradeLevel,
            sortOrder: ni,
          },
        });
      }
    }
  }
}

async function main() {
  console.log('Seeding 2015 curriculum...');
  await seedCurriculum(2015, CURRICULUM_2015);
  console.log('Seeding 2022 curriculum...');
  await seedCurriculum(2022, CURRICULUM_2022);
  console.log('Done.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

**Step 4: Run seed**

```bash
cd packages/db-schema && npx tsx prisma/seed-curriculum.ts
```

**Step 5: Regenerate Prisma client**

```bash
pnpm --filter @jsmath/db-schema db:generate
```

**Step 6: Commit**

```bash
git add packages/db-schema/
git commit -m "feat: add curriculum_nodes table with 2015+2022 curriculum seed data"
```

---

## Task 2: Curriculum API Endpoints

**Files:**
- Create: `apps/lms-api/src/curriculum/curriculum.module.ts`
- Create: `apps/lms-api/src/curriculum/curriculum.controller.ts`
- Create: `apps/lms-api/src/curriculum/curriculum.service.ts`
- Modify: `apps/lms-api/src/app.module.ts` (register CurriculumModule)

**Step 1: Create curriculum service**

```typescript
// apps/lms-api/src/curriculum/curriculum.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CurriculumService {
  constructor(private prisma: PrismaService) {}

  async getTree(curriculumYear: number) {
    const nodes = await this.prisma.curriculumNode.findMany({
      where: { curriculumYear },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
    });

    // Build tree from flat list
    const map = new Map(nodes.map((n) => [n.id, { ...n, children: [] as any[] }]));
    const roots: any[] = [];
    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  async getSubjects(curriculumYear: number) {
    return this.prisma.curriculumNode.findMany({
      where: { curriculumYear, level: 1 },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getChildren(parentId: string) {
    return this.prisma.curriculumNode.findMany({
      where: { parentId },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
```

**Step 2: Create curriculum controller**

```typescript
// apps/lms-api/src/curriculum/curriculum.controller.ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurriculumService } from './curriculum.service';

@Controller('curriculum')
@UseGuards(JwtAuthGuard)
export class CurriculumController {
  constructor(private curriculumService: CurriculumService) {}

  @Get('tree')
  getTree(@Query('year') year?: string) {
    const curriculumYear = year ? parseInt(year, 10) : 2015;
    return this.curriculumService.getTree(curriculumYear);
  }

  @Get('subjects')
  getSubjects(@Query('year') year?: string) {
    const curriculumYear = year ? parseInt(year, 10) : 2015;
    return this.curriculumService.getSubjects(curriculumYear);
  }

  @Get(':parentId/children')
  getChildren(@Param('parentId') parentId: string) {
    return this.curriculumService.getChildren(parentId);
  }
}
```

**Step 3: Create module and register**

```typescript
// apps/lms-api/src/curriculum/curriculum.module.ts
import { Module } from '@nestjs/common';
import { CurriculumController } from './curriculum.controller';
import { CurriculumService } from './curriculum.service';

@Module({
  controllers: [CurriculumController],
  providers: [CurriculumService],
  exports: [CurriculumService],
})
export class CurriculumModule {}
```

Add `CurriculumModule` to imports in `apps/lms-api/src/app.module.ts`.

**Step 4: Verify endpoints**

```bash
pnpm dev:lms
# Test: GET /curriculum/tree?year=2015
# Test: GET /curriculum/tree?year=2022
# Test: GET /curriculum/subjects?year=2022
```

**Step 5: Commit**

```bash
git add apps/lms-api/src/curriculum/ apps/lms-api/src/app.module.ts
git commit -m "feat: add curriculum tree API endpoints"
```

---

## Task 3: 6-Level Difficulty Scale

**Files:**
- Modify: `apps/ocr-api/app/schemas/problem.py` (line 43)
- Modify: `apps/ocr-api/app/workers/unified_analysis.py` (lines 237-249)
- Modify: `apps/ocr-api/app/workers/auto_review.py` (lines 38-44)
- Modify: `apps/web/src/app/(authenticated)/problems/page.tsx` (lines 126-138)

**Context:** Currently difficulty is Int 1-5 with labels "기초/쉬움/보통/어려움/최상". Expand to 6 levels aligned with MathFlat's system while keeping DB column as Int (no migration needed).

**Step 1: Update difficulty scale definition**

In `apps/ocr-api/app/schemas/problem.py` line 43, change:
```python
# Before:
DIFFICULTY_LEVELS = {1: "기초", 2: "쉬움", 3: "보통", 4: "어려움", 5: "최상"}

# After:
DIFFICULTY_LEVELS = {1: "기초", 2: "쉬움", 3: "보통", 4: "약간 어려움", 5: "어려움", 6: "최상"}
```

**Step 2: Update AI analysis prompt difficulty scale**

In `apps/ocr-api/app/workers/unified_analysis.py` lines 237-249, update the difficulty scale and CSAT anchors:

```python
# Replace the difficulty scale section with:
DIFFICULTY_SCALE = """
Difficulty (1-6):
  1 (기초): 개념 직접 적용, 수능 정답률 90%+
  2 (쉬움): 개념 1~2개 조합, 수능 정답률 75~90%
  3 (보통): 개념 2~3개 조합, 약간의 변형, 수능 정답률 55~75%
  4 (약간 어려움): 개념 응용/변형, 수능 정답률 35~55%
  5 (어려움): 복합 개념, 준킬러급, 수능 정답률 15~35%
  6 (최상): 킬러 문항, 수능 정답률 15% 미만
"""
```

Also update the `UnifiedAnalysisResult` field constraint:
```python
# Line 193:
difficulty_refined: float = Field(ge=1.0, le=6.0)
```

And the post-validation clamping (lines 447-449):
```python
if result.difficulty_refined < 1.0:
    result.difficulty_refined = 1.0
elif result.difficulty_refined > 6.0:
    result.difficulty_refined = 6.0
```

**Step 3: Update auto-review difficulty-time ranges**

In `apps/ocr-api/app/workers/auto_review.py` lines 38-44:
```python
_DIFFICULTY_TIME_RANGES = {
    1: (30, 120),
    2: (60, 180),
    3: (90, 300),
    4: (150, 420),
    5: (240, 600),
    6: (360, 900),
}
```

Also update the auto-approve validation (line 309-313) to accept 1.0-6.0.

**Step 4: Update frontend difficulty display**

In `apps/web/src/app/(authenticated)/problems/page.tsx` lines 126-138:
```typescript
const difficultyLabel = (d: number) => {
  if (d <= 1) return '기초';
  if (d <= 2) return '쉬움';
  if (d <= 3) return '보통';
  if (d <= 4) return '약간 어려움';
  if (d <= 5) return '어려움';
  return '최상';
};

const difficultyColor = (d: number) => {
  if (d <= 1) return 'bg-green-100 text-green-800';
  if (d <= 2) return 'bg-emerald-100 text-emerald-800';
  if (d <= 3) return 'bg-yellow-100 text-yellow-800';
  if (d <= 4) return 'bg-orange-100 text-orange-800';
  if (d <= 5) return 'bg-red-100 text-red-800';
  return 'bg-purple-100 text-purple-800';
};
```

Update the difficulty filter dropdown (lines 298-311) to include all 6 levels.

**Step 5: Update shared types**

In `packages/shared-types/`, update the Difficulty type if it exists to reflect 1-6 range.

**Step 6: Verify**

```bash
# Run OCR API tests
cd apps/ocr-api && .venv/bin/python -m pytest tests/ -v -k "difficulty or auto_review"
# Check frontend renders correctly
pnpm dev:web
```

**Step 7: Commit**

```bash
git add apps/ocr-api/ apps/web/ packages/shared-types/
git commit -m "feat: expand difficulty scale from 5 to 6 levels"
```

---

## Task 4: Past Exam Tagging Enhancement

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma` (add gradeCutoff field)
- Modify: `apps/lms-api/src/problems/problems.service.ts` (add exam source filters)
- Modify: `apps/lms-api/src/problems/problems.controller.ts` (add query params)
- Modify: `apps/web/src/app/(authenticated)/problems/page.tsx` (add exam filter UI)

**Context:** examSource is already a JSON field `{"year", "month", "type", "number"}` populated by AI analysis. We need: (1) expose exam source filters in the API, (2) add filter UI, (3) add grade cut-off reference data.

**Step 1: Add exam source filter params to controller**

In `apps/lms-api/src/problems/problems.controller.ts`, add query params:
```typescript
@Query('examYear') examYear?: string,
@Query('examMonth') examMonth?: string,
@Query('examType') examType?: string,
```

**Step 2: Implement JSON filtering in service**

In `apps/lms-api/src/problems/problems.service.ts` findAll method, add after existing filters:
```typescript
if (query.examYear) {
  where.examSource = { ...where.examSource as any, path: ['year'], equals: parseInt(query.examYear, 10) };
}
if (query.examType) {
  where.examSource = { ...where.examSource as any, path: ['type'], string_contains: query.examType };
}
```

Note: Prisma JSON filtering uses `path` + `equals` for nested JSON fields.

**Step 3: Add exam filter UI on problems page**

In `apps/web/src/app/(authenticated)/problems/page.tsx`, add exam year dropdown (2020-2026), exam type dropdown (수능, 6월모의평가, 9월모의평가, 교육청모의고사).

**Step 4: Add filter-options for exam sources**

In `apps/lms-api/src/problems/problems.service.ts` getFilterOptions method, add query to get distinct exam years and types from the examSource JSON field.

**Step 5: Verify**

```bash
pnpm dev:lms
# Test: GET /problems?examYear=2025&examType=수능
pnpm dev:web
# Verify filter UI renders and works
```

**Step 6: Commit**

```bash
git add apps/lms-api/ apps/web/
git commit -m "feat: add past exam source filters to problem search"
```

---

## Task 5: Semantic Problem Search

**Files:**
- Modify: `apps/lms-api/src/problems/problems.service.ts` (lines 158-161)
- Modify: `apps/lms-api/src/problems/problems.controller.ts`
- Create: `apps/lms-api/src/problems/embedding.service.ts`
- Modify: `apps/web/src/app/(authenticated)/problems/page.tsx` (search UI)

**Context:** Current search uses ILIKE on stemText (line 158 comment says "tsvector upgrade in Phase 3"). pgvector embeddings already exist on Problem.embedding. We upgrade to: (1) embed the search query via OpenAI, (2) find similar problems via cosine distance. Existing find_similar.py (OCR API) already does this — we bring equivalent logic to NestJS.

**Step 1: Create embedding service**

```typescript
// apps/lms-api/src/problems/embedding.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingService {
  private client: OpenAI;

  constructor(private config: ConfigService) {
    this.client = new OpenAI({ apiKey: this.config.get('OPENAI_API_KEY') });
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return response.data[0].embedding;
  }
}
```

**Step 2: Add semantic search to problems service**

In `apps/lms-api/src/problems/problems.service.ts`, add a `semanticSearch` method:

```typescript
async semanticSearch(query: string, filters: any, limit = 20) {
  const embedding = await this.embeddingService.embed(query);
  const vectorStr = `[${embedding.join(',')}]`;

  // Raw query for pgvector cosine distance with filters
  const problems = await this.prisma.$queryRaw`
    SELECT id, stem_text, subject, unit_major, difficulty,
           1 - (embedding <=> ${vectorStr}::vector) as similarity
    FROM ocr.problems
    WHERE embedding IS NOT NULL
      AND review_status IN ('approved', 'auto_approved')
      ${filters.subject ? Prisma.sql`AND subject = ${filters.subject}` : Prisma.empty}
      ${filters.gradeLevel ? Prisma.sql`AND grade_level = ${filters.gradeLevel}` : Prisma.empty}
      ${filters.difficulty ? Prisma.sql`AND difficulty = ${filters.difficulty}` : Prisma.empty}
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `;
  return problems;
}
```

**Step 3: Add search mode toggle to controller**

In the controller, detect if `searchMode=semantic` query param is set:
```typescript
@Query('searchMode') searchMode?: string,  // 'keyword' | 'semantic'
```

If semantic, call `semanticSearch()` instead of the existing `findAll()`.

**Step 4: Update frontend search UI**

In `apps/web/src/app/(authenticated)/problems/page.tsx`:
- Add a toggle button: "키워드 검색" / "의미 검색"
- When semantic mode, placeholder text: "찾고 싶은 문제 유형을 자연어로 설명하세요"
- Example: "이차함수의 최솟값을 구하는 문제" → semantic search

**Step 5: Verify**

```bash
pnpm dev:lms
# Test semantic search: GET /problems?q=삼각함수+활용+문제&searchMode=semantic
pnpm dev:web
# Verify toggle and search results
```

**Step 6: Commit**

```bash
git add apps/lms-api/ apps/web/
git commit -m "feat: add semantic problem search using pgvector embeddings"
```

---

## Task 6: Solution Strategy Tagging

**Files:**
- Modify: `apps/ocr-api/app/workers/unified_analysis.py` (prompt enhancement)
- Modify: `apps/lms-api/src/problems/problems.service.ts` (add filter)
- Modify: `apps/lms-api/src/problems/problems.controller.ts` (add query param)
- Modify: `apps/web/src/app/(authenticated)/problems/page.tsx` (add filter UI)

**Context:** solutionStrategy is already populated by AI as free text (line 198 in unified_analysis.py). We need to add a structured `solutionTags` field — a JSON array of standardized strategy labels for filtering.

**Step 1: Add solutionTags field to Prisma schema**

In `packages/db-schema/prisma/schema.prisma`, add to Problem model:
```prisma
  solutionTags     Json?      @map("solution_tags")  // string[] of standardized tags
```

Run migration:
```bash
cd packages/db-schema && pnpm db:migrate --name add_solution_tags
```

**Step 2: Define standardized strategy tags**

In `apps/ocr-api/app/schemas/problem.py`, add:
```python
SOLUTION_STRATEGY_TAGS = [
    "직접계산", "치환", "귀류법", "수학적귀납법",
    "그래프활용", "미분활용", "적분활용", "벡터활용",
    "경우의수", "확률계산", "점화식", "극한",
    "넓이/부피", "방정식풀이", "부등식풀이",
    "도형성질", "좌표기하", "삼각함수활용",
    "함수의성질", "합성함수", "역함수",
    "조건분석", "범위추정", "대칭성활용",
]
```

**Step 3: Update AI analysis prompt to output tags**

In `apps/ocr-api/app/workers/unified_analysis.py`, add to `UnifiedAnalysisResult`:
```python
solution_tags: list[str] = Field(default_factory=list, description="1-4 tags from the standardized list")
```

Add the tag list to the system prompt so GPT selects from it.

**Step 4: Persist tags and add filter**

In the finalization worker, save `solution_tags` to the problem row.

In `apps/lms-api/src/problems/problems.service.ts`, add JSON array filter:
```typescript
if (query.solutionTag) {
  where.solutionTags = { array_contains: [query.solutionTag] };
}
```

**Step 5: Add filter UI**

In `apps/web/src/app/(authenticated)/problems/page.tsx`, add a multi-select dropdown for solution strategy tags.

**Step 6: Update getFilterOptions**

Add `solutionTags` to the filter options endpoint so the frontend knows which tags exist in the DB.

**Step 7: Verify**

```bash
cd apps/ocr-api && .venv/bin/python -m pytest tests/ -v -k "unified_analysis"
pnpm dev:lms
pnpm dev:web
```

**Step 8: Commit**

```bash
git add packages/db-schema/ apps/ocr-api/ apps/lms-api/ apps/web/
git commit -m "feat: add structured solution strategy tags for problem filtering"
```

---

## Task 7: Update OCR Pipeline for Curriculum Node Linking

**Files:**
- Modify: `apps/ocr-api/app/workers/unified_analysis.py`
- Modify: `apps/ocr-api/app/schemas/problem.py`
- Modify: `apps/ocr-api/app/workers/finalize.py`
- Modify: `apps/ocr-api/app/workers/finalize_textbook.py`

**Context:** After Tasks 1-6, the curriculum_nodes table exists. Now we link AI-classified problems to specific curriculum nodes automatically.

**Step 1: Add curriculum node lookup to finalization**

After AI analysis sets subject/unitMajor/unitMinor, look up the matching CurriculumNode by code and set `curriculum_node_id` on the problem.

```python
# In finalize workers, after setting subject/unitMajor/unitMinor:
from sqlalchemy import select
# Look up node: try unitMinor first, then unitMajor, then subject
code = f"{subject}.{unit_major}.{unit_minor}" if unit_minor else f"{subject}.{unit_major}"
node = session.execute(
    select(CurriculumNode).where(
        CurriculumNode.curriculum_year == 2015,
        CurriculumNode.code == code
    )
).scalar_one_or_none()
if node:
    problem.curriculum_node_id = node.id
```

**Step 2: Add CurriculumNode SQLAlchemy model**

In `apps/ocr-api/app/models/`, add the CurriculumNode model matching the Prisma schema.

**Step 3: Verify with existing test PDFs**

```bash
cd apps/ocr-api && .venv/bin/python -m pytest tests/ -v
```

**Step 4: Commit**

```bash
git add apps/ocr-api/
git commit -m "feat: auto-link problems to curriculum nodes during OCR finalization"
```

---

## Task 8: Frontend Curriculum Filter Integration

**Files:**
- Modify: `apps/web/src/app/(authenticated)/problems/page.tsx`
- Modify: `apps/lms-api/src/problems/problems.service.ts`
- Modify: `apps/lms-api/src/problems/problems.controller.ts`

**Context:** Replace the flat subject/unitMajor dropdowns with a cascading curriculum tree selector that supports both 2015 and 2022 curricula.

**Step 1: Add curriculum year toggle**

Add a toggle at the top of the problems page: "2015 교육과정" / "2022 교육과정". Default to 2015.

**Step 2: Replace flat filters with cascading selects**

When user selects curriculum year → fetch subjects via `GET /curriculum/subjects?year=N`. When subject selected → fetch units via `GET /curriculum/:parentId/children`. Cascade down to unitMinor.

**Step 3: Wire to problem search**

Pass the selected curriculum node ID to the problems API: `GET /problems?curriculumNodeId=xxx`. In the service, filter by `curriculumNodeId` or by all descendants of the selected node.

**Step 4: Verify**

```bash
pnpm dev:web
# Test: Select 2022 교육과정 → 대수 → 삼각함수 → verify problems filtered
```

**Step 5: Commit**

```bash
git add apps/web/ apps/lms-api/
git commit -m "feat: add cascading curriculum tree filter to problems page"
```

---

## Execution Order & Dependencies

```
Task 1 (DB Schema) ──→ Task 2 (API) ──→ Task 7 (OCR Link) ──→ Task 8 (Frontend)
                                              ↑
Task 3 (Difficulty) ──→ (independent)         │
Task 4 (Exam Tags) ──→ (independent)         │
Task 5 (Semantic Search) ──→ (independent)    │
Task 6 (Solution Tags) ──→ ──────────────────┘
```

Tasks 3, 4, 5, 6 are independent and can be parallelized.
Tasks 1→2→7→8 must be sequential.
