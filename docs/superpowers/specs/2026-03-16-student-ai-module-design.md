# StudentAI Module — Design Specification

**Date:** 2026-03-16
**Branch:** `feat/student-ai-module`
**Status:** Approved

## Overview

A self-contained NestJS module (`student-ai/`) that consolidates all student-facing AI features: tutor with vision, weakness profiling, and personalized problem recommendation. Designed for independent deployment as a separate app in the future.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Pencil input platform | Mobile app only | Tablet + Apple Pencil is the natural input device |
| AI model | GPT 5.4 unified | Tutor already uses GPT 5.4; unify photo analysis too |
| Image processing | Direct to GPT Vision, no OCR | Spatial context matters for error location; OCR loses layout |
| Usage scenarios | Tutor conversation + assignment submission | Both need canvas/photo input |
| Weakness audience | Student + Teacher | Students see own profile; teachers see class heatmap |
| Recommendation trigger | Auto daily + on-demand | SM-2 cron + manual "generate" button |
| Architecture | Standalone module, absorb existing services | Clean boundaries for future extraction as separate service |
| Cross-schema access | student-ai reads `ocr.*` tables via Prisma (read-only) | Existing absorbed services already query `Problem`, `CurriculumNode`, `ProblemSimilarity` |
| OCR migration scope | Separate companion PR, tested independently | Different service boundary (Python/Celery vs NestJS) |

## 1. Module Structure

```
apps/lms-api/src/student-ai/
├── student-ai.module.ts
├── student-ai.controller.ts           # Student endpoints
├── student-ai-teacher.controller.ts   # Teacher endpoints
├── tutor/
│   └── tutor-vision.service.ts        # Tutor + GPT 5.4 Vision
├── weakness/
│   ├── weakness-profile.service.ts    # Aggregation + AI summary
│   ├── wrong-answers.service.ts       # ← absorb from src/wrong-answers/
│   ├── mastery.service.ts             # ← absorb from src/mastery/
│   └── knowledge-graph.service.ts     # ← absorb from src/analytics/knowledge-graph
├── recommend/
│   ├── smart-recommend.service.ts     # ← absorb + extend src/remediation/
│   ├── review-schedule.service.ts     # ← absorb from src/reviews/ (SM-2)
│   └── sm2.ts                         # ← SM-2 algorithm utility (from src/reviews/sm2.ts)
├── canvas/
│   └── canvas-upload.service.ts       # S3 upload for canvas/photo
├── seed/
│   └── prerequisite-data.ts           # ← prerequisite graph seed data (from src/analytics/seed/)
├── processors/
│   └── weakness-aggregation.processor.ts  # BullMQ daily batch
└── dto/
    ├── send-tutor-message.dto.ts
    ├── weakness-profile.dto.ts
    └── recommend-request.dto.ts
```

### Dependency Rules

- Access DB via Prisma only — no imports from other NestJS modules.
- Cross-schema reads permitted: `student-ai` may read `ocr.*` tables (`Problem`, `CurriculumNode`, `ProblemSimilarity`) via Prisma. This is consistent with existing absorbed services. Write access to `ocr.*` is prohibited.
- Existing services (`TutorService`, `RemediationService`, `MasteryService`, `WrongAnswersService`, `ReviewsService`, `KnowledgeGraphService`) are absorbed, not imported.
- Code duplication is acceptable where it preserves module independence.
- The folder is extractable as-is for future microservice deployment.

### Migration Plan for Absorbed Services

| Existing Module | Action | Old Endpoints |
|-----------------|--------|---------------|
| `src/tutor/` | Move + enhance with Vision | `/tutor/*` → `/student-ai/tutor/*` |
| `src/wrong-answers/` | Move into `weakness/` | `/wrong-answers/*` → `/student-ai/wrong-answers/*` |
| `src/mastery/` | Move into `weakness/` | `/mastery/*` → `/student-ai/mastery/*` |
| `src/reviews/` | Move into `recommend/` | `/reviews/*` → `/student-ai/reviews/*` |
| `src/remediation/` | Move + extend as smart-recommend | `/remediation/*` → `/student-ai/recommendations/*` |
| `src/analytics/knowledge-graph*` | Move into `weakness/` | `/analytics/knowledge-graph` → internal only |

### Cross-Module Dependencies (Verified Call Graph)

Actual dependency graph from codebase analysis:

```
app.module.ts
├── imports: WrongAnswersModule (line 74) ← provides controller routes
├── imports: MasteryModule (line 75)      ← provides controller routes
├── imports: ReviewsModule (line 76)      ← provides controller routes
├── imports: RemediationModule (line 77)  ← provides controller routes

submissions.module.ts (line 11)
├── imports: WrongAnswersModule  ← for WrongAnswersService injection
├── imports: MasteryModule       ← for MasteryService injection
└── submissions.service.ts
    ├── injects: WrongAnswersService (line 30) → calls collectFromSubmission()
    └── injects: MasteryService (line 31)      → calls updateOnAnswer()

assignments.module.ts (line 8)
├── imports: RemediationModule   ← for RemediationService injection
└── assignments.controller.ts
    └── injects: RemediationService (line 33) → calls generateForAssignment()
```

**Resolution:** `StudentAiModule` exports the absorbed services. Consumer modules update their imports. Service class names are preserved to minimize call-site changes.

```typescript
// student-ai.module.ts
@Module({
  providers: [
    WrongAnswersService,
    MasteryService,
    SmartRecommendService,  // replaces RemediationService
    ReviewScheduleService,
    TutorVisionService,
    WeaknessProfileService,
    KnowledgeGraphService,
    CanvasUploadService,
  ],
  exports: [WrongAnswersService, MasteryService, SmartRecommendService],
})
export class StudentAiModule {}

// submissions.module.ts — CHANGE:
// Before: imports: [WrongAnswersModule, MasteryModule, ...]
// After:
@Module({
  imports: [StudentAiModule, GamificationModule, ClassMonitorModule],
})
export class SubmissionsModule {}

// assignments.module.ts — CHANGE:
// Before: imports: [RemediationModule, ProblemsModule]
// After:
@Module({
  imports: [StudentAiModule, ProblemsModule],
})
export class AssignmentsModule {}

// assignments.controller.ts — CHANGE:
// Before: import { RemediationService } from "../remediation/remediation.service";
// After:
import { SmartRecommendService } from "../student-ai/recommend/smart-recommend.service";
// SmartRecommendService exposes the same generateForAssignment() method

// app.module.ts — CHANGE:
// Remove: WrongAnswersModule, MasteryModule, ReviewsModule, RemediationModule
// Add: StudentAiModule (provides all controllers and routes)
```

**Migration execution order:**
1. Create `StudentAiModule` with all services, controllers, and exports
2. Update `submissions.module.ts`: replace `WrongAnswersModule, MasteryModule` → `StudentAiModule`
3. Update `assignments.module.ts`: replace `RemediationModule` → `StudentAiModule`
4. Update `assignments.controller.ts`: change `RemediationService` → `SmartRecommendService` import path
5. Update `app.module.ts`: remove 4 old modules, add `StudentAiModule`
6. Verify: `pnpm --filter @jsmath/lms-api build` must pass
7. Delete old module directories
8. Deploy redirect aliases for old endpoints (2-week transition)

### Endpoint Migration Strategy

Old endpoints are preserved as redirect aliases during a transition period (2 weeks), then removed. This allows the mobile app to be updated independently without coordinated deployment.

```typescript
// Temporary redirect controller (removed after mobile app update)
@Controller('tutor')
export class TutorRedirectController {
  @All('*')
  redirect(@Req() req) {
    return { statusCode: 301, url: `/student-ai/tutor${req.path}` };
  }
}
```

Old module directories are deleted after the transition period.

## 2. API Endpoints

### Student Endpoints (`/student-ai/`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/student-ai/tutor/sessions` | Create tutor session for a problem |
| POST | `/student-ai/tutor/sessions/:id/message` | Send message (text + optional image) |
| GET | `/student-ai/tutor/sessions/:id` | Get session history with messages |
| POST | `/student-ai/tutor/sessions/:id/end` | End session |
| POST | `/student-ai/canvas/upload` | Upload canvas PNG or photo to S3 |
| GET | `/student-ai/weakness` | Get own weakness profile |
| GET | `/student-ai/recommendations` | Get recommended problems |
| POST | `/student-ai/recommendations/generate` | Trigger immediate recommendation |
| GET | `/student-ai/wrong-answers` | List wrong answers (with filters) |
| GET | `/student-ai/wrong-answers/stats` | Wrong answer statistics |
| PATCH | `/student-ai/wrong-answers/:id/classify` | Reclassify error type |
| PATCH | `/student-ai/wrong-answers/:id/resolve` | Mark wrong answer as resolved |
| POST | `/student-ai/wrong-answers/:id/retry` | Record a retry attempt |
| GET | `/student-ai/reviews/daily` | Get daily SM-2 review problems |
| GET | `/student-ai/reviews/stats` | Review statistics |
| POST | `/student-ai/reviews/:id/grade` | Grade a review item |
| GET | `/student-ai/mastery` | Get mastery dashboard |
| GET | `/student-ai/mastery/tree` | Get curriculum mastery tree |
| GET | `/student-ai/mastery/:nodeId` | Get mastery for specific node |

### Teacher Endpoints (`/student-ai/teacher/`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/student-ai/teacher/class/:id/weakness` | Class weakness heatmap |
| GET | `/student-ai/teacher/student/:id/weakness` | Individual student weakness profile |
| POST | `/student-ai/teacher/seed-prerequisites` | Seed prerequisite graph data |

## 3. Database Schema

### New Tables

```prisma
model StudentWeaknessProfile {
  id        String   @id @default(cuid())
  studentId String
  student   User     @relation(fields: [studentId], references: [id])

  // Aggregate error counts (for student dashboard, cheap to read)
  errorPatterns    Json     // { concept_gap: N, calculation_error: N, careless_mistake: N, pattern_gap: N }
  rootCauses       Json     // [{ subject, unitMajor, reason, prerequisiteGaps }]

  aiSummary        String?  // GPT-generated weakness summary in Korean
  aiSummaryModel   String?  // "gpt-5.4"

  lastRecommendedAt DateTime?

  units     StudentWeaknessUnit[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([studentId])
  @@schema("public")
}

// Child table: indexed per-unit weakness data for class heatmap queries
model StudentWeaknessUnit {
  id        String   @id @default(cuid())
  profileId String
  profile   StudentWeaknessProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  subject      String    // e.g. "미적분"
  unitMajor    String    // e.g. "미분법"
  accuracy     Float     // 0.0 - 1.0
  attemptCount Int
  topErrorType String?   // canonical ErrorType enum value

  updatedAt DateTime @updatedAt

  @@unique([profileId, subject, unitMajor])
  @@index([subject, unitMajor])  // enables class heatmap: WHERE subject=X GROUP BY unitMajor
  @@schema("public")
}
```

The `StudentWeaknessUnit` child table enables efficient class-level queries:

```sql
-- Class heatmap: average accuracy per unit across all students in a class
SELECT swu.subject, swu.unit_major, AVG(swu.accuracy), COUNT(*)
FROM student_weakness_units swu
JOIN student_weakness_profiles swp ON swu.profile_id = swp.id
JOIN enrollments e ON swp.student_id = e.student_id
WHERE e.class_id = :classId
GROUP BY swu.subject, swu.unit_major
ORDER BY AVG(swu.accuracy) ASC;
```

### Profile Lifecycle

- **Creation:** Upsert on first submission grading or tutor session end. If no profile exists, create with initial data.
- **Update:** Upsert (Prisma `upsert`) on every trigger — never manual create/delete.
- **Daily batch scope:** Only students with activity in the last 7 days. Estimated max ~100 students per batch → ~100 GPT calls/day for AI summary regeneration.

### Existing Tables — No Changes

- `TutorSession`, `TutorMessage` (use existing `metadata: Json?` for image data)
- `WrongAnswer`, `ReviewSchedule`, `StudentMastery`
- `CurriculumPrerequisite`, `ProblemSimilarity`
- `Problem`, `SubmissionAnswer`, `SubmissionPhoto`

## 4. Tutor Vision

### Message DTO

```typescript
export class SendTutorMessageDto {
  @IsString()
  @MaxLength(2000)
  content: string;

  @IsOptional()
  @IsString()
  imageS3Key?: string;
}
```

### GPT 5.4 Vision Call

When `imageS3Key` is present:

1. Download image from S3, base64-encode.
2. Build OpenAI messages array with `image_url` content part (inline `data:` URI, NOT S3 URL — GPT cannot access S3 directly).
3. Stream response via SSE (same pattern as existing tutor).
4. Store in `TutorMessage` with `metadata: { imageS3Key, imageAnalysis }`.

### Image History Policy

Sending all past images as base64 on every turn is prohibitively expensive. The following policy applies:

- **Current turn image:** Sent as base64 `data:` URI in the `image_url` content part.
- **Last 1 previous image** (if exists): Re-sent as base64 to allow "compare with my previous attempt" conversations.
- **Older images (2+):** NOT re-sent. Only the structured `imageAnalysis` text from `metadata` is included as a system-injected assistant message: `"[Previous solution analysis: {imageAnalysis summary}]"`.

This keeps the per-turn payload to at most 2 images (~2 × 1024×1024 PNG ≈ 1-2MB base64) while preserving conversational context.

### Session Limits

- Maximum 5 images per session.
- Maximum 30 messages per session (auto-close with summary).
- Rate limit: 10 messages per minute per student.

### System Prompt Extension

Existing Socratic tutor rules are preserved. When an image is present, append:

```
When the student sends a handwritten solution image:
- Analyze each step of the solution in order.
- Identify the specific line and type of error.
- Classify the error as one of: concept_gap, pattern_gap, calculation_error, careless_mistake.
- Point out what went wrong WITHOUT giving the correct answer.
- Guide the student to find the error themselves through questions.
- Respond in Korean.
```

### Conversation Context

- Previous messages with images: `metadata.imageS3Key` stored per message.
- Past images are represented as text summaries of analysis results (not re-sent as base64).
- Student can reference previous work: "아까 그 풀이에서 3번째 줄..."

## 5. Weakness Profile

### Data Sources

| Source | Data Extracted |
|--------|---------------|
| `WrongAnswer` | Error types per unit, frequency, recency |
| `StudentMastery` | Curriculum node mastery state, consecutive correct count |
| `TutorMessage.metadata` | AI-identified error patterns from tutor conversations |
| `KnowledgeGraph` (CurriculumPrerequisite) | Prerequisite gaps, root cause analysis via BFS |

### Error Type Taxonomy (Canonical)

A single canonical taxonomy used across all components:

| ErrorType (Prisma enum) | Description | Sources |
|------------------------|-------------|---------|
| `concept_gap` | Fundamental misunderstanding | Tutor vision, wrong answer heuristic |
| `pattern_gap` | Cannot recognize problem pattern | Wrong answer heuristic |
| `calculation_error` | Arithmetic/algebraic mistake | Tutor vision, wrong answer heuristic |
| `careless_mistake` | Sign errors, transcription errors | Tutor vision, wrong answer heuristic |

The tutor vision system prompt instructs GPT to classify errors using these exact enum values. The `analyze_photo.py` prompt's finer-grained types (`sign_error`, `formula_error`, `logic_error`, `transcription_error`) are mapped to the canonical enum:
- `sign_error`, `transcription_error` → `careless_mistake`
- `formula_error`, `concept_error` → `concept_gap`
- `logic_error` → `pattern_gap`
- `calculation_error` → `calculation_error`

### Update Triggers

- **Event-driven:** After submission grading, after tutor session ends.
- **Daily batch:** BullMQ cron at 03:00 AM — regenerate AI summary for students with activity in the last 7 days.

### AI Summary Generation

GPT 5.4 receives aggregated weakness data and generates a Korean-language summary identifying:
- Primary weak areas with specific error patterns.
- Root cause analysis (prerequisite gaps).
- Actionable focus areas.

### Teacher View

- **Class heatmap:** Unit-level average accuracy across all students, highlighting weak units.
- **Student detail:** Individual `StudentWeaknessProfile` with AI summary.

## 6. Smart Recommend

### Priority Ranking

```
Priority 1: Prerequisite gap remediation
  Source: KnowledgeGraph rootCauses
  Logic:  Select easy problems (difficulty 1-2) from root cause units

Priority 2: Error pattern correction
  Source: WeaknessProfile errorPatterns + Problem.commonMistakes JSON
  Logic:  Query problems in the same curriculumNode where commonMistakes JSON
          contains entries matching the student's top error type.
          Fallback: if commonMistakes is null or no match, select same-unit
          problems at appropriate difficulty for the error type.
  Implementation: Prisma JSON filter on Problem.commonMistakes,
          e.g. { commonMistakes: { path: ['$[*].type'], array_contains: 'sign_error' } }
          Since commonMistakes is unstructured, a runtime filter on the
          fetched candidate set is acceptable for the initial version.
          Future: add a ProblemErrorTag indexed table if query performance degrades.

Priority 3: SM-2 spaced repetition review
  Source: ReviewSchedule (nextReviewAt <= now, wrongAnswer.resolvedAt IS NULL)
  Logic:  Existing SM-2 algorithm, unchanged

Priority 4: Similar problem expansion
  Source: ProblemSimilarity (cosine >= 0.6)
  Logic:  Existing similarity search, same curriculumNode
```

### Difficulty Progression

| Student Accuracy (unit) | Problem Difficulty Selected |
|-------------------------|---------------------------|
| < 40% | 1-2 (basic) |
| 40-70% | 2-3 (standard) |
| > 70% | 3-4 (advanced) |

### Common Filters

- `reviewStatus IN (approved, auto_approved)`
- Exclude already-correct problems.
- Prefer same `curriculumNodeId`.
- Maximum 10 problems per generation.

### Triggers

- **Automatic:** BullMQ cron at 02:00 AM daily. Scope: students with activity in the last 7 days.
- **Manual:** `POST /student-ai/recommendations/generate`.

### Output Shape

```json
{
  "recommendations": [
    {
      "problemId": "clx...",
      "reason": "prerequisite_gap | error_pattern | sm2_review | similar_expansion",
      "reasonDetail": "미분법 선수학습 보강",
      "priority": 1,
      "difficulty": 2
    }
  ],
  "summary": "함수의 극한 기초 3문제 + 미분법 연습 4문제 + 복습 3문제"
}
```

## 7. Mobile Canvas (Apple Pencil)

### Library

`@shopify/react-native-skia` — high-performance 2D rendering with native pressure sensitivity support.

### Canvas Component UX

```
┌─────────────────────────────┐
│  Problem display (stemLatex) │
├─────────────────────────────┤
│                             │
│   Canvas (pencil drawing)    │
│   • Pen / Eraser / Undo     │
│   • Pen thickness control    │
│                             │
├─────────────────────────────┤
│  [Send] [Clear] [Camera]    │
└─────────────────────────────┘
```

### Two Usage Contexts

**A) Tutor conversation:**
- "Send solution" button in chat → canvas modal opens.
- Draw → send → canvas rendered to PNG → S3 upload → tutor receives image.
- Alternatively: camera capture → same flow.

**B) Assignment submission:**
- Per-problem canvas opens → draw solution → PNG → existing `SubmissionPhoto` flow.

### Image Processing

- Canvas snapshot: `Skia.makeImageSnapshot()` → PNG buffer.
- Force white background (improves GPT Vision recognition).
- Resize to max 1024x1024 (API cost optimization).
- S3 key pattern: `canvas/{studentId}/{timestamp}.png`.

## 8. Photo Pipeline GPT Migration

**Note:** This is a companion change in a separate PR, tested independently from the NestJS module work. It affects the Python/Celery service boundary (`apps/ocr-api`).

### Scope

| File | Change |
|------|--------|
| `apps/ocr-api/app/workers/analyze_photo.py` | `anthropic.Anthropic` → `openai.OpenAI` |
| `apps/ocr-api/app/workers/rubric_grader.py` | Same migration |
| `apps/ocr-api/app/config.py` | Remove `anthropic_api_key`, ensure `ai_api_key`/`ai_model`/`ai_api_base_url` exist |

### Python Settings

Ensure these fields exist in `app/config.py` `Settings` class (some may already exist for other workers):

```python
ai_api_key: str = Field(alias="AI_API_KEY")
ai_model: str = Field(default="gpt-5.4", alias="AI_MODEL")
ai_api_base_url: str = Field(default="https://api.openai.com/v1", alias="AI_API_BASE_URL")
```

Remove: `anthropic_api_key` (no longer needed after migration).

### API Call Conversion

```python
# Before (Anthropic Claude)
client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
response = client.messages.create(
    model="claude-sonnet-4-6-20250514",
    messages=[{"role": "user", "content": [
        {"type": "image", "source": {"type": "base64", "media_type": mt, "data": b64}},
        {"type": "text", "text": prompt}
    ]}]
)
text = response.content[0].text

# After (OpenAI GPT 5.4)
client = openai.OpenAI(api_key=settings.ai_api_key, base_url=settings.ai_api_base_url)
response = client.chat.completions.create(
    model=settings.ai_model,
    messages=[{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": f"data:{mt};base64,{b64}"}},
        {"type": "text", "text": prompt}
    ]}]
)
text = response.choices[0].message.content
```

### What Stays the Same

- System prompts and user prompts: unchanged.
- Response JSON schema: unchanged.
- `_parse_llm_response` / `_parse_rubric_response`: unchanged.
- Redis publish events: unchanged.
- Retry logic and error handling: unchanged (adapt exception types from `anthropic.APIError` to `openai.APIError`).
- Chained rubric grading trigger: unchanged.

## 9. Testing Strategy

| Layer | Approach |
|-------|----------|
| Unit tests | Each service in `student-ai/` — mock Prisma, mock OpenAI |
| Integration | Tutor Vision with real GPT call + test image |
| Canvas | Manual testing on iPad with Apple Pencil |
| Migration | Run existing photo analysis tests against GPT 5.4 |
| Recommendation | Unit test priority ranking logic with seeded data |

## 10. File Changes Summary

### New Files

```
apps/lms-api/src/student-ai/          # Entire new module (~18 files)
apps/mobile/components/canvas/         # React Native Skia canvas component
packages/db-schema/prisma/migrations/  # StudentWeaknessProfile migration
```

### Modified Files

```
apps/lms-api/src/app.module.ts             # Import StudentAiModule, remove old modules
apps/lms-api/src/submissions/submissions.module.ts  # Import StudentAiModule (replaces WrongAnswersModule, MasteryModule)
apps/lms-api/src/assignments/assignments.module.ts   # Import StudentAiModule (replaces RemediationModule)
apps/mobile/app/(student)/                  # Canvas integration in student screens
packages/db-schema/prisma/schema.prisma     # Add StudentWeaknessProfile
packages/shared-types/src/index.ts          # Add student-ai types
```

### Modified Files (Separate PR: GPT Migration)

```
apps/ocr-api/app/workers/analyze_photo.py   # Anthropic → OpenAI
apps/ocr-api/app/workers/rubric_grader.py   # Anthropic → OpenAI
apps/ocr-api/app/config.py                  # Settings field updates
```

### Deleted Files (after 2-week transition period)

```
apps/lms-api/src/tutor/                # Absorbed into student-ai/tutor/
apps/lms-api/src/wrong-answers/        # Absorbed into student-ai/weakness/
apps/lms-api/src/mastery/              # Absorbed into student-ai/weakness/
apps/lms-api/src/reviews/              # Absorbed into student-ai/recommend/
apps/lms-api/src/remediation/          # Absorbed into student-ai/recommend/
apps/lms-api/src/analytics/seed/       # Moved to student-ai/seed/
```
