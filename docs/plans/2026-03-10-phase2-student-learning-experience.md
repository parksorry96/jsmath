# Phase 2: Student Learning Experience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform JSMath from a teacher-centric question bank into a student-facing learning platform by adding wrong answer tracking, mastery progression, step-by-step solutions, auto-remediation, and spaced repetition.

**Architecture:** Three new Prisma models (`WrongAnswer`, `StudentMastery`, `ReviewSchedule`) in the `public` schema (LMS domain). Two new NestJS modules (`wrong-answers`, `mastery`) and extensions to existing `submissions`, `assignments` modules. Frontend adds three new routes (`/wrong-answers`, `/mastery`, `/review-daily`) and a reusable `SolutionViewer` component. No changes to the OCR/FastAPI side — all features consume existing Problem data via cross-schema reads.

**Tech Stack:** Prisma (schema), NestJS (API), Next.js 15 (frontend), React Native/Expo (mobile), PostgreSQL (pgvector for similarity search), Redis/BullMQ (async wrong-answer collection)

---

## Task 1: Database Schema — WrongAnswer, StudentMastery, ReviewSchedule

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`
- Create: `packages/db-schema/prisma/migrations/YYYYMMDD_phase2_student_learning/migration.sql`

**Context:** All three tables belong to the `public` schema (LMS domain, accessed by NestJS). They reference `Problem` (in `ocr` schema) via raw string IDs — Prisma supports cross-schema relations. The existing `SubmissionAnswer` model (schema.prisma:265-279) stores per-problem results with `isCorrect`, `score`, `feedback` fields that we'll use as the trigger for wrong-answer collection.

**Step 1: Add WrongAnswer model**

Add after the `Notification` model in `packages/db-schema/prisma/schema.prisma`:

```prisma
model WrongAnswer {
  id              String          @id @default(cuid())
  studentId       String          @map("student_id")
  student         User            @relation("StudentWrongAnswers", fields: [studentId], references: [id])
  problemId       String          @map("problem_id")
  submissionId    String          @map("submission_id")
  errorType       ErrorType       @map("error_type")
  note            String?
  // Re-attempt tracking
  retryCount      Int             @default(0) @map("retry_count")
  lastRetryCorrect Boolean?      @map("last_retry_correct")
  resolvedAt      DateTime?       @map("resolved_at")
  createdAt       DateTime        @default(now()) @map("created_at")
  updatedAt       DateTime        @updatedAt @map("updated_at")
  // Spaced repetition (Task 5 uses this)
  reviewSchedule  ReviewSchedule?

  @@unique([studentId, problemId, submissionId])
  @@index([studentId, errorType])
  @@index([studentId, resolvedAt])
  @@map("wrong_answers")
  @@schema("public")
}

enum ErrorType {
  concept_gap
  pattern_gap
  calculation_error
  careless_mistake

  @@schema("public")
}
```

Add reverse relation to `User` model (after existing `submissions` field, line ~26):
```prisma
  wrongAnswers   WrongAnswer[] @relation("StudentWrongAnswers")
```

**Step 2: Add StudentMastery model**

```prisma
model StudentMastery {
  id                 String        @id @default(cuid())
  studentId          String        @map("student_id")
  student            User          @relation("StudentMasteries", fields: [studentId], references: [id])
  curriculumNodeId   String        @map("curriculum_node_id")
  state              MasteryState  @default(not_started)
  consecutiveCorrect Int           @default(0) @map("consecutive_correct")
  totalAttempts      Int           @default(0) @map("total_attempts")
  totalCorrect       Int           @default(0) @map("total_correct")
  lastAttemptAt      DateTime?     @map("last_attempt_at")
  masteredAt         DateTime?     @map("mastered_at")
  createdAt          DateTime      @default(now()) @map("created_at")
  updatedAt          DateTime      @updatedAt @map("updated_at")

  @@unique([studentId, curriculumNodeId])
  @@index([studentId, state])
  @@map("student_masteries")
  @@schema("public")
}

enum MasteryState {
  not_started
  learning
  practicing
  mastered

  @@schema("public")
}
```

Add reverse relation to `User` model:
```prisma
  masteries      StudentMastery[] @relation("StudentMasteries")
```

**Step 3: Add ReviewSchedule model**

```prisma
model ReviewSchedule {
  id              String       @id @default(cuid())
  studentId       String       @map("student_id")
  student         User         @relation("StudentReviews", fields: [studentId], references: [id])
  wrongAnswerId   String       @unique @map("wrong_answer_id")
  wrongAnswer     WrongAnswer  @relation(fields: [wrongAnswerId], references: [id], onDelete: Cascade)
  problemId       String       @map("problem_id")
  nextReviewAt    DateTime     @map("next_review_at")
  interval        Int          @default(1)  // days
  easeFactor      Float        @default(2.5) @map("ease_factor")
  repetitions     Int          @default(0)
  lastReviewedAt  DateTime?    @map("last_reviewed_at")
  createdAt       DateTime     @default(now()) @map("created_at")
  updatedAt       DateTime     @updatedAt @map("updated_at")

  @@index([studentId, nextReviewAt])
  @@index([nextReviewAt])
  @@map("review_schedules")
  @@schema("public")
}
```

Add reverse relation to `User` model:
```prisma
  reviewSchedules ReviewSchedule[] @relation("StudentReviews")
```

**Step 4: Add alternativeSolutions field to Problem**

Add to `Problem` model after `solutionSteps` (line ~435):
```prisma
  alternativeSolutions Json?   @map("alternative_solutions")
```

**Step 5: Add remediation assignment type**

Extend the `AssignmentType` enum (line ~151):
```prisma
enum AssignmentType {
  problem_set
  text_task
  remediation

  @@schema("public")
}
```

Add `sourceAssignmentId` to `Assignment` model for linking remediation to parent:
```prisma
  sourceAssignmentId String?     @map("source_assignment_id")
```

**Step 6: Run migration**

```bash
cd packages/db-schema && pnpm db:migrate --name phase2_student_learning
```

**Step 7: Regenerate Prisma client**

```bash
cd packages/db-schema && pnpm db:generate
```

**Verify:** `npx prisma validate` passes. Check that `WrongAnswer`, `StudentMastery`, `ReviewSchedule` appear in generated client types.

---

## Task 2: Wrong Answer Collection Service (Feature 2-1)

**Files:**
- Create: `apps/lms-api/src/wrong-answers/wrong-answers.module.ts`
- Create: `apps/lms-api/src/wrong-answers/wrong-answers.service.ts`
- Create: `apps/lms-api/src/wrong-answers/wrong-answers.controller.ts`
- Create: `apps/lms-api/src/wrong-answers/dto/classify-error.dto.ts`
- Modify: `apps/lms-api/src/submissions/submissions.service.ts`
- Modify: `apps/lms-api/src/app.module.ts`

**Context:** The auto-grading flow is in `submissions.service.ts:206-306`. After `autoGrade` updates `isCorrect` on each `SubmissionAnswer`, we need to trigger wrong-answer collection for any `isCorrect=false` answers. For manual grading (line 492-545), wrong answers should be collected when the teacher calls `grade()`. The existing `AnalyticsService` (analytics.service.ts:56-66) already loops over answers grouped by unit — we follow the same pattern.

**Step 1: Create WrongAnswersService**

Create `apps/lms-api/src/wrong-answers/wrong-answers.service.ts`:

```typescript
import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ErrorType } from "@prisma/client";
import { canAccessStudentData, isPrivilegedRole } from "../common/access-control";

@Injectable()
export class WrongAnswersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Collect wrong answers from a graded submission.
   * Called automatically after autoGrade or manual grade.
   */
  async collectFromSubmission(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { answers: true },
    });
    if (!submission) return;

    const wrongAnswers = submission.answers.filter(
      (a) => a.isCorrect === false,
    );
    if (wrongAnswers.length === 0) return;

    // Fetch problem metadata for error classification heuristic
    const problemIds = wrongAnswers.map((a) => a.problemId);
    const problems = await this.prisma.problem.findMany({
      where: { id: { in: problemIds } },
      select: {
        id: true,
        problemType: true,
        difficulty: true,
        unitMajor: true,
        commonMistakes: true,
      },
    });
    const problemMap = new Map(problems.map((p) => [p.id, p]));

    for (const answer of wrongAnswers) {
      const problem = problemMap.get(answer.problemId);
      const errorType = this.classifyError(answer, problem);

      await this.prisma.wrongAnswer.upsert({
        where: {
          studentId_problemId_submissionId: {
            studentId: submission.studentId,
            problemId: answer.problemId,
            submissionId: submission.id,
          },
        },
        create: {
          studentId: submission.studentId,
          problemId: answer.problemId,
          submissionId: submission.id,
          errorType,
        },
        update: {
          errorType,
        },
      });
    }
  }

  /**
   * Heuristic error classification. Can be overridden by teacher.
   * - concept_gap: wrong on a conceptual/written problem
   * - calculation_error: short_answer with numeric mismatch
   * - careless_mistake: easy problem (difficulty <= 2) wrong
   * - pattern_gap: default fallback
   */
  private classifyError(
    answer: { studentAnswer: string | null },
    problem: { problemType: string; difficulty: number | null; commonMistakes: unknown } | undefined,
  ): ErrorType {
    if (!problem) return "pattern_gap";
    if (problem.difficulty !== null && problem.difficulty <= 2) return "careless_mistake";
    if (problem.problemType === "written_solution" || problem.problemType === "essay") {
      return "concept_gap";
    }
    if (problem.problemType === "short_answer") return "calculation_error";
    return "pattern_gap";
  }

  async findMy(
    studentId: string,
    filters?: {
      errorType?: ErrorType;
      resolved?: boolean;
      subject?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    const where: Record<string, unknown> = { studentId };

    if (filters?.errorType) where.errorType = filters.errorType;
    if (filters?.resolved === true) {
      where.resolvedAt = { not: null };
    } else if (filters?.resolved === false) {
      where.resolvedAt = null;
    }

    const items = await this.prisma.wrongAnswer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    });

    // Enrich with problem data
    const problemIds = [...new Set(items.map((w) => w.problemId))];
    const problems = problemIds.length
      ? await this.prisma.problem.findMany({
          where: { id: { in: problemIds } },
          select: {
            id: true,
            stemLatex: true,
            stemText: true,
            problemType: true,
            difficulty: true,
            subject: true,
            unitMajor: true,
            unitMinor: true,
            displayNumber: true,
            choices: {
              select: { label: true, contentLatex: true, contentText: true, position: true },
              orderBy: { position: "asc" },
            },
          },
        })
      : [];
    const problemMap = new Map(problems.map((p) => [p.id, p]));

    return items.map((w) => ({
      ...w,
      problem: problemMap.get(w.problemId) ?? null,
    }));
  }

  async findByStudent(
    studentId: string,
    requesterId: string,
    requesterRole: string,
    filters?: { errorType?: ErrorType; limit?: number },
  ) {
    const allowed = await canAccessStudentData(
      this.prisma,
      requesterId,
      requesterRole,
      studentId,
    );
    if (!allowed) throw new ForbiddenException("Not authorized");

    return this.findMy(studentId, filters);
  }

  async updateErrorType(
    wrongAnswerId: string,
    errorType: ErrorType,
    requesterId: string,
    requesterRole: string,
  ) {
    if (!isPrivilegedRole(requesterRole)) {
      throw new ForbiddenException("Only teachers can reclassify errors");
    }

    const wa = await this.prisma.wrongAnswer.findUnique({
      where: { id: wrongAnswerId },
    });
    if (!wa) throw new NotFoundException("Wrong answer not found");

    return this.prisma.wrongAnswer.update({
      where: { id: wrongAnswerId },
      data: { errorType },
    });
  }

  async recordRetry(
    wrongAnswerId: string,
    isCorrect: boolean,
    studentId: string,
  ) {
    const wa = await this.prisma.wrongAnswer.findUnique({
      where: { id: wrongAnswerId },
    });
    if (!wa || wa.studentId !== studentId) {
      throw new NotFoundException("Wrong answer not found");
    }

    return this.prisma.wrongAnswer.update({
      where: { id: wrongAnswerId },
      data: {
        retryCount: { increment: 1 },
        lastRetryCorrect: isCorrect,
        ...(isCorrect ? { resolvedAt: new Date() } : {}),
      },
    });
  }

  async getStats(studentId: string) {
    const [total, byType, resolved] = await Promise.all([
      this.prisma.wrongAnswer.count({ where: { studentId } }),
      this.prisma.wrongAnswer.groupBy({
        by: ["errorType"],
        where: { studentId },
        _count: true,
      }),
      this.prisma.wrongAnswer.count({
        where: { studentId, resolvedAt: { not: null } },
      }),
    ]);

    return {
      total,
      resolved,
      unresolved: total - resolved,
      byErrorType: byType.map((g) => ({
        errorType: g.errorType,
        count: g._count,
      })),
    };
  }
}
```

**Step 2: Create WrongAnswersController**

Create `apps/lms-api/src/wrong-answers/wrong-answers.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
} from "@nestjs/common";
import { WrongAnswersService } from "./wrong-answers.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ErrorType } from "@prisma/client";

interface AuthRequest {
  user: { id: string; role: string };
}

@Controller("wrong-answers")
@UseGuards(JwtAuthGuard, RolesGuard)
export class WrongAnswersController {
  constructor(private service: WrongAnswersService) {}

  @Get("my")
  @Roles("student")
  findMy(
    @Request() req: AuthRequest,
    @Query("errorType") errorType?: ErrorType,
    @Query("resolved") resolved?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    return this.service.findMy(req.user.id, {
      errorType,
      resolved: resolved === "true" ? true : resolved === "false" ? false : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get("my/stats")
  @Roles("student")
  getMyStats(@Request() req: AuthRequest) {
    return this.service.getStats(req.user.id);
  }

  @Get("student/:studentId")
  @Roles("admin", "teacher", "parent")
  findByStudent(
    @Param("studentId") studentId: string,
    @Request() req: AuthRequest,
    @Query("errorType") errorType?: ErrorType,
    @Query("limit") limit?: string,
  ) {
    return this.service.findByStudent(
      studentId,
      req.user.id,
      req.user.role,
      { errorType, limit: limit ? parseInt(limit, 10) : undefined },
    );
  }

  @Patch(":id/error-type")
  @Roles("admin", "teacher")
  updateErrorType(
    @Param("id") id: string,
    @Body("errorType") errorType: ErrorType,
    @Request() req: AuthRequest,
  ) {
    return this.service.updateErrorType(id, errorType, req.user.id, req.user.role);
  }

  @Post(":id/retry")
  @Roles("student")
  recordRetry(
    @Param("id") id: string,
    @Body("isCorrect") isCorrect: boolean,
    @Request() req: AuthRequest,
  ) {
    return this.service.recordRetry(id, isCorrect, req.user.id);
  }
}
```

**Step 3: Create module and register in app**

Create `apps/lms-api/src/wrong-answers/wrong-answers.module.ts`:
```typescript
import { Module } from "@nestjs/common";
import { WrongAnswersService } from "./wrong-answers.service";
import { WrongAnswersController } from "./wrong-answers.controller";

@Module({
  controllers: [WrongAnswersController],
  providers: [WrongAnswersService],
  exports: [WrongAnswersService],
})
export class WrongAnswersModule {}
```

Add to `apps/lms-api/src/app.module.ts` imports array:
```typescript
import { WrongAnswersModule } from "./wrong-answers/wrong-answers.module";
// ... in imports: [... WrongAnswersModule]
```

**Step 4: Hook into submission grading flow**

Modify `apps/lms-api/src/submissions/submissions.service.ts`:

Add import at top:
```typescript
import { WrongAnswersService } from "../wrong-answers/wrong-answers.service";
```

Inject in constructor:
```typescript
constructor(
  private prisma: PrismaService,
  private wrongAnswers: WrongAnswersService,
) {}
```

After the final `return` in `autoGrade()` (line ~297-305), add wrong-answer collection:
```typescript
// After updating submission to "graded" status:
const graded = await this.prisma.submission.update({
  where: { id: submissionId },
  data: { score, status: "graded", gradedAt: new Date() },
  include: { answers: true },
});

// Collect wrong answers asynchronously (non-blocking)
this.wrongAnswers.collectFromSubmission(graded.id).catch((err) => {
  // Log but don't fail the grade operation
  console.error("Wrong answer collection failed:", err);
});

return graded;
```

Similarly, at the end of `grade()` (line ~534-544), add:
```typescript
const graded = await this.prisma.submission.update({ ... });
this.wrongAnswers.collectFromSubmission(graded.id).catch((err) => {
  console.error("Wrong answer collection failed:", err);
});
return graded;
```

Update `apps/lms-api/src/submissions/submissions.module.ts` to import `WrongAnswersModule`:
```typescript
import { Module } from "@nestjs/common";
import { WrongAnswersModule } from "../wrong-answers/wrong-answers.module";
import { SubmissionsService } from "./submissions.service";
import { SubmissionsController } from "./submissions.controller";

@Module({
  imports: [WrongAnswersModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
})
export class SubmissionsModule {}
```

**Verify:** Submit an online assignment with some wrong answers. Confirm `wrong_answers` table rows are created with correct `error_type`. Call `GET /v1/wrong-answers/my` and verify enriched response with problem data.

---

## Task 3: Mastery Tracking Service (Feature 2-2)

**Files:**
- Create: `apps/lms-api/src/mastery/mastery.module.ts`
- Create: `apps/lms-api/src/mastery/mastery.service.ts`
- Create: `apps/lms-api/src/mastery/mastery.controller.ts`
- Modify: `apps/lms-api/src/submissions/submissions.service.ts`
- Modify: `apps/lms-api/src/app.module.ts`

**Context:** Mastery is tracked per student per curriculum node (Phase 1 adds `CurriculumNode`). The `Problem` model has `curriculumNodeId` (added in Phase 1 Task 1). When a student answers a problem correctly, we look up its `curriculumNodeId` and update the mastery record. Three consecutive correct answers on problems under the same node transition state to `mastered`.

**Step 1: Create MasteryService**

Create `apps/lms-api/src/mastery/mastery.service.ts`:

```typescript
import { Injectable, ForbiddenException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MasteryState } from "@prisma/client";
import { canAccessStudentData } from "../common/access-control";

const MASTERY_THRESHOLD = 3; // consecutive correct to reach "mastered"

@Injectable()
export class MasteryService {
  constructor(private prisma: PrismaService) {}

  /**
   * Update mastery after a student answers a problem.
   * Called per-answer from the grading flow.
   */
  async recordAttempt(studentId: string, problemId: string, isCorrect: boolean) {
    // Look up curriculum node for this problem
    const problem = await this.prisma.problem.findUnique({
      where: { id: problemId },
      select: { curriculumNodeId: true },
    });

    // If problem has no curriculum mapping, skip mastery tracking
    const nodeId = (problem as Record<string, unknown>)?.curriculumNodeId as string | null;
    if (!nodeId) return null;

    const existing = await this.prisma.studentMastery.findUnique({
      where: {
        studentId_curriculumNodeId: { studentId, curriculumNodeId: nodeId },
      },
    });

    const currentConsecutive = existing?.consecutiveCorrect ?? 0;
    const newConsecutive = isCorrect ? currentConsecutive + 1 : 0;
    const totalAttempts = (existing?.totalAttempts ?? 0) + 1;
    const totalCorrect = (existing?.totalCorrect ?? 0) + (isCorrect ? 1 : 0);

    let newState: MasteryState;
    if (newConsecutive >= MASTERY_THRESHOLD) {
      newState = "mastered";
    } else if (totalAttempts >= 3) {
      newState = "practicing";
    } else if (totalAttempts >= 1) {
      newState = "learning";
    } else {
      newState = "not_started";
    }

    return this.prisma.studentMastery.upsert({
      where: {
        studentId_curriculumNodeId: { studentId, curriculumNodeId: nodeId },
      },
      create: {
        studentId,
        curriculumNodeId: nodeId,
        state: newState,
        consecutiveCorrect: newConsecutive,
        totalAttempts,
        totalCorrect,
        lastAttemptAt: new Date(),
        ...(newState === "mastered" ? { masteredAt: new Date() } : {}),
      },
      update: {
        state: newState,
        consecutiveCorrect: newConsecutive,
        totalAttempts,
        totalCorrect,
        lastAttemptAt: new Date(),
        ...(newState === "mastered" ? { masteredAt: new Date() } : {}),
      },
    });
  }

  /**
   * Batch update mastery after grading a full submission.
   */
  async recordSubmissionAttempts(
    studentId: string,
    answers: Array<{ problemId: string; isCorrect: boolean | null }>,
  ) {
    for (const answer of answers) {
      if (answer.isCorrect === null) continue;
      await this.recordAttempt(studentId, answer.problemId, answer.isCorrect);
    }
  }

  async findMy(studentId: string, subject?: string) {
    const masteries = await this.prisma.studentMastery.findMany({
      where: { studentId },
      orderBy: { updatedAt: "desc" },
    });

    // Enrich with curriculum node data if CurriculumNode table exists
    // For now, return raw mastery records
    return masteries;
  }

  async findByStudent(
    studentId: string,
    requesterId: string,
    requesterRole: string,
  ) {
    const allowed = await canAccessStudentData(
      this.prisma,
      requesterId,
      requesterRole,
      studentId,
    );
    if (!allowed) throw new ForbiddenException("Not authorized");

    return this.findMy(studentId);
  }

  async getSummary(studentId: string) {
    const counts = await this.prisma.studentMastery.groupBy({
      by: ["state"],
      where: { studentId },
      _count: true,
    });

    const summary: Record<string, number> = {
      not_started: 0,
      learning: 0,
      practicing: 0,
      mastered: 0,
    };

    for (const row of counts) {
      summary[row.state] = row._count;
    }

    return {
      studentId,
      ...summary,
      total: Object.values(summary).reduce((a, b) => a + b, 0),
    };
  }
}
```

**Step 2: Create MasteryController**

Create `apps/lms-api/src/mastery/mastery.controller.ts`:

```typescript
import { Controller, Get, Query, Param, UseGuards, Request } from "@nestjs/common";
import { MasteryService } from "./mastery.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; role: string };
}

@Controller("mastery")
@UseGuards(JwtAuthGuard, RolesGuard)
export class MasteryController {
  constructor(private service: MasteryService) {}

  @Get("my")
  @Roles("student")
  findMy(@Request() req: AuthRequest, @Query("subject") subject?: string) {
    return this.service.findMy(req.user.id, subject);
  }

  @Get("my/summary")
  @Roles("student")
  getMySummary(@Request() req: AuthRequest) {
    return this.service.getSummary(req.user.id);
  }

  @Get("student/:studentId")
  @Roles("admin", "teacher", "parent")
  findByStudent(
    @Param("studentId") studentId: string,
    @Request() req: AuthRequest,
  ) {
    return this.service.findByStudent(studentId, req.user.id, req.user.role);
  }

  @Get("student/:studentId/summary")
  @Roles("admin", "teacher", "parent")
  getStudentSummary(
    @Param("studentId") studentId: string,
    @Request() req: AuthRequest,
  ) {
    // Access check happens inside the service
    return this.service.findByStudent(studentId, req.user.id, req.user.role)
      .then(() => this.service.getSummary(studentId));
  }
}
```

**Step 3: Create module and register**

Create `apps/lms-api/src/mastery/mastery.module.ts`:
```typescript
import { Module } from "@nestjs/common";
import { MasteryService } from "./mastery.service";
import { MasteryController } from "./mastery.controller";

@Module({
  controllers: [MasteryController],
  providers: [MasteryService],
  exports: [MasteryService],
})
export class MasteryModule {}
```

Add to `apps/lms-api/src/app.module.ts`:
```typescript
import { MasteryModule } from "./mastery/mastery.module";
// ... in imports: [... MasteryModule]
```

**Step 4: Hook mastery tracking into grading flow**

Modify `apps/lms-api/src/submissions/submissions.service.ts`:

Add import:
```typescript
import { MasteryService } from "../mastery/mastery.service";
```

Update constructor:
```typescript
constructor(
  private prisma: PrismaService,
  private wrongAnswers: WrongAnswersService,
  private mastery: MasteryService,
) {}
```

After wrong-answer collection in `autoGrade()`, add mastery update:
```typescript
// Update mastery (non-blocking)
this.mastery.recordSubmissionAttempts(
  submission.studentId,
  graded.answers.map((a) => ({ problemId: a.problemId, isCorrect: a.isCorrect })),
).catch((err) => console.error("Mastery update failed:", err));
```

Update `apps/lms-api/src/submissions/submissions.module.ts`:
```typescript
import { MasteryModule } from "../mastery/mastery.module";

@Module({
  imports: [WrongAnswersModule, MasteryModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
})
export class SubmissionsModule {}
```

**Verify:** Grade a submission where the student gets 3+ problems in the same curriculum node correct. Check that `student_masteries` row transitions to `mastered`. Call `GET /v1/mastery/my/summary` and verify counts.

---

## Task 4: Step-by-Step Solution Display (Feature 2-3)

**Files:**
- Create: `apps/web/src/components/problem/solution-viewer.tsx`
- Modify: `apps/web/src/app/(authenticated)/problems/page.tsx`
- Modify: `packages/shared-types/src/index.ts`

**Context:** Problems already have `solutionSteps` (JSON array), `solutionStrategy` (text), `solutionLatex` (text), and `solutionText` (text) from AI analysis. The schema also has `alternativeSolutions` (JSON, added in Task 1). The existing `LatexRenderer` component (components/math/latex-renderer.tsx) handles all LaTeX rendering. The problem preview dialog (problems/page.tsx:544-735) shows stemLatex and choices but no solution yet.

**Step 1: Add shared types for solution data**

Add to `packages/shared-types/src/index.ts` (after existing `SolutionStep` interface, line ~96):

```typescript
export interface AlternativeSolution {
  method: string;       // e.g. "substitution", "graphical", "algebraic"
  label: string;        // display name e.g. "대입법", "그래프 풀이"
  steps: SolutionStep[];
  answerText: string;
}
```

**Step 2: Create SolutionViewer component**

Create `apps/web/src/components/problem/solution-viewer.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LatexRenderer } from "@/components/math/latex-renderer";

interface SolutionStep {
  step: number;
  description: string;
  concept: string;
}

interface AlternativeSolution {
  method: string;
  label: string;
  steps: SolutionStep[];
  answerText: string;
}

interface SolutionViewerProps {
  solutionStrategy: string | null;
  solutionSteps: SolutionStep[] | null;
  solutionLatex: string | null;
  solutionText: string | null;
  answerLatex: string | null;
  answerText: string | null;
  alternativeSolutions: AlternativeSolution[] | null;
  /** Start fully collapsed (step-by-step reveal mode) */
  revealMode?: boolean;
}

export function SolutionViewer({
  solutionStrategy,
  solutionSteps,
  solutionLatex,
  solutionText,
  answerLatex,
  answerText,
  alternativeSolutions,
  revealMode = false,
}: SolutionViewerProps) {
  const [showSolution, setShowSolution] = useState(!revealMode);
  const [revealedSteps, setRevealedSteps] = useState(revealMode ? 0 : Infinity);
  const [activeMethod, setActiveMethod] = useState(0); // 0 = primary, 1+ = alternatives

  const steps = solutionSteps ?? [];
  const altSolutions = alternativeSolutions ?? [];
  const hasSolution = steps.length > 0 || solutionLatex || solutionText;

  if (!hasSolution) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        풀이가 아직 준비되지 않았습니다.
      </div>
    );
  }

  function revealNext() {
    setRevealedSteps((prev) => Math.min(prev + 1, steps.length));
  }

  function revealAll() {
    setRevealedSteps(steps.length);
  }

  return (
    <div className="space-y-4">
      {/* Toggle button */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSolution(!showSolution)}
        >
          {showSolution ? (
            <EyeOff className="mr-2 h-4 w-4" />
          ) : (
            <Eye className="mr-2 h-4 w-4" />
          )}
          {showSolution ? "풀이 숨기기" : "풀이 보기"}
        </Button>

        {/* Method tabs */}
        {showSolution && altSolutions.length > 0 && (
          <div className="flex items-center gap-1">
            <Badge
              variant={activeMethod === 0 ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setActiveMethod(0)}
            >
              기본 풀이
            </Badge>
            {altSolutions.map((alt, i) => (
              <Badge
                key={alt.method}
                variant={activeMethod === i + 1 ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setActiveMethod(i + 1)}
              >
                {alt.label}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {showSolution && (
        <div className="space-y-3">
          {/* Strategy tag */}
          {solutionStrategy && (
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-yellow-400" />
              <span className="text-xs font-medium text-muted-foreground">
                풀이 전략:
              </span>
              <Badge variant="outline">{solutionStrategy}</Badge>
            </div>
          )}

          {/* Answer */}
          {(answerLatex || answerText) && (
            <div className="rounded-lg border border-green-400/30 bg-green-900/10 p-3">
              <span className="text-xs font-semibold text-green-400">정답: </span>
              <LatexRenderer
                content={answerLatex || answerText || ""}
                className="inline text-sm"
              />
            </div>
          )}

          {/* Primary solution steps */}
          {activeMethod === 0 && steps.length > 0 && (
            <div className="space-y-2">
              {steps.map((step, i) => {
                const isRevealed = i < revealedSteps;
                return (
                  <div
                    key={step.step}
                    className={`rounded-lg border p-3 transition-opacity ${
                      isRevealed
                        ? "border-border bg-brand-dark"
                        : "border-transparent bg-brand-dark/30 opacity-40"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isRevealed ? (
                        <ChevronDown className="h-4 w-4 text-brand-beige" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-xs font-bold text-brand-beige">
                        Step {step.step}
                      </span>
                      {step.concept && (
                        <Badge variant="outline" className="text-[10px]">
                          {step.concept}
                        </Badge>
                      )}
                    </div>
                    {isRevealed && (
                      <div className="mt-2 pl-6">
                        <LatexRenderer
                          content={step.description}
                          className="text-sm leading-relaxed"
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Reveal controls */}
              {revealMode && revealedSteps < steps.length && (
                <div className="flex items-center gap-2 pt-2">
                  <Button size="sm" onClick={revealNext}>
                    다음 단계 보기 ({revealedSteps + 1}/{steps.length})
                  </Button>
                  <Button variant="ghost" size="sm" onClick={revealAll}>
                    전체 보기
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Primary fallback: full solution text */}
          {activeMethod === 0 && steps.length === 0 && (solutionLatex || solutionText) && (
            <div className="rounded-xl border border-border bg-brand-dark p-4">
              <LatexRenderer
                content={solutionLatex || solutionText || ""}
                className="text-sm leading-relaxed"
              />
            </div>
          )}

          {/* Alternative solution */}
          {activeMethod > 0 && altSolutions[activeMethod - 1] && (
            <div className="space-y-2">
              {altSolutions[activeMethod - 1].steps.map((step) => (
                <div
                  key={step.step}
                  className="rounded-lg border border-border bg-brand-dark p-3"
                >
                  <div className="flex items-center gap-2">
                    <ChevronDown className="h-4 w-4 text-brand-beige" />
                    <span className="text-xs font-bold text-brand-beige">
                      Step {step.step}
                    </span>
                    {step.concept && (
                      <Badge variant="outline" className="text-[10px]">
                        {step.concept}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2 pl-6">
                    <LatexRenderer
                      content={step.description}
                      className="text-sm leading-relaxed"
                    />
                  </div>
                </div>
              ))}
              {altSolutions[activeMethod - 1].answerText && (
                <div className="rounded-lg border border-green-400/30 bg-green-900/10 p-3">
                  <span className="text-xs font-semibold text-green-400">정답: </span>
                  <LatexRenderer
                    content={altSolutions[activeMethod - 1].answerText}
                    className="inline text-sm"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 3: Integrate into problem preview dialog**

Modify `apps/web/src/app/(authenticated)/problems/page.tsx`:

1. Add import at top:
```typescript
import { SolutionViewer } from "@/components/problem/solution-viewer";
```

2. Extend `Problem` interface (line ~32) with solution fields:
```typescript
interface Problem {
  // ... existing fields ...
  solutionStrategy: string | null;
  solutionSteps: Array<{ step: number; description: string; concept: string }> | null;
  solutionLatex: string | null;
  solutionText: string | null;
  answerLatex: string | null;
  answerText: string | null;
  alternativeSolutions: Array<{
    method: string;
    label: string;
    steps: Array<{ step: number; description: string; concept: string }>;
    answerText: string;
  }> | null;
}
```

3. Add `SolutionViewer` inside the preview dialog, after the stem/choices block and before the twin-problem section (after line ~598):
```tsx
{/* Solution section */}
<div className="space-y-3">
  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
    풀이
  </p>
  <SolutionViewer
    solutionStrategy={previewProblem.solutionStrategy}
    solutionSteps={previewProblem.solutionSteps}
    solutionLatex={previewProblem.solutionLatex}
    solutionText={previewProblem.solutionText}
    answerLatex={previewProblem.answerLatex}
    answerText={previewProblem.answerText}
    alternativeSolutions={previewProblem.alternativeSolutions}
    revealMode={false}
  />
</div>
```

**Verify:** Open a problem preview for a problem that has `solutionSteps`. Confirm steps render with LaTeX and the strategy badge appears. Toggle `revealMode={true}` and confirm step-by-step reveal works.

---

## Task 5: Spaced Repetition Engine (Feature 2-5)

**Files:**
- Create: `apps/lms-api/src/review/review.module.ts`
- Create: `apps/lms-api/src/review/review.service.ts`
- Create: `apps/lms-api/src/review/review.controller.ts`
- Modify: `apps/lms-api/src/wrong-answers/wrong-answers.service.ts`
- Modify: `apps/lms-api/src/app.module.ts`

**Context:** The `ReviewSchedule` model (Task 1) stores per-wrong-answer review timing. When a wrong answer is created (Task 2), we auto-create a review schedule entry with `nextReviewAt = now + 1 day`. We implement a simplified SM-2 algorithm: on correct recall, increase interval and ease factor; on failure, reset interval to 1 day.

**Step 1: Create ReviewService with SM-2 algorithm**

Create `apps/lms-api/src/review/review.service.ts`:

```typescript
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

// Simplified SM-2 parameters
const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;

@Injectable()
export class ReviewService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a review schedule for a new wrong answer.
   * First review is 1 day from now.
   */
  async scheduleReview(wrongAnswerId: string, studentId: string, problemId: string) {
    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + 1);

    return this.prisma.reviewSchedule.upsert({
      where: { wrongAnswerId },
      create: {
        studentId,
        wrongAnswerId,
        problemId,
        nextReviewAt,
        interval: 1,
        easeFactor: DEFAULT_EASE,
        repetitions: 0,
      },
      update: {
        nextReviewAt,
        interval: 1,
        easeFactor: DEFAULT_EASE,
        repetitions: 0,
      },
    });
  }

  /**
   * Get today's due review problems for a student.
   */
  async getDailyReview(studentId: string, limit = 20) {
    const now = new Date();

    const schedules = await this.prisma.reviewSchedule.findMany({
      where: {
        studentId,
        nextReviewAt: { lte: now },
      },
      orderBy: { nextReviewAt: "asc" },
      take: limit,
      include: { wrongAnswer: true },
    });

    // Enrich with problem data
    const problemIds = [...new Set(schedules.map((s) => s.problemId))];
    const problems = problemIds.length
      ? await this.prisma.problem.findMany({
          where: { id: { in: problemIds } },
          select: {
            id: true,
            stemLatex: true,
            stemText: true,
            problemType: true,
            difficulty: true,
            subject: true,
            unitMajor: true,
            displayNumber: true,
            answerText: true,
            answerLatex: true,
            solutionSteps: true,
            choices: {
              select: { label: true, contentLatex: true, contentText: true, position: true },
              orderBy: { position: "asc" },
            },
          },
        })
      : [];
    const problemMap = new Map(problems.map((p) => [p.id, p]));

    return {
      dueCount: schedules.length,
      problems: schedules.map((s) => ({
        reviewScheduleId: s.id,
        wrongAnswerId: s.wrongAnswerId,
        errorType: s.wrongAnswer.errorType,
        interval: s.interval,
        repetitions: s.repetitions,
        problem: problemMap.get(s.problemId) ?? null,
      })),
    };
  }

  /**
   * Record a review result and update the schedule using SM-2.
   * quality: 0-5 (0-2 = fail, 3-5 = pass)
   */
  async recordReviewResult(
    reviewScheduleId: string,
    studentId: string,
    quality: number,
  ) {
    const schedule = await this.prisma.reviewSchedule.findUnique({
      where: { id: reviewScheduleId },
    });
    if (!schedule || schedule.studentId !== studentId) {
      throw new NotFoundException("Review schedule not found");
    }

    const isPass = quality >= 3;
    let { interval, easeFactor, repetitions } = schedule;

    if (isPass) {
      // SM-2: increase interval
      if (repetitions === 0) {
        interval = 1;
      } else if (repetitions === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * easeFactor);
      }
      repetitions += 1;

      // Update ease factor
      easeFactor =
        easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
      if (easeFactor < MIN_EASE) easeFactor = MIN_EASE;
    } else {
      // Failed: reset to 1 day
      interval = 1;
      repetitions = 0;
      // Reduce ease slightly
      easeFactor = Math.max(MIN_EASE, easeFactor - 0.2);
    }

    const nextReviewAt = new Date();
    nextReviewAt.setDate(nextReviewAt.getDate() + interval);

    const updated = await this.prisma.reviewSchedule.update({
      where: { id: reviewScheduleId },
      data: {
        interval,
        easeFactor: Math.round(easeFactor * 100) / 100,
        repetitions,
        nextReviewAt,
        lastReviewedAt: new Date(),
      },
    });

    // Also update wrong answer retry tracking
    await this.prisma.wrongAnswer.update({
      where: { id: schedule.wrongAnswerId },
      data: {
        retryCount: { increment: 1 },
        lastRetryCorrect: isPass,
        ...(isPass && repetitions >= 3 ? { resolvedAt: new Date() } : {}),
      },
    });

    return {
      ...updated,
      isPass,
      nextReviewIn: `${interval} days`,
    };
  }

  /**
   * Get review stats for a student.
   */
  async getStats(studentId: string) {
    const now = new Date();

    const [totalScheduled, dueNow, completedToday] = await Promise.all([
      this.prisma.reviewSchedule.count({ where: { studentId } }),
      this.prisma.reviewSchedule.count({
        where: { studentId, nextReviewAt: { lte: now } },
      }),
      this.prisma.reviewSchedule.count({
        where: {
          studentId,
          lastReviewedAt: {
            gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          },
        },
      }),
    ]);

    return {
      totalScheduled,
      dueNow,
      completedToday,
    };
  }
}
```

**Step 2: Create ReviewController**

Create `apps/lms-api/src/review/review.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ReviewService } from "./review.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; role: string };
}

@Controller("review")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReviewController {
  constructor(private service: ReviewService) {}

  @Get("daily")
  @Roles("student")
  getDailyReview(
    @Request() req: AuthRequest,
    @Query("limit") limit?: string,
  ) {
    return this.service.getDailyReview(
      req.user.id,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Post(":id/result")
  @Roles("student")
  recordResult(
    @Param("id") id: string,
    @Body("quality") quality: number,
    @Request() req: AuthRequest,
  ) {
    return this.service.recordReviewResult(id, req.user.id, quality);
  }

  @Get("stats")
  @Roles("student")
  getStats(@Request() req: AuthRequest) {
    return this.service.getStats(req.user.id);
  }
}
```

**Step 3: Create module and register**

Create `apps/lms-api/src/review/review.module.ts`:
```typescript
import { Module } from "@nestjs/common";
import { ReviewService } from "./review.service";
import { ReviewController } from "./review.controller";

@Module({
  controllers: [ReviewController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
```

Add to `apps/lms-api/src/app.module.ts`:
```typescript
import { ReviewModule } from "./review/review.module";
// ... in imports: [... ReviewModule]
```

**Step 4: Auto-schedule reviews when wrong answers are created**

Modify `apps/lms-api/src/wrong-answers/wrong-answers.service.ts`:

Add import:
```typescript
import { ReviewService } from "../review/review.service";
```

Inject in constructor:
```typescript
constructor(
  private prisma: PrismaService,
  private reviewService: ReviewService,
) {}
```

In `collectFromSubmission()`, after the upsert loop, schedule reviews:
```typescript
// After the for loop that creates wrong answers:
for (const answer of wrongAnswers) {
  const problem = problemMap.get(answer.problemId);
  const errorType = this.classifyError(answer, problem);

  const wa = await this.prisma.wrongAnswer.upsert({ ... });

  // Schedule spaced repetition review
  await this.reviewService.scheduleReview(
    wa.id,
    submission.studentId,
    answer.problemId,
  );
}
```

Update `apps/lms-api/src/wrong-answers/wrong-answers.module.ts`:
```typescript
import { Module } from "@nestjs/common";
import { ReviewModule } from "../review/review.module";
import { WrongAnswersService } from "./wrong-answers.service";
import { WrongAnswersController } from "./wrong-answers.controller";

@Module({
  imports: [ReviewModule],
  controllers: [WrongAnswersController],
  providers: [WrongAnswersService],
  exports: [WrongAnswersService],
})
export class WrongAnswersModule {}
```

**Verify:** Create a wrong answer. Check `review_schedules` table has a row with `next_review_at = tomorrow`. Wait (or adjust time) and call `GET /v1/review/daily`. Verify the problem appears. Post a quality=4 result and confirm interval increases.

---

## Task 6: Auto-Generated Remediation Assignments (Feature 2-4)

**Files:**
- Create: `apps/lms-api/src/assignments/remediation.service.ts`
- Modify: `apps/lms-api/src/assignments/assignments.controller.ts`
- Modify: `apps/lms-api/src/assignments/assignments.module.ts`

**Context:** After a teacher grades/returns an assignment, we can auto-generate a "remediation" assignment. The flow: analyze wrong answers from the submission, find similar problems using the `ProblemSimilarity` table (populated by `find_similar.py`), and create a new assignment of type `remediation`. The existing `AssignmentsService.create()` (assignments.service.ts:109-150) already handles `problem_set` creation with `problemIds`, so we build on top of it.

**Step 1: Create RemediationService**

Create `apps/lms-api/src/assignments/remediation.service.ts`:

```typescript
import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

const MAX_REMEDIATION_PROBLEMS = 10;
const MIN_SIMILARITY = 0.6;

@Injectable()
export class RemediationService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate a remediation assignment for a specific submission.
   * Finds similar problems for each wrong answer using ProblemSimilarity.
   */
  async generateRemediation(
    assignmentId: string,
    studentId?: string,
  ) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        submissions: {
          where: {
            status: { in: ["graded", "returned"] },
            ...(studentId ? { studentId } : {}),
          },
          include: { answers: true },
          orderBy: { gradedAt: "desc" },
          take: 1,
        },
      },
    });
    if (!assignment) throw new NotFoundException("Assignment not found");

    const submission = assignment.submissions[0];
    if (!submission) {
      throw new BadRequestException("No graded submission found");
    }

    // Get wrong answers
    const wrongAnswerProblemIds = submission.answers
      .filter((a) => a.isCorrect === false)
      .map((a) => a.problemId);

    if (wrongAnswerProblemIds.length === 0) {
      throw new BadRequestException("No wrong answers to remediate");
    }

    // Find similar problems for each wrong answer
    const similarities = await this.prisma.problemSimilarity.findMany({
      where: {
        problemId: { in: wrongAnswerProblemIds },
        similarityScore: { gte: MIN_SIMILARITY },
      },
      orderBy: { similarityScore: "desc" },
    });

    // Deduplicate and exclude problems already in the original assignment
    const originalProblemIds = new Set(
      submission.answers.map((a) => a.problemId),
    );
    const selectedIds = new Set<string>();
    const remediationProblemIds: string[] = [];

    for (const sim of similarities) {
      if (remediationProblemIds.length >= MAX_REMEDIATION_PROBLEMS) break;
      if (originalProblemIds.has(sim.similarProblemId)) continue;
      if (selectedIds.has(sim.similarProblemId)) continue;

      selectedIds.add(sim.similarProblemId);
      remediationProblemIds.push(sim.similarProblemId);
    }

    if (remediationProblemIds.length === 0) {
      throw new BadRequestException(
        "No similar problems found for remediation. Try running the similarity analysis first.",
      );
    }

    // Create remediation assignment
    const remediation = await this.prisma.assignment.create({
      data: {
        title: `[보충] ${assignment.title}`,
        description: `"${assignment.title}" 오답 기반 자동 생성 보충 과제`,
        classId: assignment.classId,
        type: "remediation",
        maxScore: assignment.maxScore,
        sourceAssignmentId: assignment.id,
        assignmentProblems: {
          create: remediationProblemIds.map((problemId, index) => ({
            problemId,
            orderIndex: index,
          })),
        },
      },
      include: {
        assignmentProblems: true,
      },
    });

    return {
      id: remediation.id,
      title: remediation.title,
      problemCount: remediationProblemIds.length,
      sourceAssignmentId: assignment.id,
      wrongAnswerCount: wrongAnswerProblemIds.length,
    };
  }
}
```

**Step 2: Add endpoint to AssignmentsController**

Modify `apps/lms-api/src/assignments/assignments.controller.ts`. Find the existing controller and add:

```typescript
import { RemediationService } from "./remediation.service";

// In the constructor:
constructor(
  private assignments: AssignmentsService,
  private remediation: RemediationService,
) {}

// Add new endpoint:
@Post(":id/generate-remediation")
@Roles("admin", "teacher")
generateRemediation(
  @Param("id") id: string,
  @Query("studentId") studentId?: string,
) {
  return this.remediation.generateRemediation(id, studentId);
}
```

**Step 3: Register in module**

Modify `apps/lms-api/src/assignments/assignments.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { AssignmentsService } from "./assignments.service";
import { AssignmentsController } from "./assignments.controller";
import { RemediationService } from "./remediation.service";

@Module({
  controllers: [AssignmentsController],
  providers: [AssignmentsService, RemediationService],
})
export class AssignmentsModule {}
```

**Verify:** Grade an assignment with some wrong answers. Call `POST /v1/assignments/:id/generate-remediation`. Confirm a new assignment of type `remediation` is created with similar problems. Verify the problems are different from the original assignment.

---

## Task 7: Wrong Answers Frontend (Feature 2-1 UI)

**Files:**
- Create: `apps/web/src/app/(authenticated)/wrong-answers/page.tsx`
- Modify: `apps/web/src/components/ui/sidebar.tsx`

**Context:** Following the existing page patterns (e.g., problems/page.tsx uses `useQuery` + `api.get`, filter selects, card-based list, dialog preview). The sidebar component (sidebar.tsx) lists all navigation items. Student role sees different nav items than teacher.

**Step 1: Create wrong answers page**

Create `apps/web/src/app/(authenticated)/wrong-answers/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, Filter, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { LatexRenderer } from "@/components/math/latex-renderer";
import { SolutionViewer } from "@/components/problem/solution-viewer";

const ERROR_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  concept_gap: { label: "개념 부족", color: "bg-red-900/30 text-red-400 border-red-400/30" },
  pattern_gap: { label: "유형 미숙", color: "bg-orange-900/30 text-orange-400 border-orange-400/30" },
  calculation_error: { label: "계산 실수", color: "bg-yellow-900/30 text-yellow-400 border-yellow-400/30" },
  careless_mistake: { label: "단순 실수", color: "bg-blue-900/30 text-blue-400 border-blue-400/30" },
};

interface WrongAnswerItem {
  id: string;
  problemId: string;
  errorType: string;
  retryCount: number;
  lastRetryCorrect: boolean | null;
  resolvedAt: string | null;
  createdAt: string;
  problem: {
    id: string;
    stemLatex: string;
    stemText: string;
    problemType: string;
    difficulty: number | null;
    subject: string | null;
    unitMajor: string | null;
    displayNumber: string | null;
  } | null;
}

interface WrongAnswerStats {
  total: number;
  resolved: number;
  unresolved: number;
  byErrorType: Array<{ errorType: string; count: number }>;
}

export default function WrongAnswersPage() {
  const [errorFilter, setErrorFilter] = useState("");
  const [resolvedFilter, setResolvedFilter] = useState<string>("false");
  const [selectedItem, setSelectedItem] = useState<WrongAnswerItem | null>(null);

  const { data: stats } = useQuery({
    queryKey: ["wrong-answers-stats"],
    queryFn: () => api.get<WrongAnswerStats>("/wrong-answers/my/stats"),
  });

  const queryParams = [
    errorFilter && `errorType=${errorFilter}`,
    resolvedFilter && `resolved=${resolvedFilter}`,
  ].filter(Boolean).join("&");

  const { data: items, isLoading } = useQuery({
    queryKey: ["wrong-answers", errorFilter, resolvedFilter],
    queryFn: () =>
      api.get<WrongAnswerItem[]>(`/wrong-answers/my?${queryParams}`),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">오답노트</h1>
        <p className="text-muted-foreground">
          틀린 문제를 유형별로 분석하고 복습합니다.
        </p>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">총 오답</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-red-400">{stats.unresolved}</p>
              <p className="text-xs text-muted-foreground">미해결</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-green-400">{stats.resolved}</p>
              <p className="text-xs text-muted-foreground">해결</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">
                {stats.total > 0
                  ? Math.round((stats.resolved / stats.total) * 100)
                  : 0}%
              </p>
              <p className="text-xs text-muted-foreground">해결률</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {[
          { value: "", label: "전체 유형" },
          ...Object.entries(ERROR_TYPE_LABELS).map(([value, { label }]) => ({
            value,
            label,
          })),
        ].map((f) => (
          <Button
            key={f.value}
            variant={errorFilter === f.value ? "default" : "secondary"}
            size="sm"
            onClick={() => setErrorFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}

        <span className="mx-2 text-muted-foreground">|</span>

        {[
          { value: "false", label: "미해결" },
          { value: "true", label: "해결" },
          { value: "", label: "전체" },
        ].map((f) => (
          <Button
            key={f.value}
            variant={resolvedFilter === f.value ? "default" : "secondary"}
            size="sm"
            onClick={() => setResolvedFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* List */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && items && items.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <CheckCircle className="h-12 w-12 text-green-400" />
            <p className="mt-4 text-lg font-medium">오답이 없습니다</p>
          </CardContent>
        </Card>
      )}

      {!isLoading && items && items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => {
            const errorInfo = ERROR_TYPE_LABELS[item.errorType] ?? {
              label: item.errorType,
              color: "bg-muted text-muted-foreground",
            };

            return (
              <Card
                key={item.id}
                className="cursor-pointer transition-colors hover:border-brand-beige"
                onClick={() => setSelectedItem(item)}
              >
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-dark">
                    {item.resolvedAt ? (
                      <CheckCircle className="h-5 w-5 text-green-400" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-red-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.problem?.displayNumber
                        ? `#${item.problem.displayNumber}`
                        : item.problemId.slice(0, 8)}
                      {item.problem?.unitMajor && ` - ${item.problem.unitMajor}`}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.problem?.stemText?.slice(0, 80) ?? ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.retryCount > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {item.retryCount}회 재도전
                      </Badge>
                    )}
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${errorInfo.color}`}>
                      {errorInfo.label}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail dialog */}
      <Dialog
        open={selectedItem !== null}
        onOpenChange={(open) => !open && setSelectedItem(null)}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          {selectedItem?.problem && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {selectedItem.problem.displayNumber
                    ? `문제 #${selectedItem.problem.displayNumber}`
                    : "오답 상세"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="rounded-xl border border-border bg-brand-dark p-4">
                  <LatexRenderer
                    content={selectedItem.problem.stemLatex || selectedItem.problem.stemText}
                    className="text-sm leading-relaxed"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                      ERROR_TYPE_LABELS[selectedItem.errorType]?.color ?? ""
                    }`}
                  >
                    {ERROR_TYPE_LABELS[selectedItem.errorType]?.label ?? selectedItem.errorType}
                  </span>
                  {selectedItem.problem.subject && (
                    <Badge variant="outline">{selectedItem.problem.subject}</Badge>
                  )}
                  {selectedItem.problem.unitMajor && (
                    <Badge variant="outline">{selectedItem.problem.unitMajor}</Badge>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

**Step 2: Add navigation link**

Modify `apps/web/src/components/ui/sidebar.tsx`. Add to the student navigation items array:

```typescript
{ href: "/wrong-answers", label: "오답노트", icon: BookOpen }
```

**Verify:** Log in as a student with wrong answers. Navigate to `/wrong-answers`. Confirm stats cards show correct counts, error type filters work, and clicking a card opens the detail dialog.

---

## Task 8: Mastery Map Frontend (Feature 2-2 UI)

**Files:**
- Create: `apps/web/src/app/(authenticated)/mastery/page.tsx`
- Modify: `apps/web/src/components/ui/sidebar.tsx`

**Context:** The mastery data comes from `GET /v1/mastery/my` (returns array of StudentMastery records) and `GET /v1/mastery/my/summary` (returns state counts). The visualization should show a grid/treemap of curriculum nodes colored by mastery state.

**Step 1: Create mastery page**

Create `apps/web/src/app/(authenticated)/mastery/page.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

const STATE_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  not_started: { label: "미시작", bg: "bg-zinc-800", text: "text-zinc-400" },
  learning: { label: "학습중", bg: "bg-yellow-900/40", text: "text-yellow-400" },
  practicing: { label: "연습중", bg: "bg-blue-900/40", text: "text-blue-400" },
  mastered: { label: "완료", bg: "bg-green-900/40", text: "text-green-400" },
};

interface MasteryRecord {
  id: string;
  curriculumNodeId: string;
  state: string;
  consecutiveCorrect: number;
  totalAttempts: number;
  totalCorrect: number;
  lastAttemptAt: string | null;
  masteredAt: string | null;
}

interface MasterySummary {
  studentId: string;
  not_started: number;
  learning: number;
  practicing: number;
  mastered: number;
  total: number;
}

export default function MasteryPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["mastery-summary"],
    queryFn: () => api.get<MasterySummary>("/mastery/my/summary"),
  });

  const { data: records, isLoading: recordsLoading } = useQuery({
    queryKey: ["mastery-records"],
    queryFn: () => api.get<MasteryRecord[]>("/mastery/my"),
  });

  const isLoading = summaryLoading || recordsLoading;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">학습 진도</h1>
        <p className="text-muted-foreground">
          개념별 마스터 현황을 확인합니다.
        </p>
      </div>

      {/* Summary bar */}
      {summary && summary.total > 0 && (
        <div className="space-y-3">
          <div className="flex h-4 w-full overflow-hidden rounded-full">
            {(["mastered", "practicing", "learning", "not_started"] as const).map((state) => {
              const count = summary[state];
              const pct = (count / summary.total) * 100;
              if (pct === 0) return null;
              return (
                <div
                  key={state}
                  className={`${STATE_STYLES[state].bg} transition-all`}
                  style={{ width: `${pct}%` }}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-4">
            {(["mastered", "practicing", "learning", "not_started"] as const).map((state) => (
              <div key={state} className="flex items-center gap-2">
                <div className={`h-3 w-3 rounded-full ${STATE_STYLES[state].bg}`} />
                <span className="text-sm">
                  {STATE_STYLES[state].label}: {summary[state]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      )}

      {/* Mastery grid */}
      {!isLoading && records && records.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {records.map((record) => {
            const style = STATE_STYLES[record.state] ?? STATE_STYLES.not_started;
            const accuracy =
              record.totalAttempts > 0
                ? Math.round((record.totalCorrect / record.totalAttempts) * 100)
                : 0;

            return (
              <Card key={record.id} className={`${style.bg} border-transparent`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className={`text-xs ${style.text}`}>
                      {style.label}
                    </Badge>
                    {record.consecutiveCorrect > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {record.consecutiveCorrect}연속
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-medium truncate">
                    {record.curriculumNodeId}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{record.totalAttempts}문제</span>
                    <span>{accuracy}% 정답률</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Empty */}
      {!isLoading && (!records || records.length === 0) && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <p className="text-lg font-medium">아직 학습 기록이 없습니다</p>
            <p className="mt-1 text-sm text-muted-foreground">
              과제를 풀면 개념별 진도가 자동으로 추적됩니다.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

**Step 2: Add to sidebar**

Add to student navigation items in `apps/web/src/components/ui/sidebar.tsx`:

```typescript
{ href: "/mastery", label: "학습 진도", icon: TrendingUp }
```

**Verify:** Log in as a student. Navigate to `/mastery`. Confirm summary bar renders. Confirm grid cards show mastery state with correct colors.

---

## Task 9: Daily Review Frontend (Feature 2-5 UI)

**Files:**
- Create: `apps/web/src/app/(authenticated)/review-daily/page.tsx`
- Modify: `apps/web/src/components/ui/sidebar.tsx`

**Context:** `GET /v1/review/daily` returns `{ dueCount, problems: [...] }` with full problem data and review schedule metadata. The student answers each problem and submits quality (0-5) via `POST /v1/review/:id/result`.

**Step 1: Create daily review page**

Create `apps/web/src/app/(authenticated)/review-daily/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, XCircle, Clock, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { LatexRenderer } from "@/components/math/latex-renderer";
import { SolutionViewer } from "@/components/problem/solution-viewer";

interface ReviewProblem {
  reviewScheduleId: string;
  wrongAnswerId: string;
  errorType: string;
  interval: number;
  repetitions: number;
  problem: {
    id: string;
    stemLatex: string;
    stemText: string;
    problemType: string;
    difficulty: number | null;
    subject: string | null;
    unitMajor: string | null;
    displayNumber: string | null;
    answerText: string | null;
    answerLatex: string | null;
    solutionSteps: Array<{ step: number; description: string; concept: string }> | null;
    choices: Array<{ label: string; contentLatex: string; contentText: string }>;
  } | null;
}

interface DailyReviewResponse {
  dueCount: number;
  problems: ReviewProblem[];
}

export default function ReviewDailyPage() {
  const queryClient = useQueryClient();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["review-daily"],
    queryFn: () => api.get<DailyReviewResponse>("/review/daily"),
  });

  const { data: stats } = useQuery({
    queryKey: ["review-stats"],
    queryFn: () =>
      api.get<{ totalScheduled: number; dueNow: number; completedToday: number }>(
        "/review/stats",
      ),
  });

  const resultMutation = useMutation({
    mutationFn: ({ id, quality }: { id: string; quality: number }) =>
      api.post(`/review/${id}/result`, { quality }),
    onSuccess: () => {
      setCompletedCount((c) => c + 1);
      setShowAnswer(false);
      setCurrentIndex((i) => i + 1);
      queryClient.invalidateQueries({ queryKey: ["review-stats"] });
    },
  });

  const problems = data?.problems ?? [];
  const currentProblem = problems[currentIndex];
  const isDone = currentIndex >= problems.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">오늘의 복습</h1>
          <p className="text-muted-foreground">
            간격 반복 학습으로 기억을 강화합니다.
          </p>
        </div>
        {stats && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              대기: {stats.dueNow}
            </span>
            <span className="flex items-center gap-1">
              <CheckCircle className="h-4 w-4 text-green-400" />
              완료: {stats.completedToday + completedCount}
            </span>
          </div>
        )}
      </div>

      {isLoading && (
        <Card>
          <CardContent className="flex items-center justify-center py-20">
            <RotateCcw className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      )}

      {!isLoading && problems.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <CheckCircle className="h-16 w-16 text-green-400" />
            <p className="mt-4 text-lg font-medium">오늘의 복습을 모두 완료했습니다!</p>
            <p className="mt-1 text-sm text-muted-foreground">
              내일 다시 확인하세요.
            </p>
          </CardContent>
        </Card>
      )}

      {!isLoading && !isDone && currentProblem?.problem && (
        <div className="space-y-4">
          {/* Progress */}
          <div className="flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-brand-dark">
              <div
                className="h-full rounded-full bg-brand-beige transition-all"
                style={{
                  width: `${((currentIndex) / problems.length) * 100}%`,
                }}
              />
            </div>
            <span className="text-sm text-muted-foreground">
              {currentIndex + 1} / {problems.length}
            </span>
          </div>

          {/* Problem card */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Badge variant="outline">
                  {currentProblem.problem.subject ?? "수학"}
                </Badge>
                {currentProblem.problem.unitMajor && (
                  <Badge variant="outline">
                    {currentProblem.problem.unitMajor}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  복습 {currentProblem.repetitions + 1}회차
                </Badge>
              </div>

              <div className="rounded-xl border border-border bg-brand-dark p-5">
                <LatexRenderer
                  content={
                    currentProblem.problem.stemLatex ||
                    currentProblem.problem.stemText
                  }
                  className="text-sm leading-relaxed"
                />

                {currentProblem.problem.choices.length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-border pt-3">
                    {currentProblem.problem.choices.map((choice, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className="shrink-0 font-medium text-brand-beige">
                          {choice.label}
                        </span>
                        <LatexRenderer
                          content={choice.contentLatex || choice.contentText}
                          className="leading-relaxed"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Show answer toggle */}
              {!showAnswer && (
                <div className="mt-4 flex justify-center">
                  <Button onClick={() => setShowAnswer(true)}>
                    정답 확인하기
                  </Button>
                </div>
              )}

              {/* Answer + self-assessment */}
              {showAnswer && (
                <div className="mt-4 space-y-4">
                  <div className="rounded-lg border border-green-400/30 bg-green-900/10 p-3">
                    <span className="text-xs font-semibold text-green-400">
                      정답:{" "}
                    </span>
                    <LatexRenderer
                      content={
                        currentProblem.problem.answerLatex ||
                        currentProblem.problem.answerText ||
                        ""
                      }
                      className="inline text-sm"
                    />
                  </div>

                  <p className="text-center text-sm text-muted-foreground">
                    얼마나 잘 기억했나요?
                  </p>
                  <div className="flex justify-center gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        resultMutation.mutate({
                          id: currentProblem.reviewScheduleId,
                          quality: 1,
                        })
                      }
                      disabled={resultMutation.isPending}
                    >
                      <XCircle className="mr-1 h-4 w-4" />
                      모르겠음
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        resultMutation.mutate({
                          id: currentProblem.reviewScheduleId,
                          quality: 3,
                        })
                      }
                      disabled={resultMutation.isPending}
                    >
                      어렵게 맞춤
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        resultMutation.mutate({
                          id: currentProblem.reviewScheduleId,
                          quality: 4,
                        })
                      }
                      disabled={resultMutation.isPending}
                    >
                      맞춤
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        resultMutation.mutate({
                          id: currentProblem.reviewScheduleId,
                          quality: 5,
                        })
                      }
                      disabled={resultMutation.isPending}
                    >
                      <CheckCircle className="mr-1 h-4 w-4" />
                      쉬웠음
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Session complete */}
      {!isLoading && isDone && problems.length > 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20">
            <CheckCircle className="h-16 w-16 text-green-400" />
            <p className="mt-4 text-lg font-medium">
              {completedCount}문제 복습 완료!
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              수고하셨습니다. 내일 다시 복습 문제가 준비됩니다.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

**Step 2: Add to sidebar**

Add to student navigation items in `apps/web/src/components/ui/sidebar.tsx`:

```typescript
{ href: "/review-daily", label: "오늘의 복습", icon: RotateCcw }
```

**Verify:** Log in as a student with due review items. Navigate to `/review-daily`. Confirm problem displays, answer reveal works, and self-assessment buttons call the API and advance to the next problem.

---

## Task 10: Shared Types Update

**Files:**
- Modify: `packages/shared-types/src/index.ts`

**Context:** Add all new types so they can be shared between frontend and backend. The existing file (shared-types/src/index.ts) already exports `SolutionStep`, `Problem`, `Submission`, `SubmissionAnswer`, etc.

**Step 1: Add Phase 2 types**

Append to `packages/shared-types/src/index.ts`:

```typescript
// ─── Phase 2: Student Learning Experience Types ───

export type ErrorType =
  | "concept_gap"
  | "pattern_gap"
  | "calculation_error"
  | "careless_mistake";

export type MasteryState =
  | "not_started"
  | "learning"
  | "practicing"
  | "mastered";

export interface WrongAnswer {
  id: string;
  studentId: string;
  problemId: string;
  submissionId: string;
  errorType: ErrorType;
  note: string | null;
  retryCount: number;
  lastRetryCorrect: boolean | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface WrongAnswerStats {
  total: number;
  resolved: number;
  unresolved: number;
  byErrorType: Array<{ errorType: ErrorType; count: number }>;
}

export interface StudentMastery {
  id: string;
  studentId: string;
  curriculumNodeId: string;
  state: MasteryState;
  consecutiveCorrect: number;
  totalAttempts: number;
  totalCorrect: number;
  lastAttemptAt: string | null;
  masteredAt: string | null;
}

export interface MasterySummary {
  studentId: string;
  not_started: number;
  learning: number;
  practicing: number;
  mastered: number;
  total: number;
}

export interface ReviewScheduleItem {
  reviewScheduleId: string;
  wrongAnswerId: string;
  errorType: ErrorType;
  interval: number;
  repetitions: number;
  problem: Problem | null;
}

export interface DailyReviewResponse {
  dueCount: number;
  problems: ReviewScheduleItem[];
}

export interface ReviewStats {
  totalScheduled: number;
  dueNow: number;
  completedToday: number;
}

export interface AlternativeSolution {
  method: string;
  label: string;
  steps: SolutionStep[];
  answerText: string;
}

export type RemediationAssignmentType = "remediation";
```

**Verify:** `pnpm --filter @jsmath/shared-types build` succeeds. Types are importable from `@jsmath/shared-types`.

---

## Execution Order & Dependency Graph

```
Task 1: DB Schema (WrongAnswer, StudentMastery, ReviewSchedule)
  |
  +---> Task 2: WrongAnswers Service + Collection Hook
  |       |
  |       +---> Task 5: Spaced Repetition Engine (depends on WrongAnswer creation)
  |       |       |
  |       |       +---> Task 9: Daily Review Frontend
  |       |
  |       +---> Task 7: Wrong Answers Frontend
  |
  +---> Task 3: Mastery Tracking Service + Hook
  |       |
  |       +---> Task 8: Mastery Map Frontend
  |
  +---> Task 4: Step-by-Step Solution Display (standalone, uses existing data)
  |
  +---> Task 6: Remediation Assignment Generation (depends on ProblemSimilarity data)

Task 10: Shared Types (can run in parallel with any task, but best after Task 1)
```

**Critical path:** Task 1 -> Task 2 -> Task 5 -> Task 9

**Parallel tracks after Task 1:**
- Track A: Task 2 -> Task 5 -> Task 9
- Track B: Task 3 -> Task 8
- Track C: Task 4 (independent)
- Track D: Task 6 (independent, needs ProblemSimilarity data)
- Track E: Task 7 (after Task 2)
- Track F: Task 10 (anytime)

**Estimated implementation order for a single developer:**
1. Task 1 (schema) — 1 hour
2. Task 10 (shared types) — 30 min
3. Task 2 (wrong answers backend) — 2 hours
4. Task 3 (mastery backend) — 1.5 hours
5. Task 5 (spaced repetition backend) — 1.5 hours
6. Task 6 (remediation backend) — 1 hour
7. Task 4 (solution viewer component) — 1 hour
8. Task 7 (wrong answers frontend) — 1.5 hours
9. Task 8 (mastery frontend) — 1 hour
10. Task 9 (daily review frontend) — 1.5 hours

**Total estimated:** ~12 hours
