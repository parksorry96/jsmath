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

### Cross-Module Dependencies

`SubmissionsService` currently imports `WrongAnswersService` and `MasteryService` for post-grading hooks. `AssignmentsService` imports `RemediationService` for remediation generation.

**Resolution:** `StudentAiModule` exports `WrongAnswersService`, `MasteryService`, and `SmartRecommendService`. `SubmissionsModule` and `AssignmentsModule` import `StudentAiModule` to access these services. This preserves the call-site behavior while centralizing ownership.

```typescript
// student-ai.module.ts
@Module({
  exports: [WrongAnswersService, MasteryService, SmartRecommendService],
})
export class StudentAiModule {}

// submissions.module.ts
@Module({
  imports: [StudentAiModule],  // replaces WrongAnswersModule, MasteryModule
})
export class SubmissionsModule {}

// assignments.module.ts
@Module({
  imports: [StudentAiModule],  // replaces RemediationModule
})
export class AssignmentsModule {}
```

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

### New Table: `StudentWeaknessProfile`

```prisma
model StudentWeaknessProfile {
  id        String   @id @default(cuid())
  studentId String
  student   User     @relation(fields: [studentId], references: [id])

  weakUnits        Json     // [{ subject, unitMajor, accuracy, attemptCount, topErrorType }]
  rootCauses       Json     // [{ subject, unitMajor, reason, prerequisiteGaps }]
  errorPatterns    Json     // { concept_gap: N, calculation_error: N, careless_mistake: N, pattern_gap: N }

  aiSummary        String?  // GPT-generated weakness summary in Korean
  aiSummaryModel   String?  // "gpt-5.4"

  lastRecommendedAt DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([studentId])
  @@schema("public")
}
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
2. Build OpenAI messages array with `image_url` content part.
3. Include conversation history: past images are NOT re-sent as base64. Instead, past image analyses (stored in `metadata.imageAnalysis`) are included as text summaries.
4. Stream response via SSE (same pattern as existing tutor).
5. Store in `TutorMessage` with `metadata: { imageS3Key, imageAnalysis }`.

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
  Source: WeaknessProfile errorPatterns
  Logic:  Select problems known to trigger the same error type

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
