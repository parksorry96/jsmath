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
│   └── review-schedule.service.ts     # ← absorb from src/reviews/ (SM-2)
├── canvas/
│   └── canvas-upload.service.ts       # S3 upload for canvas/photo
├── processors/
│   └── weakness-aggregation.processor.ts  # BullMQ daily batch
└── dto/
    ├── send-tutor-message.dto.ts
    ├── weakness-profile.dto.ts
    └── recommend-request.dto.ts
```

### Dependency Rules

- Access DB via Prisma only — no imports from other NestJS modules.
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

Old module directories are deleted after migration. Old endpoints are removed (mobile app updated to use new paths).

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
| PATCH | `/student-ai/wrong-answers/:id/classify` | Reclassify error type |
| GET | `/student-ai/reviews/daily` | Get daily SM-2 review problems |
| POST | `/student-ai/reviews/:id/grade` | Grade a review item |
| GET | `/student-ai/mastery` | Get mastery dashboard |
| GET | `/student-ai/mastery/tree` | Get curriculum mastery tree |

### Teacher Endpoints (`/student-ai/teacher/`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/student-ai/teacher/class/:id/weakness` | Class weakness heatmap |
| GET | `/student-ai/teacher/student/:id/weakness` | Individual student weakness profile |

## 3. Database Schema

### New Table: `StudentWeaknessProfile`

```prisma
model StudentWeaknessProfile {
  id        String   @id @default(cuid())
  studentId String
  student   User     @relation(fields: [studentId], references: [id])

  weakUnits        Json     // [{ subject, unitMajor, accuracy, attemptCount, topErrorType }]
  rootCauses       Json     // [{ subject, unitMajor, reason, prerequisiteGaps }]
  errorPatterns    Json     // { concept_gap: N, calculation_error: N, ... }

  aiSummary        String?  // GPT-generated weakness summary in Korean
  aiSummaryModel   String?  // "gpt-5.4"

  lastRecommendedAt DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([studentId])
  @@schema("public")
}
```

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
3. Include full conversation history (previous images included via S3 URLs in metadata).
4. Stream response via SSE (same pattern as existing tutor).
5. Store in `TutorMessage` with `metadata: { imageS3Key, imageAnalysis }`.

### System Prompt Extension

Existing Socratic tutor rules are preserved. When an image is present, append:

```
When the student sends a handwritten solution image:
- Analyze each step of the solution in order.
- Identify the specific line and type of error (sign error, calculation error, concept gap, etc.).
- Point out what went wrong WITHOUT giving the correct answer.
- Guide the student to find the error themselves through questions.
- Respond in Korean.
```

### Conversation Context

- Previous messages with images: `metadata.imageS3Key` stored per message.
- GPT receives full history including past image analyses.
- Student can reference previous work: "아까 그 풀이에서 3번째 줄..."

## 5. Weakness Profile

### Data Sources

| Source | Data Extracted |
|--------|---------------|
| `WrongAnswer` | Error types per unit, frequency, recency |
| `StudentMastery` | Curriculum node mastery state, consecutive correct count |
| `TutorMessage.metadata` | AI-identified error patterns from tutor conversations |
| `KnowledgeGraph` (CurriculumPrerequisite) | Prerequisite gaps, root cause analysis via BFS |

### Update Triggers

- **Event-driven:** After submission grading, after tutor session ends.
- **Daily batch:** BullMQ cron at 03:00 AM — regenerate AI summary.

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

- **Automatic:** BullMQ cron at 02:00 AM daily, per student.
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

### Scope

| File | Change |
|------|--------|
| `apps/ocr-api/app/workers/analyze_photo.py` | `anthropic.Anthropic` → `openai.OpenAI` |
| `apps/ocr-api/app/workers/rubric_grader.py` | Same migration |

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
    model=settings.ai_model,  # "gpt-5.4"
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
apps/lms-api/src/student-ai/          # Entire new module (~15 files)
apps/mobile/components/canvas/         # React Native Skia canvas component
packages/db-schema/prisma/migrations/  # StudentWeaknessProfile migration
```

### Modified Files

```
apps/lms-api/src/app.module.ts         # Import StudentAiModule, remove old modules
apps/ocr-api/app/workers/analyze_photo.py   # Anthropic → OpenAI
apps/ocr-api/app/workers/rubric_grader.py   # Anthropic → OpenAI
apps/mobile/app/(student)/              # Canvas integration in student screens
packages/db-schema/prisma/schema.prisma     # Add StudentWeaknessProfile
packages/shared-types/src/index.ts          # Add student-ai types
```

### Deleted Files (after migration)

```
apps/lms-api/src/tutor/                # Absorbed into student-ai/tutor/
apps/lms-api/src/wrong-answers/        # Absorbed into student-ai/weakness/
apps/lms-api/src/mastery/              # Absorbed into student-ai/weakness/
apps/lms-api/src/reviews/              # Absorbed into student-ai/recommend/
apps/lms-api/src/remediation/          # Absorbed into student-ai/recommend/
```
