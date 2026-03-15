# StudentAI Module Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate all student-facing AI features (tutor with vision, weakness profiling, smart recommendation) into a self-contained `student-ai` NestJS module.

**Architecture:** Absorb 6 existing services into a new `student-ai/` module, enhance tutor with GPT 5.4 Vision for handwritten solution analysis, add weakness profiling with AI summaries, and extend recommendation with prerequisite-based priority ranking.

**Tech Stack:** NestJS, Prisma, OpenAI GPT 5.4 Vision, BullMQ, S3 (AWS SDK v3), Jest

**Spec:** `docs/superpowers/specs/2026-03-16-student-ai-module-design.md`

**Worktree:** `/Users/parkjisong/jsmath-student-ai` (branch: `feat/student-ai-module`)

---

## Chunk 1: Foundation (Schema + Absorption + Wiring)

### Task 1: Add database schema

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`
- Create: `packages/db-schema/prisma/migrations/20260316120000_add_student_weakness_profile/migration.sql`

- [ ] **Step 1: Add StudentWeaknessProfile and StudentWeaknessUnit models to Prisma schema**

In `packages/db-schema/prisma/schema.prisma`, add after the existing `StudentMastery` model:

```prisma
model StudentWeaknessProfile {
  id        String   @id @default(cuid())
  studentId String
  student   User     @relation(fields: [studentId], references: [id])

  errorPatterns    Json
  rootCauses       Json

  aiSummary        String?
  aiSummaryModel   String?

  lastRecommendedAt DateTime?

  units     StudentWeaknessUnit[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([studentId])
  @@map("student_weakness_profiles")
  @@schema("public")
}

model StudentWeaknessUnit {
  id        String   @id @default(cuid())
  profileId String
  profile   StudentWeaknessProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)

  subject      String
  unitMajor    String   @map("unit_major")
  accuracy     Float
  attemptCount Int      @map("attempt_count")
  topErrorType String?  @map("top_error_type")

  updatedAt DateTime @updatedAt

  @@unique([profileId, subject, unitMajor])
  @@index([subject, unitMajor])
  @@map("student_weakness_units")
  @@schema("public")
}
```

Also add the relation to the `User` model:
```prisma
// In User model, add:
weaknessProfile  StudentWeaknessProfile?
```

- [ ] **Step 2: Generate migration**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && pnpm --filter @jsmath/db-schema db:migrate --name add_student_weakness_profile
```
Expected: Migration SQL created successfully.

- [ ] **Step 3: Generate Prisma client**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && pnpm --filter @jsmath/db-schema db:generate
```
Expected: Prisma client generated with new models.

- [ ] **Step 4: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add packages/db-schema/prisma/schema.prisma packages/db-schema/prisma/migrations/
git commit -m "feat(schema): add StudentWeaknessProfile and StudentWeaknessUnit tables"
```

---

### Task 2: Create student-ai module skeleton and absorb existing services

**Files:**
- Create: `apps/lms-api/src/student-ai/student-ai.module.ts`
- Create: `apps/lms-api/src/student-ai/tutor/tutor-vision.service.ts`
- Create: `apps/lms-api/src/student-ai/weakness/wrong-answers.service.ts`
- Create: `apps/lms-api/src/student-ai/weakness/mastery.service.ts`
- Create: `apps/lms-api/src/student-ai/weakness/knowledge-graph.service.ts`
- Create: `apps/lms-api/src/student-ai/recommend/smart-recommend.service.ts`
- Create: `apps/lms-api/src/student-ai/recommend/review-schedule.service.ts`
- Create: `apps/lms-api/src/student-ai/recommend/sm2.ts`
- Create: `apps/lms-api/src/student-ai/seed/prerequisite-data.ts`
- Create: `apps/lms-api/src/student-ai/dto/send-tutor-message.dto.ts`

- [ ] **Step 1: Create directory structure**

```bash
cd /Users/parkjisong/jsmath-student-ai/apps/lms-api/src
mkdir -p student-ai/{tutor,weakness,recommend,canvas,processors,dto,seed}
```

- [ ] **Step 2: Copy and adapt existing services**

Copy each existing service into the new module structure. For each file, update only the import paths — do not change logic yet.

```bash
cd /Users/parkjisong/jsmath-student-ai/apps/lms-api/src

# Tutor (will enhance with vision later)
cp tutor/tutor.service.ts student-ai/tutor/tutor-vision.service.ts

# Weakness services
cp wrong-answers/wrong-answers.service.ts student-ai/weakness/wrong-answers.service.ts
cp mastery/mastery.service.ts student-ai/weakness/mastery.service.ts
cp analytics/knowledge-graph.service.ts student-ai/weakness/knowledge-graph.service.ts

# Recommend services
cp remediation/remediation.service.ts student-ai/recommend/smart-recommend.service.ts
cp reviews/reviews.service.ts student-ai/recommend/review-schedule.service.ts
cp reviews/sm2.ts student-ai/recommend/sm2.ts

# Seed data
cp analytics/seed/prerequisite-data.ts student-ai/seed/prerequisite-data.ts
```

- [ ] **Step 3: Update import paths in copied files**

For each copied service file, fix relative imports:
- `"../common/..."` → `"../../common/..."`
- `"./sm2"` → stays `"./sm2"` (same directory)
- `"./seed/prerequisite-data"` → `"../seed/prerequisite-data"`

Rename the class in `tutor-vision.service.ts`:
- `TutorService` → `TutorVisionService`

Rename the class in `smart-recommend.service.ts`:
- `RemediationService` → `SmartRecommendService`
- Preserve `generateForAssignment()` method signature (used by AssignmentsController)

Rename the class in `review-schedule.service.ts`:
- `ReviewsService` → `ReviewScheduleService`

- [ ] **Step 4: Create the SendTutorMessageDto**

Write `apps/lms-api/src/student-ai/dto/send-tutor-message.dto.ts`:

```typescript
import { IsString, MaxLength, IsOptional } from "class-validator";

export class SendTutorMessageDto {
  @IsString()
  @MaxLength(2000)
  content: string;

  @IsOptional()
  @IsString()
  imageS3Key?: string;
}
```

- [ ] **Step 5: Create the module definition**

Write `apps/lms-api/src/student-ai/student-ai.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { TutorVisionService } from "./tutor/tutor-vision.service";
import { WrongAnswersService } from "./weakness/wrong-answers.service";
import { MasteryService } from "./weakness/mastery.service";
import { KnowledgeGraphService } from "./weakness/knowledge-graph.service";
import { SmartRecommendService } from "./recommend/smart-recommend.service";
import { ReviewScheduleService } from "./recommend/review-schedule.service";

@Module({
  providers: [
    TutorVisionService,
    WrongAnswersService,
    MasteryService,
    KnowledgeGraphService,
    SmartRecommendService,
    ReviewScheduleService,
  ],
  exports: [WrongAnswersService, MasteryService, SmartRecommendService],
})
export class StudentAiModule {}
```

- [ ] **Step 6: Verify build compiles**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && pnpm --filter @jsmath/lms-api build
```
Expected: Build succeeds (module exists but is not imported anywhere yet).

- [ ] **Step 7: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add apps/lms-api/src/student-ai/
git commit -m "feat(student-ai): create module skeleton with absorbed services"
```

---

### Task 3: Wire module into app and update consumer dependencies

**Files:**
- Modify: `apps/lms-api/src/app.module.ts`
- Modify: `apps/lms-api/src/submissions/submissions.module.ts`
- Modify: `apps/lms-api/src/submissions/submissions.service.ts`
- Modify: `apps/lms-api/src/assignments/assignments.module.ts`
- Modify: `apps/lms-api/src/assignments/assignments.controller.ts`

- [ ] **Step 1: Update submissions.module.ts**

Replace `WrongAnswersModule` and `MasteryModule` imports with `StudentAiModule`:

```typescript
// Remove:
import { WrongAnswersModule } from "../wrong-answers/wrong-answers.module";
import { MasteryModule } from "../mastery/mastery.module";

// Add:
import { StudentAiModule } from "../student-ai/student-ai.module";

// In imports array: replace WrongAnswersModule, MasteryModule with StudentAiModule
```

- [ ] **Step 2: Update submissions.service.ts import paths**

```typescript
// Remove:
import { WrongAnswersService } from "../wrong-answers/wrong-answers.service";
import { MasteryService } from "../mastery/mastery.service";

// Add:
import { WrongAnswersService } from "../student-ai/weakness/wrong-answers.service";
import { MasteryService } from "../student-ai/weakness/mastery.service";
```

- [ ] **Step 3: Update assignments.module.ts**

Replace `RemediationModule` with `StudentAiModule`:

```typescript
// Remove:
import { RemediationModule } from "../remediation/remediation.module";

// Add:
import { StudentAiModule } from "../student-ai/student-ai.module";

// In imports array: replace RemediationModule with StudentAiModule
```

- [ ] **Step 4: Update assignments.controller.ts**

```typescript
// Remove:
import { RemediationService } from "../remediation/remediation.service";

// Add:
import { SmartRecommendService } from "../student-ai/recommend/smart-recommend.service";

// In constructor: replace RemediationService with SmartRecommendService
// SmartRecommendService has the same generateForAssignment() method
```

- [ ] **Step 5: Update app.module.ts**

```typescript
// Remove these imports and from the imports array:
import { WrongAnswersModule } from "./wrong-answers/wrong-answers.module";
import { MasteryModule } from "./mastery/mastery.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { RemediationModule } from "./remediation/remediation.module";
import { TutorModule } from "./tutor/tutor.module";

// Add:
import { StudentAiModule } from "./student-ai/student-ai.module";

// In imports array: add StudentAiModule (replaces all 5 removed modules)
```

- [ ] **Step 6: Verify build passes**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && pnpm --filter @jsmath/lms-api build
```
Expected: Build succeeds with new module wiring.

- [ ] **Step 7: Run existing tests**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && pnpm --filter @jsmath/lms-api test
```
Expected: All existing tests pass (behavior unchanged, only import paths changed).

- [ ] **Step 8: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add apps/lms-api/src/app.module.ts apps/lms-api/src/submissions/ apps/lms-api/src/assignments/
git commit -m "feat(student-ai): wire module into app, update consumer dependencies"
```

---

### Task 4: Delete old module directories

**IMPORTANT:** This task must run AFTER Tasks 10, 11, and 15 are complete (all new controllers and redirect aliases in place). Otherwise the app will have no controllers for these routes.

**Files:**
- Delete: `apps/lms-api/src/tutor/`
- Delete: `apps/lms-api/src/wrong-answers/`
- Delete: `apps/lms-api/src/mastery/`
- Delete: `apps/lms-api/src/reviews/`
- Delete: `apps/lms-api/src/remediation/`
- Delete: `apps/lms-api/src/analytics/seed/`
- Modify: `apps/lms-api/src/analytics/analytics.module.ts` (remove KnowledgeGraph references if present)

- [ ] **Step 1: Verify new controllers exist before deleting**

```bash
cd /Users/parkjisong/jsmath-student-ai/apps/lms-api/src
test -f student-ai/student-ai.controller.ts && test -f student-ai/student-ai-teacher.controller.ts && test -f student-ai/redirect.controller.ts && echo "All controllers ready" || echo "ABORT: controllers missing"
```
Expected: "All controllers ready". Do NOT proceed if controllers are missing.

- [ ] **Step 2: Delete old directories**

```bash
cd /Users/parkjisong/jsmath-student-ai/apps/lms-api/src
rm -rf tutor/ wrong-answers/ mastery/ reviews/ remediation/ analytics/seed/
```

- [ ] **Step 3: Remove KnowledgeGraphService from analytics module**

In `apps/lms-api/src/analytics/analytics.module.ts`, remove the import and provider for `KnowledgeGraphService` (it now lives in student-ai).

- [ ] **Step 4: Verify build passes**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && pnpm --filter @jsmath/lms-api build
```
Expected: Build succeeds — all references now point to student-ai module.

- [ ] **Step 5: Run tests**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && pnpm --filter @jsmath/lms-api test
```
Expected: Tests pass. Old spec files from deleted directories are replaced by new tests in student-ai.

- [ ] **Step 6: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add -A
git commit -m "refactor(student-ai): delete old module directories after absorption"
```

---

## Chunk 2: Core Features (Canvas + Tutor Vision + Weakness Profile)

### Task 5: Canvas upload service

**Files:**
- Create: `apps/lms-api/src/student-ai/canvas/canvas-upload.service.ts`
- Create: `apps/lms-api/src/student-ai/canvas/canvas-upload.service.spec.ts`

- [ ] **Step 1: Write the test**

Write `apps/lms-api/src/student-ai/canvas/canvas-upload.service.spec.ts`:

```typescript
import { CanvasUploadService } from "./canvas-upload.service";

describe("CanvasUploadService", () => {
  const mockS3Send = jest.fn().mockResolvedValue({});
  const mockConfig = {
    get: jest.fn((key: string) => {
      const map: Record<string, string> = {
        S3_BUCKET: "test-bucket",
        S3_REGION: "ap-northeast-2",
        S3_ACCESS_KEY_ID: "test-key",
        S3_SECRET_ACCESS_KEY: "test-secret",
      };
      return map[key];
    }),
    getOrThrow: jest.fn((key: string) => {
      const map: Record<string, string> = {
        S3_BUCKET: "test-bucket",
        S3_REGION: "ap-northeast-2",
        S3_ACCESS_KEY_ID: "test-key",
        S3_SECRET_ACCESS_KEY: "test-secret",
      };
      return map[key];
    }),
  };

  it("generates correct S3 key pattern", async () => {
    const service = new CanvasUploadService(mockConfig as never);
    (service as any).s3 = { send: mockS3Send };

    const result = await service.upload("student-123", Buffer.from("png"), "image/png");

    expect(result.s3Key).toMatch(/^canvas\/student-123\/\d+\.png$/);
    expect(mockS3Send).toHaveBeenCalledTimes(1);
  });

  it("rejects non-image MIME types", async () => {
    const service = new CanvasUploadService(mockConfig as never);
    await expect(
      service.upload("student-123", Buffer.from("data"), "application/pdf"),
    ).rejects.toThrow("Unsupported");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && npx jest apps/lms-api/src/student-ai/canvas/canvas-upload.service.spec.ts --no-cache
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement CanvasUploadService**

Write `apps/lms-api/src/student-ai/canvas/canvas-upload.service.ts`:

```typescript
import { Injectable, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

@Injectable()
export class CanvasUploadService {
  private s3: S3Client;
  private bucket: string;

  constructor(private config: ConfigService) {
    const region =
      this.config.get<string>("AWS_REGION") ??
      this.config.getOrThrow<string>("S3_REGION");
    const accessKeyId =
      this.config.get<string>("AWS_ACCESS_KEY_ID") ??
      this.config.getOrThrow<string>("S3_ACCESS_KEY_ID");
    const secretAccessKey =
      this.config.get<string>("AWS_SECRET_ACCESS_KEY") ??
      this.config.getOrThrow<string>("S3_SECRET_ACCESS_KEY");

    this.s3 = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    this.bucket = this.config.getOrThrow<string>("S3_BUCKET");
  }

  async upload(
    studentId: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ s3Key: string }> {
    if (!ALLOWED_MIME.has(mimeType)) {
      throw new BadRequestException(`Unsupported MIME type: ${mimeType}`);
    }

    const ext = MIME_EXT[mimeType];
    const s3Key = `canvas/${studentId}/${Date.now()}.${ext}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: buffer,
        ContentType: mimeType,
      }),
    );

    return { s3Key };
  }

  async downloadAsBase64(s3Key: string): Promise<{ base64: string; mimeType: string }> {
    const response = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: s3Key }),
    );
    const bytes = await response.Body!.transformToByteArray();
    const ext = s3Key.split(".").pop() ?? "png";
    const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    return { base64: Buffer.from(bytes).toString("base64"), mimeType };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && npx jest apps/lms-api/src/student-ai/canvas/canvas-upload.service.spec.ts --no-cache
```
Expected: PASS.

- [ ] **Step 5: Add CanvasUploadService to StudentAiModule providers**

In `student-ai.module.ts`, add `CanvasUploadService` to the providers array.

- [ ] **Step 6: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add apps/lms-api/src/student-ai/canvas/ apps/lms-api/src/student-ai/student-ai.module.ts
git commit -m "feat(student-ai): add canvas upload service with S3 integration"
```

---

### Task 6: Enhance tutor with Vision support

**Files:**
- Modify: `apps/lms-api/src/student-ai/tutor/tutor-vision.service.ts`
- Create: `apps/lms-api/src/student-ai/tutor/tutor-vision.service.spec.ts`

- [ ] **Step 1: Write tests for image handling**

Write `apps/lms-api/src/student-ai/tutor/tutor-vision.service.spec.ts`:

```typescript
import { TutorVisionService } from "./tutor-vision.service";

describe("TutorVisionService", () => {
  describe("buildMessagesWithImages", () => {
    it("includes current image as base64 data URI", () => {
      const service = new TutorVisionService(
        {} as never, // prisma
        { get: jest.fn().mockReturnValue("test-key"), getOrThrow: jest.fn() } as never, // config
        { downloadAsBase64: jest.fn() } as never, // canvasUpload
      );

      const messages = (service as any).buildVisionMessages(
        [{ role: "user", content: [
          { type: "text", text: "여기 풀이 봐주세요" },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
        ]}],
      );

      expect(messages[0].content).toHaveLength(2);
      expect(messages[0].content[1].type).toBe("image_url");
    });
  });

  describe("session limits", () => {
    it("rejects messages beyond image limit", async () => {
      // Session with 5 existing images should reject a 6th
      const service = createTestService();
      const session = createSessionWithImages(5);

      await expect(
        (service as any).validateSessionLimits(session, "s3key"),
      ).rejects.toThrow("Maximum 5 images");
    });

    it("rejects messages beyond message limit", async () => {
      const service = createTestService();
      const session = createSessionWithMessages(30);

      await expect(
        (service as any).validateSessionLimits(session, undefined),
      ).rejects.toThrow("Maximum 30 messages");
    });
  });
});

function createTestService() {
  return new TutorVisionService(
    {} as never,
    { get: jest.fn().mockReturnValue("key"), getOrThrow: jest.fn() } as never,
    { downloadAsBase64: jest.fn() } as never,
  );
}

function createSessionWithImages(count: number) {
  return {
    messages: Array.from({ length: count }, (_, i) => ({
      role: "student",
      metadata: { imageS3Key: `canvas/s/${i}.png` },
    })),
  };
}

function createSessionWithMessages(count: number) {
  return {
    messages: Array.from({ length: count }, () => ({
      role: "student",
      metadata: null,
    })),
  };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && npx jest apps/lms-api/src/student-ai/tutor/tutor-vision.service.spec.ts --no-cache
```
Expected: FAIL.

- [ ] **Step 3: Implement Vision enhancements in TutorVisionService**

Modify `apps/lms-api/src/student-ai/tutor/tutor-vision.service.ts`. Key changes from the original `TutorService`:

1. Add `CanvasUploadService` injection
2. Add `validateSessionLimits(session, imageS3Key?)` method:
   - Count images in session messages (where `metadata.imageS3Key` exists) — reject if >= 5
   - Count total messages — reject if >= 30
3. Modify `sendMessage()` to accept optional `imageS3Key`:
   - If present, download from S3 via `CanvasUploadService.downloadAsBase64()`
   - Store `metadata: { imageS3Key, imageAnalysis: null }` on the student message
   - After GPT responds, extract error analysis from response and update metadata
4. Modify `buildConversationMessages()` for image history policy:
   - Current turn image: include as `{ type: "image_url", image_url: { url: "data:..." } }`
   - Last 1 previous image message: re-download from S3, include as base64
   - Older image messages: inject `[Previous solution analysis: {imageAnalysis}]` text only
5. Extend `buildSystemPrompt()` to include image analysis instructions when session has images
6. Change model from hardcoded `"gpt-5.4"` to `this.config.get("AI_MODEL") ?? "gpt-5.4"`

- [ ] **Step 4: Run tests**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && npx jest apps/lms-api/src/student-ai/tutor/tutor-vision.service.spec.ts --no-cache
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add apps/lms-api/src/student-ai/tutor/
git commit -m "feat(student-ai): add GPT 5.4 Vision support to tutor service"
```

---

### Task 7: Weakness profile service

**Files:**
- Create: `apps/lms-api/src/student-ai/weakness/weakness-profile.service.ts`
- Create: `apps/lms-api/src/student-ai/weakness/weakness-profile.service.spec.ts`

- [ ] **Step 1: Write tests**

Write `apps/lms-api/src/student-ai/weakness/weakness-profile.service.spec.ts`:

```typescript
import { WeaknessProfileService } from "./weakness-profile.service";

describe("WeaknessProfileService", () => {
  describe("aggregateErrorPatterns", () => {
    it("counts error types from wrong answers", () => {
      const service = createTestService();
      const wrongAnswers = [
        { errorType: "concept_gap" },
        { errorType: "concept_gap" },
        { errorType: "calculation_error" },
        { errorType: "careless_mistake" },
      ];

      const result = (service as any).aggregateErrorPatterns(wrongAnswers);

      expect(result).toEqual({
        concept_gap: 2,
        calculation_error: 1,
        careless_mistake: 1,
        pattern_gap: 0,
      });
    });
  });

  describe("computeUnitAccuracy", () => {
    it("groups submission answers by unit and computes accuracy", () => {
      const service = createTestService();
      const answers = [
        { isCorrect: true, problem: { subject: "미적분", unitMajor: "미분법" } },
        { isCorrect: false, problem: { subject: "미적분", unitMajor: "미분법" } },
        { isCorrect: true, problem: { subject: "수학II", unitMajor: "함수의 극한" } },
      ];

      const result = (service as any).computeUnitAccuracy(answers);

      expect(result).toEqual([
        { subject: "미적분", unitMajor: "미분법", accuracy: 0.5, attemptCount: 2, topErrorType: null },
        { subject: "수학II", unitMajor: "함수의 극한", accuracy: 1.0, attemptCount: 1, topErrorType: null },
      ]);
    });
  });

  describe("mapErrorType", () => {
    it("maps fine-grained error types to canonical enum", () => {
      const service = createTestService();
      expect((service as any).mapErrorType("sign_error")).toBe("careless_mistake");
      expect((service as any).mapErrorType("formula_error")).toBe("concept_gap");
      expect((service as any).mapErrorType("logic_error")).toBe("pattern_gap");
      expect((service as any).mapErrorType("calculation_error")).toBe("calculation_error");
      expect((service as any).mapErrorType("transcription_error")).toBe("careless_mistake");
      expect((service as any).mapErrorType("concept_error")).toBe("concept_gap");
    });
  });
});

function createTestService() {
  return new WeaknessProfileService(
    {} as never, // prisma
    {} as never, // knowledgeGraph
    { get: jest.fn().mockReturnValue("test-key") } as never, // config
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && npx jest apps/lms-api/src/student-ai/weakness/weakness-profile.service.spec.ts --no-cache
```
Expected: FAIL.

- [ ] **Step 3: Implement WeaknessProfileService**

Write `apps/lms-api/src/student-ai/weakness/weakness-profile.service.ts`:

Core methods:
- `updateProfile(studentId)` — main entry point, called after grading or tutor session end
  1. Query unresolved `WrongAnswer` records for student (last 30 days)
  2. Query `SubmissionAnswer` with `Problem` join for unit accuracy
  3. Extract tutor error patterns from `TutorMessage.metadata`
  4. Call `KnowledgeGraphService.getStudentKnowledgeGraph(studentId)` for root causes
  5. Aggregate error patterns via `aggregateErrorPatterns()`
  6. Compute unit accuracy via `computeUnitAccuracy()`
  7. Upsert `StudentWeaknessProfile` + upsert `StudentWeaknessUnit` records
- `aggregateErrorPatterns(wrongAnswers)` — count by canonical error type
- `computeUnitAccuracy(answers)` — group by (subject, unitMajor), compute ratio
- `mapErrorType(fineGrained)` — map to canonical enum
- `generateAiSummary(profileData)` — call GPT 5.4 with aggregated data, return Korean summary
- `getProfile(studentId)` — read profile with units
- `getClassHeatmap(classId)` — query `StudentWeaknessUnit` with enrollment join, GROUP BY unit
- `getStudentWeakness(studentId)` — profile + AI summary for teacher view

- [ ] **Step 4: Run tests**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && npx jest apps/lms-api/src/student-ai/weakness/weakness-profile.service.spec.ts --no-cache
```
Expected: PASS.

- [ ] **Step 5: Add WeaknessProfileService to module**

In `student-ai.module.ts`, add `WeaknessProfileService` to providers.

- [ ] **Step 6: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add apps/lms-api/src/student-ai/weakness/weakness-profile*
git commit -m "feat(student-ai): add weakness profile service with aggregation and AI summary"
```

---

## Chunk 3: Recommendation + Batch + Controllers

### Task 8: Extend SmartRecommendService with priority ranking

**Files:**
- Modify: `apps/lms-api/src/student-ai/recommend/smart-recommend.service.ts`
- Create: `apps/lms-api/src/student-ai/recommend/smart-recommend.service.spec.ts`

- [ ] **Step 1: Write tests for priority ranking**

Write `apps/lms-api/src/student-ai/recommend/smart-recommend.service.spec.ts`:

```typescript
import { SmartRecommendService } from "./smart-recommend.service";

describe("SmartRecommendService", () => {
  describe("selectDifficulty", () => {
    it("returns 1-2 for accuracy below 40%", () => {
      const service = createTestService();
      expect((service as any).selectDifficulty(0.3)).toEqual([1, 2]);
    });

    it("returns 2-3 for accuracy 40-70%", () => {
      const service = createTestService();
      expect((service as any).selectDifficulty(0.55)).toEqual([2, 3]);
    });

    it("returns 3-4 for accuracy above 70%", () => {
      const service = createTestService();
      expect((service as any).selectDifficulty(0.85)).toEqual([3, 4]);
    });
  });

  describe("mergeAndRank", () => {
    it("deduplicates and orders by priority", () => {
      const service = createTestService();
      const items = [
        { problemId: "a", priority: 3, reason: "sm2_review" },
        { problemId: "b", priority: 1, reason: "prerequisite_gap" },
        { problemId: "a", priority: 1, reason: "prerequisite_gap" }, // duplicate
        { problemId: "c", priority: 2, reason: "error_pattern" },
      ];

      const result = (service as any).mergeAndRank(items, 10);

      expect(result).toHaveLength(3);
      expect(result[0].problemId).toBe("b");
      expect(result[1].problemId).toBe("c");
      expect(result[2].problemId).toBe("a");
    });

    it("limits to max count", () => {
      const service = createTestService();
      const items = Array.from({ length: 20 }, (_, i) => ({
        problemId: `p${i}`, priority: 1, reason: "prerequisite_gap",
      }));

      const result = (service as any).mergeAndRank(items, 10);
      expect(result).toHaveLength(10);
    });
  });
});

function createTestService() {
  return new SmartRecommendService({} as never);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && npx jest apps/lms-api/src/student-ai/recommend/smart-recommend.service.spec.ts --no-cache
```
Expected: FAIL.

- [ ] **Step 3: Add new methods to SmartRecommendService**

Add to the existing (absorbed) service:

- `generateRecommendations(studentId)` — main entry point:
  1. Load `StudentWeaknessProfile` with units
  2. Priority 1: Query problems from `rootCauses` units at difficulty 1-2
  3. Priority 2: Query problems with matching `commonMistakes` JSON (runtime filter)
  4. Priority 3: Get SM-2 review items via `ReviewScheduleService.getDailyReview()`
  5. Priority 4: Existing `findSimilarProblems()` for expansion
  6. Call `mergeAndRank()`, limit to 10
  7. Update `StudentWeaknessProfile.lastRecommendedAt`
  8. Return `{ recommendations, summary }`
- `selectDifficulty(accuracy)` — returns `[min, max]` difficulty range
- `mergeAndRank(items, maxCount)` — deduplicate by problemId, sort by priority, limit
- `filterCommonMistakes(problems, targetErrorType)` — runtime filter on `commonMistakes` JSON

Preserve existing methods (`generateForStudent`, `generateForAssignment`, `findSimilarProblems`).

- [ ] **Step 4: Run tests**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && npx jest apps/lms-api/src/student-ai/recommend/smart-recommend.service.spec.ts --no-cache
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add apps/lms-api/src/student-ai/recommend/
git commit -m "feat(student-ai): add priority-ranked smart recommendation engine"
```

---

### Task 9: BullMQ processors for daily batch

**Files:**
- Create: `apps/lms-api/src/student-ai/processors/weakness-aggregation.processor.ts`
- Modify: `apps/lms-api/src/student-ai/student-ai.module.ts`

- [ ] **Step 1: Implement the processor**

Write `apps/lms-api/src/student-ai/processors/weakness-aggregation.processor.ts`:

```typescript
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { WeaknessProfileService } from "../weakness/weakness-profile.service";
import { SmartRecommendService } from "../recommend/smart-recommend.service";

@Processor("student-ai-batch")
export class WeaknessAggregationProcessor extends WorkerHost {
  private logger = new Logger(WeaknessAggregationProcessor.name);

  constructor(
    private prisma: PrismaService,
    private weaknessProfile: WeaknessProfileService,
    private smartRecommend: SmartRecommendService,
  ) {
    super();
  }

  async process(job: Job) {
    if (job.name === "daily-weakness-summary") {
      return this.runWeaknessSummary();
    }
    if (job.name === "daily-recommendations") {
      return this.runRecommendations();
    }
  }

  private async runWeaknessSummary() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeStudents = await this.prisma.submission.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, student: { role: "student" } },
      select: { studentId: true },
      distinct: ["studentId"],
    });

    this.logger.log(`Updating weakness profiles for ${activeStudents.length} students`);

    for (const { studentId } of activeStudents) {
      try {
        await this.weaknessProfile.updateProfile(studentId);
      } catch (err) {
        this.logger.error(`Failed to update profile for ${studentId}`, err);
      }
    }

    return { studentsProcessed: activeStudents.length };
  }

  private async runRecommendations() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeStudents = await this.prisma.submission.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, student: { role: "student" } },
      select: { studentId: true },
      distinct: ["studentId"],
    });

    this.logger.log(`Generating recommendations for ${activeStudents.length} students`);

    for (const { studentId } of activeStudents) {
      try {
        await this.smartRecommend.generateRecommendations(studentId);
      } catch (err) {
        this.logger.error(`Failed to generate recommendations for ${studentId}`, err);
      }
    }

    return { studentsProcessed: activeStudents.length };
  }
}
```

- [ ] **Step 2: Register queue and cron jobs in module**

Update `student-ai.module.ts`:

```typescript
import { BullModule } from "@nestjs/bullmq";
import { OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";

@Module({
  imports: [
    BullModule.registerQueue({ name: "student-ai-batch" }),
  ],
  // ... existing providers + WeaknessAggregationProcessor
})
export class StudentAiModule implements OnModuleInit {
  constructor(
    @InjectQueue("student-ai-batch") private batchQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.batchQueue.add("daily-weakness-summary", {}, {
      repeat: { pattern: "0 3 * * *" },
      removeOnComplete: 7,
      removeOnFail: 14,
    });
    await this.batchQueue.add("daily-recommendations", {}, {
      repeat: { pattern: "0 2 * * *" },
      removeOnComplete: 7,
      removeOnFail: 14,
    });
  }
}
```

- [ ] **Step 3: Verify build**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && pnpm --filter @jsmath/lms-api build
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add apps/lms-api/src/student-ai/processors/ apps/lms-api/src/student-ai/student-ai.module.ts
git commit -m "feat(student-ai): add BullMQ daily batch for weakness and recommendations"
```

---

### Task 10: Student controller

**Files:**
- Create: `apps/lms-api/src/student-ai/student-ai.controller.ts`

- [ ] **Step 1: Implement student-facing controller**

Write `apps/lms-api/src/student-ai/student-ai.controller.ts` with all student endpoints from the spec:

```typescript
import {
  Controller, Post, Get, Patch, Body, Param, Req, Res,
  UseGuards, UseInterceptors, UploadedFile,
  NotFoundException, BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { TutorVisionService } from "./tutor/tutor-vision.service";
import { WrongAnswersService } from "./weakness/wrong-answers.service";
import { MasteryService } from "./weakness/mastery.service";
import { WeaknessProfileService } from "./weakness/weakness-profile.service";
import { SmartRecommendService } from "./recommend/smart-recommend.service";
import { ReviewScheduleService } from "./recommend/review-schedule.service";
import { CanvasUploadService } from "./canvas/canvas-upload.service";
import { SendTutorMessageDto } from "./dto/send-tutor-message.dto";
import { Response } from "express";

@Controller("student-ai")
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentAiController {
  constructor(
    private tutor: TutorVisionService,
    private wrongAnswers: WrongAnswersService,
    private mastery: MasteryService,
    private weakness: WeaknessProfileService,
    private recommend: SmartRecommendService,
    private reviews: ReviewScheduleService,
    private canvas: CanvasUploadService,
  ) {}

  // --- Tutor ---
  @Post("tutor/sessions")
  @Roles("student")
  createSession(@Req() req, @Body() body: { problemId: string }) { ... }

  @Post("tutor/sessions/:id/message")
  @Roles("student")
  sendMessage(@Param("id") id: string, @Req() req, @Body() body: SendTutorMessageDto, @Res() res: Response) { ... }

  @Get("tutor/sessions/:id")
  getSession(@Param("id") id: string, @Req() req) { ... }

  @Post("tutor/sessions/:id/end")
  @Roles("student")
  endSession(@Param("id") id: string, @Req() req) { ... }

  // --- Canvas ---
  @Post("canvas/upload")
  @Roles("student")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadCanvas(@Req() req, @UploadedFile() file: Express.Multer.File) { ... }

  // --- Weakness ---
  @Get("weakness")
  @Roles("student")
  getWeakness(@Req() req) { ... }

  // --- Recommendations ---
  @Get("recommendations")
  @Roles("student")
  getRecommendations(@Req() req) { ... }

  @Post("recommendations/generate")
  @Roles("student")
  generateRecommendations(@Req() req) { ... }

  // --- Wrong Answers ---
  @Get("wrong-answers")
  @Roles("student")
  getWrongAnswers(@Req() req) { ... }

  @Get("wrong-answers/stats")
  @Roles("student")
  getWrongAnswerStats(@Req() req) { ... }

  @Patch("wrong-answers/:id/classify")
  classifyWrongAnswer(@Param("id") id: string, @Req() req, @Body() body) { ... }

  @Patch("wrong-answers/:id/resolve")
  @Roles("student")
  resolveWrongAnswer(@Param("id") id: string, @Req() req) { ... }

  @Post("wrong-answers/:id/retry")
  @Roles("student")
  retryWrongAnswer(@Param("id") id: string, @Req() req, @Body() body) { ... }

  // --- Reviews ---
  @Get("reviews/daily")
  @Roles("student")
  getDailyReview(@Req() req) { ... }

  @Get("reviews/stats")
  @Roles("student")
  getReviewStats(@Req() req) { ... }

  @Post("reviews/:id/grade")
  @Roles("student")
  gradeReview(@Param("id") id: string, @Req() req, @Body() body) { ... }

  // --- Mastery ---
  @Get("mastery")
  @Roles("student")
  getMastery(@Req() req) { ... }

  @Get("mastery/tree")
  @Roles("student")
  getMasteryTree(@Req() req) { ... }

  @Get("mastery/:nodeId")
  @Roles("student")
  getMasteryByNode(@Param("nodeId") nodeId: string, @Req() req) { ... }
}
```

Each method delegates to the corresponding service. Follow the pattern from the existing controllers (auth check, extract `req.user.id`, call service, return result). The tutor message endpoint uses SSE streaming (same pattern as existing tutor controller).

- [ ] **Step 2: Register controller in module**

Add `StudentAiController` to `student-ai.module.ts` controllers array.

- [ ] **Step 3: Verify build**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && pnpm --filter @jsmath/lms-api build
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add apps/lms-api/src/student-ai/student-ai.controller.ts apps/lms-api/src/student-ai/student-ai.module.ts
git commit -m "feat(student-ai): add student-facing controller with all endpoints"
```

---

### Task 11: Teacher controller

**Files:**
- Create: `apps/lms-api/src/student-ai/student-ai-teacher.controller.ts`

- [ ] **Step 1: Implement teacher controller**

Write `apps/lms-api/src/student-ai/student-ai-teacher.controller.ts`:

```typescript
import { Controller, Get, Post, Param, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { WeaknessProfileService } from "./weakness/weakness-profile.service";
import { KnowledgeGraphService } from "./weakness/knowledge-graph.service";

@Controller("student-ai/teacher")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("teacher", "admin")
export class StudentAiTeacherController {
  constructor(
    private weakness: WeaknessProfileService,
    private knowledgeGraph: KnowledgeGraphService,
  ) {}

  @Get("class/:id/weakness")
  getClassWeakness(@Param("id") classId: string, @Req() req) {
    return this.weakness.getClassHeatmap(classId);
  }

  @Get("student/:id/weakness")
  getStudentWeakness(@Param("id") studentId: string, @Req() req) {
    return this.weakness.getStudentWeakness(studentId);
  }

  @Post("seed-prerequisites")
  seedPrerequisites() {
    return this.knowledgeGraph.seedPrerequisites();
  }
}
```

- [ ] **Step 2: Register controller in module**

Add `StudentAiTeacherController` to `student-ai.module.ts` controllers array.

- [ ] **Step 3: Verify build and tests**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && pnpm --filter @jsmath/lms-api build && pnpm --filter @jsmath/lms-api test
```
Expected: Build and tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add apps/lms-api/src/student-ai/student-ai-teacher.controller.ts apps/lms-api/src/student-ai/student-ai.module.ts
git commit -m "feat(student-ai): add teacher controller with class heatmap and student weakness"
```

---

## Chunk 4: GPT Migration (Separate PR)

### Task 12: Migrate analyze_photo.py from Anthropic to OpenAI

**Files:**
- Modify: `apps/ocr-api/app/workers/analyze_photo.py`
- Modify: `apps/ocr-api/app/config.py`

- [ ] **Step 1: Verify existing settings in config.py**

Read `apps/ocr-api/app/config.py` and confirm `ai_api_key`, `ai_model`, `ai_api_base_url` fields exist (they may already be used by other workers like `unified_analysis.py`). If missing, add them.

- [ ] **Step 2: Update analyze_photo.py**

Replace:
- `import anthropic` → `import openai`
- `anthropic.Anthropic(api_key=settings.anthropic_api_key)` → `openai.OpenAI(api_key=settings.ai_api_key, base_url=settings.ai_api_base_url)`
- `client.messages.create(model="claude-sonnet-4-6-20250514", ...)` → `client.chat.completions.create(model=settings.ai_model, ...)`
- Image content format: `{"type": "image", "source": {"type": "base64", ...}}` → `{"type": "image_url", "image_url": {"url": f"data:{mt};base64,{b64}"}}`
- Response extraction: `response.content[0].text` → `response.choices[0].message.content`
- Exception: `anthropic.APIError` → `openai.APIError`

- [ ] **Step 3: Run existing tests**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai/apps/ocr-api && python -m pytest tests/workers/ -v
```
Expected: Tests pass (mocked API calls should work with new interface).

- [ ] **Step 4: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add apps/ocr-api/app/workers/analyze_photo.py apps/ocr-api/app/config.py
git commit -m "feat(ocr): migrate analyze_photo from Anthropic to OpenAI GPT 5.4"
```

---

### Task 13: Migrate rubric_grader.py from Anthropic to OpenAI

**Files:**
- Modify: `apps/ocr-api/app/workers/rubric_grader.py`

- [ ] **Step 1: Apply same changes as Task 12**

Same pattern: replace `anthropic` → `openai`, update client init, message format, response extraction, and exception types.

- [ ] **Step 2: Run tests**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai/apps/ocr-api && python -m pytest tests/workers/ -v
```
Expected: PASS.

- [ ] **Step 3: Remove anthropic dependency if no longer used**

Check if any other file imports `anthropic`. If not:
```bash
cd /Users/parkjisong/jsmath-student-ai/apps/ocr-api
grep -r "import anthropic" app/
```
If no results, remove from `pyproject.toml` dependencies.

- [ ] **Step 4: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add apps/ocr-api/
git commit -m "feat(ocr): migrate rubric_grader from Anthropic to OpenAI GPT 5.4"
```

---

### Task 14: Add missing DTOs and shared-types

**Files:**
- Create: `apps/lms-api/src/student-ai/dto/weakness-profile.dto.ts`
- Create: `apps/lms-api/src/student-ai/dto/recommend-request.dto.ts`
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Create weakness-profile.dto.ts**

```typescript
import { IsOptional, IsString } from "class-validator";

export class WeaknessQueryDto {
  @IsOptional()
  @IsString()
  subject?: string;
}
```

- [ ] **Step 2: Create recommend-request.dto.ts**

```typescript
import { IsOptional, IsString, IsInt, Min, Max } from "class-validator";

export class RecommendRequestDto {
  @IsOptional()
  @IsString()
  sourceAssignmentId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
```

- [ ] **Step 3: Add student-ai types to shared-types**

In `packages/shared-types/src/index.ts`, add:

```typescript
// Student AI types
export type ErrorType = "concept_gap" | "pattern_gap" | "calculation_error" | "careless_mistake";

export interface WeaknessUnit {
  subject: string;
  unitMajor: string;
  accuracy: number;
  attemptCount: number;
  topErrorType: ErrorType | null;
}

export interface Recommendation {
  problemId: string;
  reason: "prerequisite_gap" | "error_pattern" | "sm2_review" | "similar_expansion";
  reasonDetail: string;
  priority: number;
  difficulty: number;
}

export interface RecommendationResult {
  recommendations: Recommendation[];
  summary: string;
}
```

- [ ] **Step 4: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add apps/lms-api/src/student-ai/dto/ packages/shared-types/src/index.ts
git commit -m "feat(student-ai): add DTOs and shared types for student-ai module"
```

---

### Task 15: Add endpoint redirect aliases for transition period

**Files:**
- Create: `apps/lms-api/src/student-ai/redirect.controller.ts`

- [ ] **Step 1: Create redirect controller for old endpoints**

Write `apps/lms-api/src/student-ai/redirect.controller.ts`:

```typescript
import { All, Controller, Req, Res } from "@nestjs/common";
import { Request, Response } from "express";

// Temporary redirect controllers for 2-week transition period.
// Remove after mobile app is updated to use /student-ai/* paths.

@Controller("tutor")
export class TutorRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(301, `/student-ai/tutor${req.path}`);
  }
}

@Controller("wrong-answers")
export class WrongAnswersRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(301, `/student-ai/wrong-answers${req.path}`);
  }
}

@Controller("mastery")
export class MasteryRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(301, `/student-ai/mastery${req.path}`);
  }
}

@Controller("reviews")
export class ReviewsRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(301, `/student-ai/reviews${req.path}`);
  }
}

@Controller("remediation")
export class RemediationRedirectController {
  @All("*")
  redirect(@Req() req: Request, @Res() res: Response) {
    res.redirect(301, `/student-ai/recommendations${req.path}`);
  }
}
```

- [ ] **Step 2: Register redirect controllers in module**

Add all 5 redirect controllers to `student-ai.module.ts` controllers array.

- [ ] **Step 3: Verify build**

Run:
```bash
cd /Users/parkjisong/jsmath-student-ai && pnpm --filter @jsmath/lms-api build
```

- [ ] **Step 4: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add apps/lms-api/src/student-ai/redirect.controller.ts apps/lms-api/src/student-ai/student-ai.module.ts
git commit -m "feat(student-ai): add temporary redirect controllers for endpoint migration"
```

---

### Task 16: Mobile canvas component (React Native Skia)

**Files:**
- Create: `apps/mobile/components/canvas/DrawingCanvas.tsx`
- Create: `apps/mobile/components/canvas/CanvasToolbar.tsx`
- Create: `apps/mobile/components/canvas/useCanvasUpload.ts`

- [ ] **Step 1: Install @shopify/react-native-skia**

```bash
cd /Users/parkjisong/jsmath-student-ai/apps/mobile && npx expo install @shopify/react-native-skia
```

- [ ] **Step 2: Create DrawingCanvas component**

Write `apps/mobile/components/canvas/DrawingCanvas.tsx`:

A React Native component using Skia Canvas with:
- Touch/pencil path tracking via `useTouchHandler` or `onTouch` callback
- White background fill
- `paths` state array that stores drawn strokes
- Pen color (black), pen width (adjustable 2-8)
- Eraser mode (draws white paths)
- Undo (removes last path)
- `exportAsPng()` method that calls `Skia.makeImageSnapshot()`, converts to PNG buffer, resizes to max 1024x1024

- [ ] **Step 3: Create CanvasToolbar component**

Write `apps/mobile/components/canvas/CanvasToolbar.tsx`:

Toolbar with buttons:
- Pen / Eraser toggle
- Pen thickness slider (2-8)
- Undo button
- Clear button
- Send button (calls parent onSend callback)
- Camera button (opens ImagePicker for photo capture)

- [ ] **Step 4: Create useCanvasUpload hook**

Write `apps/mobile/components/canvas/useCanvasUpload.ts`:

Custom hook that:
- Takes PNG buffer from DrawingCanvas
- Calls `POST /student-ai/canvas/upload` with multipart form data
- Returns `{ upload, isUploading, s3Key, error }`

- [ ] **Step 5: Commit**

```bash
cd /Users/parkjisong/jsmath-student-ai
git add apps/mobile/components/canvas/ apps/mobile/package.json
git commit -m "feat(mobile): add Apple Pencil drawing canvas with Skia"
```

---

## Execution Summary

| Task | Description | Depends On |
|------|-------------|------------|
| 1 | DB schema (2 new tables) | — |
| 2 | Create module skeleton, absorb services | 1 |
| 3 | Wire module, update consumer imports | 2 |
| 4 | Delete old module directories | 3, 10, 11, 15 |
| 5 | Canvas upload service | 2 |
| 6 | Tutor Vision enhancement | 2, 5 |
| 7 | Weakness profile service | 2 |
| 8 | Smart recommend extension | 2, 7 |
| 9 | BullMQ daily batch | 7, 8 |
| 10 | Student controller | 5, 6, 7, 8 |
| 11 | Teacher controller | 7 |
| 12 | analyze_photo GPT migration (separate PR) | — |
| 13 | rubric_grader GPT migration (separate PR) | 12 |
| 14 | DTOs and shared-types | 2 |
| 15 | Endpoint redirect aliases | 3 |
| 16 | Mobile canvas component | 5 |

**Parallelizable:** Tasks 5, 6, 7, 14 can run in parallel after Task 2. Tasks 12-13 are independent. Task 16 is independent of backend tasks (only needs S3 upload API).

**Critical path:** 1 → 2 → 3 → {5,6,7,14} → {8,10,11} → {4,9,15} → 16
