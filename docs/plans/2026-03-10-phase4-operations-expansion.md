# Phase 4: Operations & Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend JSMath from a question-bank/LMS into a full hagwon operations platform with parent engagement, grade prediction, gamification, real-time class monitoring, billing/attendance management, and LMS interoperability via LTI/QTI standards.

**Architecture:** Six new NestJS modules (`parent-analytics`, `grade-prediction`, `gamification`, `class-monitor`, `operations`, `integrations`) extend the existing `apps/lms-api`. A WebSocket gateway powers real-time class monitoring. New Prisma models in the `public` schema store operational data (attendance, billing, achievements, streaks, grade cutoffs). Frontend additions span both `apps/web` (teacher dashboard) and `apps/mobile` (parent + student views). A weekly BullMQ cron job generates parent summary reports.

**Tech Stack:** Prisma (schema), NestJS + @nestjs/websockets (API + WS), BullMQ (scheduled jobs), Next.js 15 (web frontend), React Native/Expo (mobile), recharts (charts), PostgreSQL 16, Redis

---

## Task 1: Enhanced Parent Dashboard — Schema & Weekly Report API

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`
- Create: `packages/db-schema/prisma/migrations/YYYYMMDD_parent_weekly_reports/migration.sql`
- Create: `apps/lms-api/src/parent-analytics/parent-analytics.module.ts`
- Create: `apps/lms-api/src/parent-analytics/parent-analytics.service.ts`
- Create: `apps/lms-api/src/parent-analytics/parent-analytics.controller.ts`
- Create: `apps/lms-api/src/parent-analytics/weekly-report.processor.ts`
- Modify: `apps/lms-api/src/app.module.ts`
- Modify: `apps/lms-api/src/notifications/notifications.service.ts`

**Context:** The current parent portal (`apps/mobile/app/(parent)/index.tsx`) shows child cards with next lesson, pending assignments, and latest score. The child detail page (`apps/mobile/app/(parent)/children/[id].tsx`) calls `GET /analytics/student/:id` which returns `accuracyByUnit`, `scoreTrend`, `weakTopics`. We need a dedicated weekly report endpoint with richer aggregated data and a scheduled job to generate it every Monday.

**Step 1: Add ParentWeeklyReport model to Prisma schema**

Add after the `Notification` model in `packages/db-schema/prisma/schema.prisma`:

```prisma
model ParentWeeklyReport {
  id                   String   @id @default(cuid())
  parentId             String   @map("parent_id")
  studentId            String   @map("student_id")
  weekStart            DateTime @map("week_start")
  weekEnd              DateTime @map("week_end")

  // Aggregated metrics
  assignmentCompletionRate Float   @map("assignment_completion_rate")
  avgScore                 Float?  @map("avg_score")
  problemsSolved           Int     @map("problems_solved")
  correctRate              Float?  @map("correct_rate")
  lessonsAttended          Int     @map("lessons_attended")
  lessonsTotal             Int     @map("lessons_total")

  // Serialized analysis
  masteryProgress     Json?    @map("mastery_progress")   // { unit: string, before: number, after: number }[]
  weaknessHeatmap     Json?    @map("weakness_heatmap")   // { unit: string, accuracy: number, color: "red"|"yellow"|"green" }[]
  scoreTrend          Json?    @map("score_trend")        // { date: string, score: number }[]

  createdAt           DateTime @default(now()) @map("created_at")

  @@unique([parentId, studentId, weekStart])
  @@index([parentId, weekStart])
  @@index([studentId])
  @@map("parent_weekly_reports")
  @@schema("public")
}
```

**Step 2: Run migration**

```bash
cd packages/db-schema && pnpm db:migrate --name parent_weekly_reports
```

**Step 3: Create ParentAnalyticsService**

Create `apps/lms-api/src/parent-analytics/parent-analytics.service.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ParentAnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getWeeklyReport(parentId: string, studentId: string, weekStart?: string) {
    // If weekStart not provided, use most recent Monday
    const start = weekStart
      ? new Date(weekStart)
      : this.getMostRecentMonday();

    const report = await this.prisma.parentWeeklyReport.findUnique({
      where: {
        parentId_studentId_weekStart: {
          parentId,
          studentId,
          weekStart: start,
        },
      },
    });

    if (report) return report;

    // Generate on-demand if not yet created
    return this.generateReport(parentId, studentId, start);
  }

  async generateReport(parentId: string, studentId: string, weekStart: Date) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    // 1. Assignment completion rate
    const assignments = await this.prisma.assignment.findMany({
      where: {
        class: {
          enrollments: { some: { userId: studentId } },
        },
        dueAt: { gte: weekStart, lt: weekEnd },
      },
      select: { id: true },
    });
    const assignmentIds = assignments.map((a) => a.id);

    const submissions = assignmentIds.length
      ? await this.prisma.submission.findMany({
          where: {
            studentId,
            assignmentId: { in: assignmentIds },
          },
          select: { id: true, score: true, maxScore: true },
        })
      : [];

    const completionRate = assignmentIds.length > 0
      ? submissions.length / assignmentIds.length
      : 0;

    // 2. Average score
    const scored = submissions.filter((s) => s.score !== null);
    const avgScore = scored.length > 0
      ? scored.reduce((sum, s) => sum + (s.score ?? 0), 0) / scored.length
      : null;

    // 3. Problems solved + correct rate
    const answers = await this.prisma.submissionAnswer.findMany({
      where: {
        submission: {
          studentId,
          submittedAt: { gte: weekStart, lt: weekEnd },
        },
        isCorrect: { not: null },
      },
      select: { isCorrect: true },
    });
    const correctRate = answers.length > 0
      ? answers.filter((a) => a.isCorrect).length / answers.length
      : null;

    // 4. Lessons attended
    const lessons = await this.prisma.lesson.findMany({
      where: {
        class: { enrollments: { some: { userId: studentId } } },
        startAt: { gte: weekStart, lt: weekEnd },
      },
      select: { id: true, status: true },
    });
    const lessonsAttended = lessons.filter((l) => l.status === "completed").length;

    // 5. Weakness heatmap (from AnalyticsService-style unit accuracy)
    const weekAnswers = await this.prisma.submissionAnswer.findMany({
      where: {
        submission: {
          studentId,
          submittedAt: { gte: weekStart, lt: weekEnd },
        },
        isCorrect: { not: null },
      },
      select: { problemId: true, isCorrect: true },
    });

    const problemIds = [...new Set(weekAnswers.map((a) => a.problemId))];
    const problems = problemIds.length
      ? await this.prisma.problem.findMany({
          where: { id: { in: problemIds } },
          select: { id: true, unitMajor: true },
        })
      : [];
    const problemMap = new Map(problems.map((p) => [p.id, p]));

    const unitStats: Record<string, { correct: number; total: number }> = {};
    for (const ans of weekAnswers) {
      const unit = problemMap.get(ans.problemId)?.unitMajor ?? "미분류";
      if (!unitStats[unit]) unitStats[unit] = { correct: 0, total: 0 };
      unitStats[unit].total++;
      if (ans.isCorrect) unitStats[unit].correct++;
    }

    const weaknessHeatmap = Object.entries(unitStats).map(([unit, { correct, total }]) => {
      const accuracy = Math.round((correct / total) * 100);
      const color = accuracy >= 80 ? "green" : accuracy >= 50 ? "yellow" : "red";
      return { unit, accuracy, color };
    });

    // 6. Score trend (all scores this week)
    const weekSubmissions = await this.prisma.submission.findMany({
      where: {
        studentId,
        submittedAt: { gte: weekStart, lt: weekEnd },
        score: { not: null },
      },
      select: { submittedAt: true, score: true },
      orderBy: { submittedAt: "asc" },
    });
    const scoreTrend = weekSubmissions.map((s) => ({
      date: s.submittedAt.toISOString().slice(0, 10),
      score: s.score,
    }));

    return this.prisma.parentWeeklyReport.upsert({
      where: {
        parentId_studentId_weekStart: { parentId, studentId, weekStart },
      },
      create: {
        parentId,
        studentId,
        weekStart,
        weekEnd,
        assignmentCompletionRate: completionRate,
        avgScore,
        problemsSolved: answers.length,
        correctRate,
        lessonsAttended,
        lessonsTotal: lessons.length,
        masteryProgress: null,  // Phase 2 dependency — populate when StudentMastery exists
        weaknessHeatmap,
        scoreTrend,
      },
      update: {
        assignmentCompletionRate: completionRate,
        avgScore,
        problemsSolved: answers.length,
        correctRate,
        lessonsAttended,
        lessonsTotal: lessons.length,
        weaknessHeatmap,
        scoreTrend,
      },
    });
  }

  private getMostRecentMonday(): Date {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }
}
```

**Step 4: Create weekly report BullMQ processor**

Create `apps/lms-api/src/parent-analytics/weekly-report.processor.ts`:

```typescript
import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { ParentAnalyticsService } from "./parent-analytics.service";
import { NotificationsService } from "../notifications/notifications.service";

@Processor("parent-weekly-reports")
export class WeeklyReportProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private parentAnalytics: ParentAnalyticsService,
    private notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job) {
    // Find all parent-student links
    const links = await this.prisma.parentStudent.findMany({
      select: { parentId: true, studentId: true },
    });

    const monday = this.getMostRecentMonday();

    for (const link of links) {
      const report = await this.parentAnalytics.generateReport(
        link.parentId,
        link.studentId,
        monday,
      );

      // Push notification to parent
      const student = await this.prisma.user.findUnique({
        where: { id: link.studentId },
        select: { name: true },
      });

      await this.notifications.create(
        link.parentId,
        "weekly_report",
        `${student?.name ?? "자녀"} 주간 리포트`,
        `이번 주 과제 완료율 ${Math.round(report.assignmentCompletionRate * 100)}%, 정답률 ${report.correctRate ? Math.round(report.correctRate * 100) : "-"}%`,
        { type: "weekly_report", id: report.id },
      );
    }
  }

  private getMostRecentMonday(): Date {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }
}
```

**Step 5: Create controller with parent access checks**

Create `apps/lms-api/src/parent-analytics/parent-analytics.controller.ts`:

```typescript
import { Controller, Get, Param, Query, UseGuards, Request, ForbiddenException } from "@nestjs/common";
import { ParentAnalyticsService } from "./parent-analytics.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { PrismaService } from "../prisma/prisma.service";
import { canAccessStudentData } from "../common/access-control";

@Controller("analytics/parent")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ParentAnalyticsController {
  constructor(
    private parentAnalytics: ParentAnalyticsService,
    private prisma: PrismaService,
  ) {}

  @Get("weekly-report/:childId")
  async weeklyReport(
    @Param("childId") childId: string,
    @Query("weekStart") weekStart: string | undefined,
    @Request() req: { user: { id: string; role: string } },
  ) {
    const allowed = await canAccessStudentData(
      this.prisma, req.user.id, req.user.role, childId,
    );
    if (!allowed) throw new ForbiddenException();
    return this.parentAnalytics.getWeeklyReport(req.user.id, childId, weekStart);
  }
}
```

**Step 6: Create module and register in AppModule**

Create `apps/lms-api/src/parent-analytics/parent-analytics.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ParentAnalyticsService } from "./parent-analytics.service";
import { ParentAnalyticsController } from "./parent-analytics.controller";
import { WeeklyReportProcessor } from "./weekly-report.processor";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [
    BullModule.registerQueue({ name: "parent-weekly-reports" }),
    NotificationsModule,
  ],
  controllers: [ParentAnalyticsController],
  providers: [ParentAnalyticsService, WeeklyReportProcessor],
  exports: [ParentAnalyticsService],
})
export class ParentAnalyticsModule {}
```

Add to `apps/lms-api/src/app.module.ts` imports array:

```typescript
import { ParentAnalyticsModule } from "./parent-analytics/parent-analytics.module";
// ...
imports: [
  // ... existing imports
  ParentAnalyticsModule,
],
```

**Step 7: Add parent notification triggers to existing services**

In `apps/lms-api/src/submissions/submissions.service.ts`, after grading completes in the `grade()` method (line ~544), add:

```typescript
// After the submission update:
await this.notifications.notifyParents(
  submission.studentId,
  "grade_posted",
  "채점 완료",
  `${assignment.title} 과제 채점이 완료되었습니다. 점수: ${dto.score}`,
  { type: "submission", id },
);
```

This requires injecting `NotificationsService` into `SubmissionsService`.

**Verify:** `GET /v1/analytics/parent/weekly-report/:childId` returns aggregated weekly report with completion rate, scores, weakness heatmap, and score trend.

---

## Task 2: Enhanced Parent Dashboard — Frontend (Mobile + Web)

**Files:**
- Create: `apps/mobile/app/(parent)/dashboard.tsx`
- Modify: `apps/mobile/app/(parent)/children/[id].tsx`
- Modify: `apps/mobile/app/(parent)/_layout.tsx`
- Create: `apps/web/src/app/(authenticated)/parent-reports/page.tsx`

**Context:** The existing mobile parent child detail page (`apps/mobile/app/(parent)/children/[id].tsx`) shows unit accuracy bars, score trend bars, weakness list, and recent submissions. We need to add the weekly report view with the weakness heatmap and score trend chart.

**Step 1: Create parent dashboard page (mobile)**

Create `apps/mobile/app/(parent)/dashboard.tsx` with:
- Weekly summary cards (completion rate, avg score, problems solved, lessons attended)
- Weakness heatmap: FlatList grid of unit cells, background color based on `color` field
- Score trend: simple bar chart (reuse existing bar pattern from `children/[id].tsx`)
- Pull to refresh
- Tab navigation: week selector (prev/next arrows)

Key API call:
```typescript
const { data } = useQuery({
  queryKey: ["parent-weekly-report", childId, weekStart],
  queryFn: () => api.get(`/analytics/parent/weekly-report/${childId}?weekStart=${weekStart}`),
});
```

**Step 2: Update child detail page to link to dashboard**

In `apps/mobile/app/(parent)/children/[id].tsx`, add a "주간 리포트" button that navigates to `/(parent)/dashboard?childId=${id}`.

**Step 3: Add web parent reports page (for admin/teacher to view)**

Create `apps/web/src/app/(authenticated)/parent-reports/page.tsx`:
- Student selector dropdown
- Week selector
- Renders the same data as mobile but using shadcn/ui Cards and recharts for the trend chart
- Weakness heatmap as a CSS grid of colored cells

**Verify:** Mobile parent can view weekly summary, heatmap, and trend chart for linked child. Web teacher can view parent reports for any student in their organization.

---

## Task 3: Grade Cut-off & Score Prediction — Schema & API

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`
- Create: `packages/db-schema/prisma/migrations/YYYYMMDD_grade_cutoffs/migration.sql`
- Create: `packages/db-schema/prisma/seed-grade-cutoffs.ts`
- Create: `apps/lms-api/src/grade-prediction/grade-prediction.module.ts`
- Create: `apps/lms-api/src/grade-prediction/grade-prediction.service.ts`
- Create: `apps/lms-api/src/grade-prediction/grade-prediction.controller.ts`
- Modify: `apps/lms-api/src/app.module.ts`

**Context:** Korean Suneung (CSAT) grades are determined by cutoff scores that vary each year. Students want to know their estimated grade based on practice scores. We need reference data and a prediction algorithm.

**Step 1: Add GradeCutoff model to Prisma schema**

```prisma
model GradeCutoff {
  id        String   @id @default(cuid())
  examYear  Int      @map("exam_year")       // e.g., 2025
  examMonth Int      @map("exam_month")      // 6, 9, 11 (모의평가/수능)
  examType  String   @map("exam_type")       // "수능", "모의평가", "학력평가"
  subject   String                           // "수학", "수학I", "수학II", etc.
  maxScore  Int      @map("max_score")       // 100 or raw max
  grade1    Int                              // cutoff for grade 1
  grade2    Int
  grade3    Int
  grade4    Int
  grade5    Int
  grade6    Int
  grade7    Int
  grade8    Int
  grade9    Int      @default(0)
  createdAt DateTime @default(now()) @map("created_at")

  @@unique([examYear, examMonth, examType, subject])
  @@index([examYear, subject])
  @@map("grade_cutoffs")
  @@schema("public")
}
```

**Step 2: Create seed script with historical data**

Create `packages/db-schema/prisma/seed-grade-cutoffs.ts` with 2020-2025 수능 and major 모의고사 grade cutoffs for math. Source from publicly available KICE data. Example:

```typescript
const CUTOFFS = [
  { examYear: 2025, examMonth: 11, examType: "수능", subject: "수학", maxScore: 100,
    grade1: 92, grade2: 85, grade3: 77, grade4: 68, grade5: 55, grade6: 40, grade7: 28, grade8: 17, grade9: 0 },
  { examYear: 2024, examMonth: 11, examType: "수능", subject: "수학", maxScore: 100,
    grade1: 90, grade2: 82, grade3: 74, grade4: 63, grade5: 50, grade6: 37, grade7: 25, grade8: 15, grade9: 0 },
  // ... more rows
];
```

**Step 3: Create GradePredictionService**

Create `apps/lms-api/src/grade-prediction/grade-prediction.service.ts`:

```typescript
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

interface GradePrediction {
  currentEstimatedGrade: number;
  currentScore: number;
  trendSlope: number;           // positive = improving
  projectedScore: number;       // 4-week projection
  projectedGrade: number;
  referenceCutoffs: { grade: number; cutoff: number }[];
  scoreHistory: { date: string; score: number; normalizedScore: number }[];
}

@Injectable()
export class GradePredictionService {
  constructor(private prisma: PrismaService) {}

  async predict(studentId: string): Promise<GradePrediction> {
    // 1. Get recent graded submissions (last 8 weeks)
    const eightWeeksAgo = new Date();
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

    const submissions = await this.prisma.submission.findMany({
      where: {
        studentId,
        status: { in: ["graded", "returned"] },
        score: { not: null },
        submittedAt: { gte: eightWeeksAgo },
      },
      select: { submittedAt: true, score: true, maxScore: true },
      orderBy: { submittedAt: "asc" },
    });

    if (submissions.length === 0) {
      throw new NotFoundException("No scored submissions found for prediction");
    }

    // 2. Normalize all scores to 100-point scale
    const normalized = submissions.map((s) => ({
      date: s.submittedAt,
      score: s.score!,
      normalizedScore: (s.score! / (s.maxScore ?? 100)) * 100,
    }));

    // 3. Simple linear regression on normalized scores
    const n = normalized.length;
    const xMean = (n - 1) / 2;
    const yMean = normalized.reduce((sum, s) => sum + s.normalizedScore, 0) / n;

    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (normalized[i].normalizedScore - yMean);
      denominator += (i - xMean) ** 2;
    }
    const slope = denominator !== 0 ? numerator / denominator : 0;

    // Project 4 data points ahead (approx. 4 weeks)
    const projectedScore = Math.max(0, Math.min(100,
      yMean + slope * (n - 1 + 4 - xMean),
    ));

    const currentScore = normalized[normalized.length - 1].normalizedScore;

    // 4. Map to grade using most recent cutoff
    const latestCutoff = await this.prisma.gradeCutoff.findFirst({
      where: { subject: "수학" },
      orderBy: [{ examYear: "desc" }, { examMonth: "desc" }],
    });

    const cutoffs = latestCutoff
      ? [
          { grade: 1, cutoff: latestCutoff.grade1 },
          { grade: 2, cutoff: latestCutoff.grade2 },
          { grade: 3, cutoff: latestCutoff.grade3 },
          { grade: 4, cutoff: latestCutoff.grade4 },
          { grade: 5, cutoff: latestCutoff.grade5 },
          { grade: 6, cutoff: latestCutoff.grade6 },
          { grade: 7, cutoff: latestCutoff.grade7 },
          { grade: 8, cutoff: latestCutoff.grade8 },
          { grade: 9, cutoff: latestCutoff.grade9 },
        ]
      : [];

    const mapToGrade = (score: number) => {
      for (const { grade, cutoff } of cutoffs) {
        if (score >= cutoff) return grade;
      }
      return 9;
    };

    return {
      currentEstimatedGrade: mapToGrade(currentScore),
      currentScore: Math.round(currentScore * 10) / 10,
      trendSlope: Math.round(slope * 100) / 100,
      projectedScore: Math.round(projectedScore * 10) / 10,
      projectedGrade: mapToGrade(projectedScore),
      referenceCutoffs: cutoffs,
      scoreHistory: normalized.map((s) => ({
        date: s.date.toISOString().slice(0, 10),
        score: s.score,
        normalizedScore: Math.round(s.normalizedScore * 10) / 10,
      })),
    };
  }
}
```

**Step 4: Create controller**

```typescript
@Controller("analytics/student")
@UseGuards(JwtAuthGuard, RolesGuard)
export class GradePredictionController {
  constructor(
    private gradePrediction: GradePredictionService,
    private prisma: PrismaService,
  ) {}

  @Get(":studentId/grade-prediction")
  async predict(
    @Param("studentId") studentId: string,
    @Request() req: { user: { id: string; role: string } },
  ) {
    const allowed = await canAccessStudentData(
      this.prisma, req.user.id, req.user.role, studentId,
    );
    if (!allowed) throw new ForbiddenException();
    return this.gradePrediction.predict(studentId);
  }
}
```

**Step 5: Create module and register**

```typescript
@Module({
  controllers: [GradePredictionController],
  providers: [GradePredictionService],
  exports: [GradePredictionService],
})
export class GradePredictionModule {}
```

Add `GradePredictionModule` to `app.module.ts`.

**Verify:** `GET /v1/analytics/student/:id/grade-prediction` returns current estimated grade, trend slope, projected grade, and cutoff reference data.

---

## Task 4: Grade Cut-off & Score Prediction — Frontend

**Files:**
- Create: `apps/web/src/app/(authenticated)/student-analytics/[id]/page.tsx`
- Create: `apps/mobile/app/(student)/grade-prediction.tsx`
- Create: `apps/mobile/app/(parent)/grade-prediction.tsx`

**Step 1: Web student analytics page**

Create `apps/web/src/app/(authenticated)/student-analytics/[id]/page.tsx`:
- Grade prediction card: large grade number (1-9) with color
- Score trend: recharts LineChart with normalized scores over time
- Projected grade with up/down arrow indicator based on `trendSlope`
- Cutoff reference table showing all 9 grade cutoffs
- Student selector for teachers to switch between students

**Step 2: Mobile grade prediction screen (student)**

Create `apps/mobile/app/(student)/grade-prediction.tsx`:
- Large circular grade indicator (colored by grade)
- "현재 추정 등급: N등급" header
- Score trend mini chart (reuse bar pattern)
- Projected score with trend arrow
- Cutoff table rows

**Step 3: Mobile grade prediction screen (parent)**

Create `apps/mobile/app/(parent)/grade-prediction.tsx`:
- Same layout as student version
- API call uses `childId` from navigation params

**Verify:** Student and parent can view estimated Suneung grade and projected trend. Teacher can view any student's prediction from the web dashboard.

---

## Task 5: Gamification — Schema & Core Logic

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`
- Create: `packages/db-schema/prisma/migrations/YYYYMMDD_gamification/migration.sql`
- Create: `apps/lms-api/src/gamification/gamification.module.ts`
- Create: `apps/lms-api/src/gamification/gamification.service.ts`
- Create: `apps/lms-api/src/gamification/gamification.controller.ts`
- Create: `apps/lms-api/src/gamification/badge-definitions.ts`
- Modify: `apps/lms-api/src/app.module.ts`
- Modify: `apps/lms-api/src/submissions/submissions.service.ts`

**Context:** Gamification drives daily engagement. We need streaks (daily practice tracking), badges (milestone achievements), XP points (weighted by difficulty), and class leaderboards.

**Step 1: Add gamification models to Prisma schema**

```prisma
model StudentStreak {
  id              String   @id @default(cuid())
  studentId       String   @unique @map("student_id")
  currentStreak   Int      @default(0) @map("current_streak")
  longestStreak   Int      @default(0) @map("longest_streak")
  lastActivityAt  DateTime? @map("last_activity_at")
  totalXp         Int      @default(0) @map("total_xp")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("student_streaks")
  @@schema("public")
}

model StudentAchievement {
  id          String   @id @default(cuid())
  studentId   String   @map("student_id")
  badgeType   String   @map("badge_type")
  unlockedAt  DateTime @default(now()) @map("unlocked_at")

  @@unique([studentId, badgeType])
  @@index([studentId])
  @@map("student_achievements")
  @@schema("public")
}
```

**Step 2: Define badge types**

Create `apps/lms-api/src/gamification/badge-definitions.ts`:

```typescript
export const BADGE_DEFINITIONS = {
  first_submission: {
    name: "첫 제출",
    description: "첫 번째 과제를 제출했습니다",
    icon: "trophy",
    condition: "submissions >= 1",
  },
  streak_7: {
    name: "7일 연속",
    description: "7일 연속으로 문제를 풀었습니다",
    icon: "flame",
    condition: "currentStreak >= 7",
  },
  streak_30: {
    name: "30일 연속",
    description: "30일 연속으로 문제를 풀었습니다",
    icon: "fire",
    condition: "currentStreak >= 30",
  },
  problems_100: {
    name: "100문제 달성",
    description: "총 100문제를 풀었습니다",
    icon: "star",
    condition: "totalProblems >= 100",
  },
  problems_500: {
    name: "500문제 달성",
    description: "총 500문제를 풀었습니다",
    icon: "medal",
    condition: "totalProblems >= 500",
  },
  perfect_score: {
    name: "만점",
    description: "과제에서 만점을 받았습니다",
    icon: "crown",
    condition: "any submission score === maxScore",
  },
  accuracy_90: {
    name: "정답률 90%",
    description: "전체 정답률 90% 이상을 달성했습니다",
    icon: "target",
    condition: "overallAccuracy >= 90",
  },
} as const;

export type BadgeType = keyof typeof BADGE_DEFINITIONS;
```

**Step 3: Create GamificationService**

```typescript
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { BADGE_DEFINITIONS, BadgeType } from "./badge-definitions";

// XP per correct answer, by difficulty
const XP_BY_DIFFICULTY: Record<number, number> = {
  1: 5, 2: 10, 3: 20, 4: 35, 5: 50, 6: 75,
};

@Injectable()
export class GamificationService {
  constructor(private prisma: PrismaService) {}

  async recordActivity(studentId: string, xpEarned: number) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const streak = await this.prisma.studentStreak.upsert({
      where: { studentId },
      create: {
        studentId,
        currentStreak: 1,
        longestStreak: 1,
        lastActivityAt: now,
        totalXp: xpEarned,
      },
      update: {
        totalXp: { increment: xpEarned },
        lastActivityAt: now,
      },
    });

    // Update streak if last activity was yesterday
    if (streak.lastActivityAt) {
      const lastDate = new Date(streak.lastActivityAt);
      const lastDay = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
      const diffDays = Math.floor((today.getTime() - lastDay.getTime()) / 86400000);

      if (diffDays === 1) {
        // Consecutive day
        const newStreak = streak.currentStreak + 1;
        await this.prisma.studentStreak.update({
          where: { studentId },
          data: {
            currentStreak: newStreak,
            longestStreak: Math.max(newStreak, streak.longestStreak),
          },
        });
      } else if (diffDays > 1) {
        // Streak broken
        await this.prisma.studentStreak.update({
          where: { studentId },
          data: { currentStreak: 1 },
        });
      }
      // diffDays === 0: same day, no streak change
    }

    // Check for new badges
    await this.checkBadges(studentId);
  }

  async checkBadges(studentId: string) {
    const existing = await this.prisma.studentAchievement.findMany({
      where: { studentId },
      select: { badgeType: true },
    });
    const earned = new Set(existing.map((a) => a.badgeType));

    const streak = await this.prisma.studentStreak.findUnique({
      where: { studentId },
    });

    const submissionCount = await this.prisma.submission.count({
      where: { studentId },
    });

    const totalAnswers = await this.prisma.submissionAnswer.count({
      where: { submission: { studentId }, isCorrect: { not: null } },
    });

    const newBadges: BadgeType[] = [];

    if (!earned.has("first_submission") && submissionCount >= 1) {
      newBadges.push("first_submission");
    }
    if (!earned.has("streak_7") && (streak?.currentStreak ?? 0) >= 7) {
      newBadges.push("streak_7");
    }
    if (!earned.has("streak_30") && (streak?.currentStreak ?? 0) >= 30) {
      newBadges.push("streak_30");
    }
    if (!earned.has("problems_100") && totalAnswers >= 100) {
      newBadges.push("problems_100");
    }
    if (!earned.has("problems_500") && totalAnswers >= 500) {
      newBadges.push("problems_500");
    }

    if (newBadges.length > 0) {
      await this.prisma.studentAchievement.createMany({
        data: newBadges.map((badgeType) => ({ studentId, badgeType })),
        skipDuplicates: true,
      });
    }

    return newBadges;
  }

  async getMyStats(studentId: string) {
    const [streak, achievements] = await Promise.all([
      this.prisma.studentStreak.findUnique({ where: { studentId } }),
      this.prisma.studentAchievement.findMany({
        where: { studentId },
        orderBy: { unlockedAt: "desc" },
      }),
    ]);

    return {
      currentStreak: streak?.currentStreak ?? 0,
      longestStreak: streak?.longestStreak ?? 0,
      totalXp: streak?.totalXp ?? 0,
      badges: achievements.map((a) => ({
        type: a.badgeType,
        ...BADGE_DEFINITIONS[a.badgeType as BadgeType],
        unlockedAt: a.unlockedAt,
      })),
      allBadges: Object.entries(BADGE_DEFINITIONS).map(([type, def]) => ({
        type,
        ...def,
        unlocked: achievements.some((a) => a.badgeType === type),
        unlockedAt: achievements.find((a) => a.badgeType === type)?.unlockedAt ?? null,
      })),
    };
  }

  async getLeaderboard(classId: string, period: "weekly" | "monthly" = "weekly") {
    const since = new Date();
    if (period === "weekly") {
      since.setDate(since.getDate() - 7);
    } else {
      since.setDate(since.getDate() - 30);
    }

    // Get students in class
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classId, user: { role: "student" } },
      select: { userId: true, user: { select: { name: true } } },
    });

    const studentIds = enrollments.map((e) => e.userId);
    const nameMap = new Map(enrollments.map((e) => [e.userId, e.user.name]));

    // Get streaks for XP
    const streaks = await this.prisma.studentStreak.findMany({
      where: { studentId: { in: studentIds } },
    });
    const streakMap = new Map(streaks.map((s) => [s.studentId, s]));

    // Count correct answers in period
    const answers = studentIds.length
      ? await this.prisma.submissionAnswer.groupBy({
          by: ["submissionId"],
          where: {
            submission: {
              studentId: { in: studentIds },
              submittedAt: { gte: since },
            },
            isCorrect: true,
          },
          _count: true,
        })
      : [];

    // Map submissionId -> studentId
    const submissionStudentMap = new Map<string, string>();
    if (answers.length > 0) {
      const subs = await this.prisma.submission.findMany({
        where: { id: { in: answers.map((a) => a.submissionId) } },
        select: { id: true, studentId: true },
      });
      subs.forEach((s) => submissionStudentMap.set(s.id, s.studentId));
    }

    // Aggregate per student
    const studentScores = new Map<string, number>();
    for (const ans of answers) {
      const sid = submissionStudentMap.get(ans.submissionId);
      if (sid) {
        studentScores.set(sid, (studentScores.get(sid) ?? 0) + ans._count);
      }
    }

    const leaderboard = studentIds.map((id) => ({
      studentId: id,
      name: nameMap.get(id) ?? "",
      xp: streakMap.get(id)?.totalXp ?? 0,
      correctThisPeriod: studentScores.get(id) ?? 0,
      currentStreak: streakMap.get(id)?.currentStreak ?? 0,
    }));

    leaderboard.sort((a, b) => b.correctThisPeriod - a.correctThisPeriod);

    return leaderboard.map((entry, index) => ({
      rank: index + 1,
      ...entry,
    }));
  }

  calculateXp(difficulty: number | null, isCorrect: boolean): number {
    if (!isCorrect) return 1; // participation XP
    return XP_BY_DIFFICULTY[difficulty ?? 3] ?? 20;
  }
}
```

**Step 4: Integrate with submission flow**

In `apps/lms-api/src/submissions/submissions.service.ts`, after auto-grading or manual grading, call:

```typescript
// After scoring answers:
for (const answer of submission.answers) {
  const problem = problemMap.get(answer.problemId);
  const xp = this.gamification.calculateXp(problem?.difficulty ?? null, answer.isCorrect ?? false);
  totalXp += xp;
}
await this.gamification.recordActivity(studentId, totalXp);
```

Inject `GamificationService` into `SubmissionsService`.

**Step 5: Create controller and module**

```typescript
@Controller("gamification")
@UseGuards(JwtAuthGuard)
export class GamificationController {
  @Get("my")
  async myStats(@Request() req) {
    return this.gamification.getMyStats(req.user.id);
  }

  @Get("leaderboard/:classId")
  async leaderboard(
    @Param("classId") classId: string,
    @Query("period") period: "weekly" | "monthly",
  ) {
    return this.gamification.getLeaderboard(classId, period);
  }
}
```

**Verify:** `GET /v1/gamification/my` returns streak, XP, badges. `GET /v1/gamification/leaderboard/:classId` returns ranked students.

---

## Task 6: Gamification — Frontend

**Files:**
- Create: `apps/mobile/app/(student)/achievements.tsx`
- Modify: `apps/mobile/app/(student)/index.tsx` (add streak counter + XP badge)
- Create: `apps/web/src/app/(authenticated)/leaderboard/page.tsx`

**Step 1: Mobile achievements screen**

Create `apps/mobile/app/(student)/achievements.tsx`:
- Streak counter with flame icon and "N일 연속" text
- XP total with level indicator
- Badge grid: 3-column FlatList of badge cards, unlocked ones glowing, locked ones grayed out
- On badge unlock, show Animated modal with celebration

**Step 2: Add streak counter to student home**

In `apps/mobile/app/(student)/index.tsx`, add a compact streak bar at the top:

```tsx
<View className="flex-row items-center bg-[#2a2a2a] rounded-xl px-4 py-2 mx-4 mb-3">
  <Text className="text-brand-accent text-lg mr-1">🔥</Text>
  <Text className="text-brand-beige font-bold">{streak}일 연속</Text>
  <View className="flex-1" />
  <Text className="text-brand-accent font-bold">{xp} XP</Text>
</View>
```

**Step 3: Web leaderboard page**

Create `apps/web/src/app/(authenticated)/leaderboard/page.tsx`:
- Class selector dropdown
- Period toggle (weekly / monthly)
- Ranked table with name, correct answers, XP, streak
- Top 3 highlighted with gold/silver/bronze badges
- Add "리더보드" to sidebar `mainNav` array in `apps/web/src/components/layout/app-sidebar.tsx`

**Verify:** Student sees streak counter on home, can view full badge collection. Teacher sees class leaderboard on web.

---

## Task 7: Real-time Class Monitoring — Backend

**Files:**
- Create: `apps/lms-api/src/class-monitor/class-monitor.module.ts`
- Create: `apps/lms-api/src/class-monitor/class-monitor.gateway.ts`
- Create: `apps/lms-api/src/class-monitor/class-monitor.service.ts`
- Modify: `apps/lms-api/src/app.module.ts`
- Modify: `apps/lms-api/src/submissions/submissions.service.ts`

**Context:** NestJS does not currently have any WebSocket gateway (no `.gateway.ts` files exist). We use `@nestjs/websockets` with `@nestjs/platform-socket.io` to add a WebSocket endpoint at `/ws/class-monitor`.

**Step 1: Install WebSocket dependencies**

```bash
cd apps/lms-api && pnpm add @nestjs/websockets @nestjs/platform-socket.io socket.io
```

**Step 2: Create ClassMonitorGateway**

Create `apps/lms-api/src/class-monitor/class-monitor.gateway.ts`:

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { JwtService } from "@nestjs/jwt";
import { ClassMonitorService } from "./class-monitor.service";

@WebSocketGateway({
  namespace: "/ws/class-monitor",
  cors: { origin: "*" },
})
export class ClassMonitorGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private monitorService: ClassMonitorService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token
        ?? client.handshake.headers?.authorization?.replace("Bearer ", "");
      const payload = this.jwtService.verify(token);
      client.data.userId = payload.sub;
      client.data.role = payload.role;
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.monitorService.removeStudent(client.data.classId, client.data.userId);
  }

  @SubscribeMessage("join-class")
  async handleJoinClass(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { classId: string },
  ) {
    client.data.classId = data.classId;
    client.join(`class:${data.classId}`);

    if (client.data.role === "student") {
      this.monitorService.addStudent(data.classId, client.data.userId);
      this.broadcastClassState(data.classId);
    }

    // Send current state to teacher on join
    if (client.data.role === "teacher" || client.data.role === "admin") {
      const state = this.monitorService.getClassState(data.classId);
      client.emit("class-state", state);
    }
  }

  @SubscribeMessage("student-progress")
  async handleStudentProgress(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      problemId: string;
      timeSpentSec: number;
      status: "working" | "answered" | "stuck";
    },
  ) {
    if (client.data.role !== "student") return;

    this.monitorService.updateStudentProgress(
      client.data.classId,
      client.data.userId,
      data,
    );

    this.broadcastClassState(client.data.classId);
  }

  @SubscribeMessage("teacher-action")
  async handleTeacherAction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: {
      action: "send-hint" | "pause" | "resume" | "highlight";
      targetStudentId?: string;
      message?: string;
    },
  ) {
    if (client.data.role !== "teacher" && client.data.role !== "admin") return;

    if (data.action === "send-hint" && data.targetStudentId) {
      this.server.to(`class:${client.data.classId}`).emit("teacher-hint", {
        studentId: data.targetStudentId,
        message: data.message,
      });
    }

    if (data.action === "pause" || data.action === "resume") {
      this.server.to(`class:${client.data.classId}`).emit("class-control", {
        action: data.action,
      });
    }
  }

  private broadcastClassState(classId: string) {
    const state = this.monitorService.getClassState(classId);
    this.server.to(`class:${classId}`).emit("class-state", state);
  }

  // Called by SubmissionsService when a student submits
  notifySubmission(classId: string, studentId: string, result: {
    correct: number;
    total: number;
  }) {
    this.monitorService.recordSubmission(classId, studentId, result);
    this.broadcastClassState(classId);
  }
}
```

**Step 3: Create ClassMonitorService (in-memory state)**

Create `apps/lms-api/src/class-monitor/class-monitor.service.ts`:

```typescript
import { Injectable } from "@nestjs/common";

interface StudentProgress {
  studentId: string;
  currentProblemId: string | null;
  timeSpentSec: number;
  status: "idle" | "working" | "answered" | "stuck";
  correctCount: number;
  wrongCount: number;
  lastUpdateAt: Date;
}

interface ClassState {
  classId: string;
  students: StudentProgress[];
  isPaused: boolean;
}

@Injectable()
export class ClassMonitorService {
  private classStates = new Map<string, ClassState>();

  getClassState(classId: string): ClassState {
    return this.classStates.get(classId) ?? {
      classId,
      students: [],
      isPaused: false,
    };
  }

  addStudent(classId: string, studentId: string) {
    const state = this.getOrCreateState(classId);
    if (!state.students.find((s) => s.studentId === studentId)) {
      state.students.push({
        studentId,
        currentProblemId: null,
        timeSpentSec: 0,
        status: "idle",
        correctCount: 0,
        wrongCount: 0,
        lastUpdateAt: new Date(),
      });
    }
  }

  removeStudent(classId: string, studentId: string) {
    const state = this.classStates.get(classId);
    if (state) {
      state.students = state.students.filter((s) => s.studentId !== studentId);
      if (state.students.length === 0) {
        this.classStates.delete(classId);
      }
    }
  }

  updateStudentProgress(
    classId: string,
    studentId: string,
    data: { problemId: string; timeSpentSec: number; status: string },
  ) {
    const state = this.getOrCreateState(classId);
    const student = state.students.find((s) => s.studentId === studentId);
    if (student) {
      student.currentProblemId = data.problemId;
      student.timeSpentSec = data.timeSpentSec;
      student.status = data.status as StudentProgress["status"];
      student.lastUpdateAt = new Date();
    }
  }

  recordSubmission(classId: string, studentId: string, result: {
    correct: number;
    total: number;
  }) {
    const state = this.classStates.get(classId);
    if (!state) return;
    const student = state.students.find((s) => s.studentId === studentId);
    if (student) {
      student.correctCount += result.correct;
      student.wrongCount += result.total - result.correct;
      student.status = "answered";
    }
  }

  private getOrCreateState(classId: string): ClassState {
    let state = this.classStates.get(classId);
    if (!state) {
      state = { classId, students: [], isPaused: false };
      this.classStates.set(classId, state);
    }
    return state;
  }
}
```

**Step 4: Create module**

```typescript
import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ClassMonitorGateway } from "./class-monitor.gateway";
import { ClassMonitorService } from "./class-monitor.service";

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow("JWT_SECRET"),
      }),
    }),
  ],
  providers: [ClassMonitorGateway, ClassMonitorService],
  exports: [ClassMonitorGateway, ClassMonitorService],
})
export class ClassMonitorModule {}
```

Add `ClassMonitorModule` to `app.module.ts`.

**Verify:** WebSocket connection to `/ws/class-monitor` authenticates via JWT. Teachers receive real-time `class-state` updates as students progress.

---

## Task 8: Real-time Class Monitoring — Frontend

**Files:**
- Create: `apps/web/src/app/(authenticated)/class-monitor/[classId]/page.tsx`
- Create: `apps/web/src/hooks/useClassMonitor.ts`
- Modify: `apps/web/src/components/layout/app-sidebar.tsx`

**Step 1: Create useClassMonitor hook**

Create `apps/web/src/hooks/useClassMonitor.ts`:

```typescript
import { useEffect, useState, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:3001";

interface StudentProgress {
  studentId: string;
  currentProblemId: string | null;
  timeSpentSec: number;
  status: "idle" | "working" | "answered" | "stuck";
  correctCount: number;
  wrongCount: number;
}

interface ClassState {
  classId: string;
  students: StudentProgress[];
  isPaused: boolean;
}

export function useClassMonitor(classId: string) {
  const [state, setState] = useState<ClassState | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const socket = io(`${WS_URL}/ws/class-monitor`, {
      auth: { token },
    });

    socket.on("connect", () => {
      socket.emit("join-class", { classId });
    });

    socket.on("class-state", (data: ClassState) => {
      setState(data);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [classId]);

  const sendHint = useCallback((studentId: string, message: string) => {
    socketRef.current?.emit("teacher-action", {
      action: "send-hint",
      targetStudentId: studentId,
      message,
    });
  }, []);

  const pauseClass = useCallback(() => {
    socketRef.current?.emit("teacher-action", { action: "pause" });
  }, []);

  const resumeClass = useCallback(() => {
    socketRef.current?.emit("teacher-action", { action: "resume" });
  }, []);

  return { state, sendHint, pauseClass, resumeClass };
}
```

**Step 2: Create class monitor dashboard page**

Create `apps/web/src/app/(authenticated)/class-monitor/[classId]/page.tsx`:
- Grid of student cards (4 columns on desktop, 2 on tablet)
- Each card shows: student name, current problem number, time spent, status badge
- Status colors: idle=gray, working=blue, answered=green, stuck=red (pulsing)
- "Stuck" students highlighted at top with "Send Hint" button
- Top bar: class name, student count, pause/resume button
- Click student card to expand: show correct/wrong count, send custom hint

**Step 3: Add to sidebar**

In `apps/web/src/components/layout/app-sidebar.tsx`, add to `mainNav`:

```typescript
{ title: "수업 모니터링", href: "/class-monitor", icon: Monitor },
```

Import `Monitor` from lucide-react.

**Step 4: Install socket.io-client**

```bash
cd apps/web && pnpm add socket.io-client
```

**Verify:** Teacher navigates to class monitor page, sees real-time student progress grid. Can send hints and pause/resume.

---

## Task 9: Hagwon Operations — Attendance Schema & API

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`
- Create: `packages/db-schema/prisma/migrations/YYYYMMDD_operations/migration.sql`
- Create: `apps/lms-api/src/operations/operations.module.ts`
- Create: `apps/lms-api/src/operations/attendance.service.ts`
- Create: `apps/lms-api/src/operations/attendance.controller.ts`
- Modify: `apps/lms-api/src/app.module.ts`

**Step 1: Add Attendance and BillingRecord models**

```prisma
model Attendance {
  id         String           @id @default(cuid())
  studentId  String           @map("student_id")
  classId    String           @map("class_id")
  lessonId   String?          @map("lesson_id")
  date       DateTime         @db.Date
  status     AttendanceStatus @default(present)
  note       String?
  recordedBy String?          @map("recorded_by")
  createdAt  DateTime         @default(now()) @map("created_at")
  updatedAt  DateTime         @updatedAt @map("updated_at")

  @@unique([studentId, classId, date])
  @@index([classId, date])
  @@index([studentId])
  @@map("attendances")
  @@schema("public")
}

enum AttendanceStatus {
  present
  absent
  late
  excused

  @@schema("public")
}

model BillingRecord {
  id          String        @id @default(cuid())
  studentId   String        @map("student_id")
  classId     String?       @map("class_id")
  amount      Int                                // in KRW
  description String?
  dueDate     DateTime      @map("due_date") @db.Date
  status      BillingStatus @default(pending)
  paidAt      DateTime?     @map("paid_at")
  invoiceNote String?       @map("invoice_note")
  createdAt   DateTime      @default(now()) @map("created_at")
  updatedAt   DateTime      @updatedAt @map("updated_at")

  @@index([studentId, status])
  @@index([dueDate])
  @@map("billing_records")
  @@schema("public")
}

enum BillingStatus {
  pending
  paid
  overdue
  cancelled

  @@schema("public")
}
```

**Step 2: Create AttendanceService**

Create `apps/lms-api/src/operations/attendance.service.ts`:

```typescript
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async record(dto: {
    studentId: string;
    classId: string;
    lessonId?: string;
    date: string;
    status: "present" | "absent" | "late" | "excused";
    note?: string;
    recordedBy: string;
  }) {
    const attendance = await this.prisma.attendance.upsert({
      where: {
        studentId_classId_date: {
          studentId: dto.studentId,
          classId: dto.classId,
          date: new Date(dto.date),
        },
      },
      create: {
        studentId: dto.studentId,
        classId: dto.classId,
        lessonId: dto.lessonId,
        date: new Date(dto.date),
        status: dto.status,
        note: dto.note,
        recordedBy: dto.recordedBy,
      },
      update: {
        status: dto.status,
        note: dto.note,
        recordedBy: dto.recordedBy,
      },
    });

    // Notify parent on absence or late
    if (dto.status === "absent" || dto.status === "late") {
      const student = await this.prisma.user.findUnique({
        where: { id: dto.studentId },
        select: { name: true },
      });
      const cls = await this.prisma.class.findUnique({
        where: { id: dto.classId },
        select: { title: true },
      });

      const statusText = dto.status === "absent" ? "결석" : "지각";
      await this.notifications.notifyParents(
        dto.studentId,
        "attendance_alert",
        `${student?.name ?? "학생"} ${statusText} 알림`,
        `${cls?.title ?? "수업"}에 ${statusText}하였습니다. (${dto.date})`,
        { type: "attendance", id: attendance.id },
      );
    }

    return attendance;
  }

  async recordBulk(classId: string, date: string, records: {
    studentId: string;
    status: "present" | "absent" | "late" | "excused";
    note?: string;
  }[], recordedBy: string) {
    const results = [];
    for (const record of records) {
      const result = await this.record({
        ...record,
        classId,
        date,
        recordedBy,
      });
      results.push(result);
    }
    return results;
  }

  async getByClass(classId: string, date?: string, month?: string) {
    const where: any = { classId };

    if (date) {
      where.date = new Date(date);
    } else if (month) {
      // month format: "2026-03"
      const start = new Date(`${month}-01`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      where.date = { gte: start, lt: end };
    }

    return this.prisma.attendance.findMany({
      where,
      orderBy: [{ date: "desc" }, { studentId: "asc" }],
    });
  }

  async getByStudent(studentId: string, classId?: string) {
    return this.prisma.attendance.findMany({
      where: {
        studentId,
        ...(classId ? { classId } : {}),
      },
      orderBy: { date: "desc" },
      take: 90,
    });
  }

  async getClassAttendanceRate(classId: string, month?: string) {
    const where: any = { classId };
    if (month) {
      const start = new Date(`${month}-01`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      where.date = { gte: start, lt: end };
    }

    const records = await this.prisma.attendance.findMany({ where });
    const total = records.length;
    if (total === 0) return { total: 0, present: 0, absent: 0, late: 0, rate: 0 };

    const present = records.filter((r) => r.status === "present").length;
    const absent = records.filter((r) => r.status === "absent").length;
    const late = records.filter((r) => r.status === "late").length;

    return {
      total,
      present,
      absent,
      late,
      rate: Math.round((present / total) * 100),
    };
  }
}
```

**Step 3: Create controller**

```typescript
@Controller("operations/attendance")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "teacher")
export class AttendanceController {
  constructor(private attendance: AttendanceService) {}

  @Post("record")
  record(@Body() dto, @Request() req) {
    return this.attendance.record({ ...dto, recordedBy: req.user.id });
  }

  @Post("bulk/:classId")
  recordBulk(
    @Param("classId") classId: string,
    @Body() dto: { date: string; records: any[] },
    @Request() req,
  ) {
    return this.attendance.recordBulk(classId, dto.date, dto.records, req.user.id);
  }

  @Get("class/:classId")
  getByClass(
    @Param("classId") classId: string,
    @Query("date") date?: string,
    @Query("month") month?: string,
  ) {
    return this.attendance.getByClass(classId, date, month);
  }

  @Get("student/:studentId")
  getByStudent(
    @Param("studentId") studentId: string,
    @Query("classId") classId?: string,
  ) {
    return this.attendance.getByStudent(studentId, classId);
  }

  @Get("rate/:classId")
  getRate(
    @Param("classId") classId: string,
    @Query("month") month?: string,
  ) {
    return this.attendance.getClassAttendanceRate(classId, month);
  }
}
```

**Verify:** `POST /v1/operations/attendance/record` creates attendance and notifies parent on absence. `GET /v1/operations/attendance/rate/:classId` returns attendance statistics.

---

## Task 10: Hagwon Operations — Billing API

**Files:**
- Create: `apps/lms-api/src/operations/billing.service.ts`
- Create: `apps/lms-api/src/operations/billing.controller.ts`
- Modify: `apps/lms-api/src/operations/operations.module.ts`

**Step 1: Create BillingService**

Create `apps/lms-api/src/operations/billing.service.ts`:

```typescript
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class BillingService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async create(dto: {
    studentId: string;
    classId?: string;
    amount: number;
    description?: string;
    dueDate: string;
    invoiceNote?: string;
  }) {
    return this.prisma.billingRecord.create({
      data: {
        studentId: dto.studentId,
        classId: dto.classId,
        amount: dto.amount,
        description: dto.description,
        dueDate: new Date(dto.dueDate),
        invoiceNote: dto.invoiceNote,
      },
    });
  }

  async generateMonthlyInvoices(classId: string, month: string, amount: number, description: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classId, user: { role: "student" } },
      select: { userId: true },
    });

    const dueDate = new Date(`${month}-28`); // Due on 28th

    const records = [];
    for (const enrollment of enrollments) {
      const record = await this.prisma.billingRecord.create({
        data: {
          studentId: enrollment.userId,
          classId,
          amount,
          description: `${month} ${description}`,
          dueDate,
        },
      });
      records.push(record);

      // Notify parent
      await this.notifications.notifyParents(
        enrollment.userId,
        "billing_invoice",
        "수강료 청구서",
        `${description} ${amount.toLocaleString()}원 - 납부 기한: ${month}-28`,
        { type: "billing", id: record.id },
      );
    }

    return records;
  }

  async markPaid(id: string) {
    const record = await this.prisma.billingRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException("Billing record not found");

    return this.prisma.billingRecord.update({
      where: { id },
      data: { status: "paid", paidAt: new Date() },
    });
  }

  async markOverdue() {
    // Called by cron: mark pending records past due date as overdue
    const now = new Date();
    const updated = await this.prisma.billingRecord.updateMany({
      where: {
        status: "pending",
        dueDate: { lt: now },
      },
      data: { status: "overdue" },
    });
    return updated;
  }

  async getByStudent(studentId: string, status?: string) {
    return this.prisma.billingRecord.findMany({
      where: {
        studentId,
        ...(status ? { status: status as any } : {}),
      },
      orderBy: { dueDate: "desc" },
    });
  }

  async getByClass(classId: string, status?: string) {
    return this.prisma.billingRecord.findMany({
      where: {
        classId,
        ...(status ? { status: status as any } : {}),
      },
      orderBy: { dueDate: "desc" },
    });
  }

  async getClassBillingSummary(classId: string) {
    const records = await this.prisma.billingRecord.findMany({
      where: { classId },
    });

    const total = records.reduce((sum, r) => sum + r.amount, 0);
    const paid = records.filter((r) => r.status === "paid").reduce((sum, r) => sum + r.amount, 0);
    const pending = records.filter((r) => r.status === "pending").reduce((sum, r) => sum + r.amount, 0);
    const overdue = records.filter((r) => r.status === "overdue").reduce((sum, r) => sum + r.amount, 0);

    return { total, paid, pending, overdue, recordCount: records.length };
  }
}
```

**Step 2: Create controller**

```typescript
@Controller("operations/billing")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "teacher")
export class BillingController {
  constructor(private billing: BillingService) {}

  @Post()
  create(@Body() dto) { return this.billing.create(dto); }

  @Post("generate/:classId")
  generateInvoices(
    @Param("classId") classId: string,
    @Body() dto: { month: string; amount: number; description: string },
  ) {
    return this.billing.generateMonthlyInvoices(classId, dto.month, dto.amount, dto.description);
  }

  @Patch(":id/pay")
  markPaid(@Param("id") id: string) { return this.billing.markPaid(id); }

  @Get("student/:studentId")
  getByStudent(@Param("studentId") studentId: string, @Query("status") status?: string) {
    return this.billing.getByStudent(studentId, status);
  }

  @Get("class/:classId")
  getByClass(@Param("classId") classId: string, @Query("status") status?: string) {
    return this.billing.getByClass(classId, status);
  }

  @Get("summary/:classId")
  getSummary(@Param("classId") classId: string) {
    return this.billing.getClassBillingSummary(classId);
  }
}
```

**Step 3: Create OperationsModule**

```typescript
@Module({
  imports: [NotificationsModule],
  controllers: [AttendanceController, BillingController],
  providers: [AttendanceService, BillingService],
  exports: [AttendanceService, BillingService],
})
export class OperationsModule {}
```

Add `OperationsModule` to `app.module.ts`.

**Verify:** `POST /v1/operations/billing/generate/:classId` creates invoices for all students and notifies parents. `GET /v1/operations/billing/summary/:classId` returns aggregated billing stats.

---

## Task 11: Hagwon Operations — Frontend Dashboard

**Files:**
- Create: `apps/web/src/app/(authenticated)/operations/page.tsx`
- Create: `apps/web/src/app/(authenticated)/operations/attendance/page.tsx`
- Create: `apps/web/src/app/(authenticated)/operations/billing/page.tsx`
- Modify: `apps/web/src/components/layout/app-sidebar.tsx`

**Step 1: Create operations dashboard page**

Create `apps/web/src/app/(authenticated)/operations/page.tsx`:
- Class selector
- Three-panel overview:
  - Attendance panel: rate donut chart, today's absent/late count
  - Billing panel: total/paid/pending/overdue amounts, bar chart
  - Student progress panel: avg score, completion rate (reuse analytics data)
- Quick actions: "출석 체크", "청구서 발행"

**Step 2: Create attendance management page**

Create `apps/web/src/app/(authenticated)/operations/attendance/page.tsx`:
- Date picker (defaults to today)
- Class selector
- Student list with status toggles (present/absent/late/excused)
- Bulk save button
- Monthly calendar view with attendance dots per student

**Step 3: Create billing management page**

Create `apps/web/src/app/(authenticated)/operations/billing/page.tsx`:
- Class selector
- "Generate Monthly Invoices" form (month, amount, description)
- Table of billing records: student name, amount, due date, status badge, "Mark Paid" action
- Filter by status (pending/paid/overdue)

**Step 4: Add to sidebar**

In `apps/web/src/components/layout/app-sidebar.tsx`, add a new sidebar group:

```typescript
const opsNav = [
  { title: "운영 현황", href: "/operations", icon: Building },
  { title: "출석 관리", href: "/operations/attendance", icon: UserCheck },
  { title: "수강료 관리", href: "/operations/billing", icon: CreditCard },
];
```

Import `Building`, `UserCheck`, `CreditCard` from lucide-react.

**Verify:** Teacher can take attendance via the web UI and manage billing records. Parent receives push notification on absence or invoice.

---

## Task 12: LTI/QTI Standard Integration — QTI Export/Import

**Files:**
- Create: `apps/lms-api/src/integrations/integrations.module.ts`
- Create: `apps/lms-api/src/integrations/qti/qti-export.service.ts`
- Create: `apps/lms-api/src/integrations/qti/qti-import.service.ts`
- Create: `apps/lms-api/src/integrations/qti/qti.controller.ts`
- Modify: `apps/lms-api/src/app.module.ts`

**Context:** QTI 2.1 (Question and Test Interoperability) is the IMS Global standard for assessment item interchange. We support multiple_choice and short_answer problem types which map directly to QTI `choiceInteraction` and `textEntryInteraction`.

**Step 1: Install XML builder/parser**

```bash
cd apps/lms-api && pnpm add fast-xml-parser
```

**Step 2: Create QTI export service**

Create `apps/lms-api/src/integrations/qti/qti-export.service.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { XMLBuilder } from "fast-xml-parser";

@Injectable()
export class QtiExportService {
  constructor(private prisma: PrismaService) {}

  async exportProblems(problemIds: string[]): Promise<string> {
    const problems = await this.prisma.problem.findMany({
      where: { id: { in: problemIds } },
      include: { choices: { orderBy: { position: "asc" } } },
    });

    const items = problems.map((p) => this.problemToQtiItem(p));

    const assessment = {
      "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
      assessmentTest: {
        "@_xmlns": "http://www.imsglobal.org/xsd/imsqti_v2p1",
        "@_identifier": `jsmath-export-${Date.now()}`,
        "@_title": "JSMath Export",
        testPart: {
          "@_identifier": "part-1",
          "@_navigationMode": "linear",
          "@_submissionMode": "individual",
          assessmentSection: {
            "@_identifier": "section-1",
            "@_title": "Problems",
            "@_visible": "true",
            assessmentItemRef: items.map((item, i) => ({
              "@_identifier": `item-ref-${i + 1}`,
              "@_href": `item-${i + 1}.xml`,
            })),
          },
        },
      },
    };

    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      attributeNamePrefix: "@_",
    });

    // Return as zip manifest + items in a structured object
    const result = {
      manifest: builder.build(assessment),
      items: items.map((xml, i) => ({
        filename: `item-${i + 1}.xml`,
        content: xml,
      })),
    };

    return JSON.stringify(result);
  }

  private problemToQtiItem(problem: any): string {
    const builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      attributeNamePrefix: "@_",
    });

    if (problem.problemType === "multiple_choice" && problem.choices.length > 0) {
      const correctChoice = problem.choices.find((c: any) => c.isCorrect);

      const item = {
        assessmentItem: {
          "@_xmlns": "http://www.imsglobal.org/xsd/imsqti_v2p1",
          "@_identifier": problem.id,
          "@_title": problem.displayNumber ?? problem.problemNumber ?? problem.id,
          "@_adaptive": "false",
          "@_timeDependent": "false",
          responseDeclaration: {
            "@_identifier": "RESPONSE",
            "@_cardinality": "single",
            "@_baseType": "identifier",
            correctResponse: correctChoice
              ? { value: `choice-${correctChoice.position}` }
              : undefined,
          },
          itemBody: {
            choiceInteraction: {
              "@_responseIdentifier": "RESPONSE",
              "@_shuffle": "false",
              "@_maxChoices": "1",
              prompt: { "#text": problem.stemText },
              simpleChoice: problem.choices.map((c: any) => ({
                "@_identifier": `choice-${c.position}`,
                "#text": c.contentText,
              })),
            },
          },
        },
      };

      return builder.build(item);
    }

    if (problem.problemType === "short_answer") {
      const item = {
        assessmentItem: {
          "@_xmlns": "http://www.imsglobal.org/xsd/imsqti_v2p1",
          "@_identifier": problem.id,
          "@_title": problem.displayNumber ?? problem.id,
          "@_adaptive": "false",
          "@_timeDependent": "false",
          responseDeclaration: {
            "@_identifier": "RESPONSE",
            "@_cardinality": "single",
            "@_baseType": "string",
            correctResponse: problem.answerText
              ? { value: problem.answerText }
              : undefined,
          },
          itemBody: {
            textEntryInteraction: {
              "@_responseIdentifier": "RESPONSE",
              prompt: { "#text": problem.stemText },
            },
          },
        },
      };

      return builder.build(item);
    }

    // Fallback: written_solution / essay as extended text
    const item = {
      assessmentItem: {
        "@_xmlns": "http://www.imsglobal.org/xsd/imsqti_v2p1",
        "@_identifier": problem.id,
        "@_title": problem.displayNumber ?? problem.id,
        itemBody: {
          extendedTextInteraction: {
            "@_responseIdentifier": "RESPONSE",
            prompt: { "#text": problem.stemText },
          },
        },
      },
    };

    return builder.build(item);
  }
}
```

**Step 3: Create QTI import service**

Create `apps/lms-api/src/integrations/qti/qti-import.service.ts`:

```typescript
import { Injectable, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { XMLParser } from "fast-xml-parser";

@Injectable()
export class QtiImportService {
  constructor(private prisma: PrismaService) {}

  async importQtiXml(xml: string, ocrJobId: string) {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });

    const parsed = parser.parse(xml);
    const assessmentItem = parsed.assessmentItem;
    if (!assessmentItem) {
      throw new BadRequestException("Invalid QTI XML: missing assessmentItem");
    }

    const itemBody = assessmentItem.itemBody;
    if (!itemBody) {
      throw new BadRequestException("Invalid QTI XML: missing itemBody");
    }

    // Determine problem type
    let problemType: string;
    let stemText: string;
    let choices: any[] = [];
    let answerText: string | null = null;

    if (itemBody.choiceInteraction) {
      problemType = "multiple_choice";
      stemText = itemBody.choiceInteraction.prompt?.["#text"] ?? "";
      const simpleChoices = Array.isArray(itemBody.choiceInteraction.simpleChoice)
        ? itemBody.choiceInteraction.simpleChoice
        : [itemBody.choiceInteraction.simpleChoice];

      const correctResponse = assessmentItem.responseDeclaration?.correctResponse?.value;
      choices = simpleChoices.map((c: any, i: number) => ({
        position: i + 1,
        label: String(i + 1),
        contentText: c["#text"] ?? "",
        contentLatex: c["#text"] ?? "",
        isCorrect: c["@_identifier"] === correctResponse,
      }));

      const correct = choices.find((c) => c.isCorrect);
      if (correct) answerText = correct.label;
    } else if (itemBody.textEntryInteraction) {
      problemType = "short_answer";
      stemText = itemBody.textEntryInteraction.prompt?.["#text"] ?? "";
      answerText = assessmentItem.responseDeclaration?.correctResponse?.value ?? null;
    } else {
      problemType = "written_solution";
      stemText = itemBody.extendedTextInteraction?.prompt?.["#text"] ?? "";
    }

    const problem = await this.prisma.problem.create({
      data: {
        ocrJobId,
        startPage: 0,
        endPage: 0,
        stemLatex: stemText,
        stemText,
        problemType: problemType as any,
        answerText,
        reviewStatus: "pending_review",
        choices: choices.length > 0
          ? { create: choices }
          : undefined,
      },
      include: { choices: true },
    });

    return problem;
  }
}
```

**Step 4: Create controller**

```typescript
@Controller("integrations/qti")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "teacher")
export class QtiController {
  constructor(
    private qtiExport: QtiExportService,
    private qtiImport: QtiImportService,
  ) {}

  @Post("export")
  async export(@Body() dto: { problemIds: string[] }) {
    return this.qtiExport.exportProblems(dto.problemIds);
  }

  @Post("import")
  async import(@Body() dto: { xml: string; ocrJobId: string }) {
    return this.qtiImport.importQtiXml(dto.xml, dto.ocrJobId);
  }
}
```

**Verify:** `POST /v1/integrations/qti/export` with problem IDs returns QTI 2.1 XML. `POST /v1/integrations/qti/import` with QTI XML creates Problem records.

---

## Task 13: LTI 1.3 Provider

**Files:**
- Create: `apps/lms-api/src/integrations/lti/lti.service.ts`
- Create: `apps/lms-api/src/integrations/lti/lti.controller.ts`
- Create: `apps/lms-api/src/integrations/lti/lti-platform.model.ts`
- Modify: `packages/db-schema/prisma/schema.prisma`
- Modify: `apps/lms-api/src/integrations/integrations.module.ts`

**Context:** LTI 1.3 allows external LMS platforms (Canvas, Moodle) to launch JSMath content and receive grades back. JSMath acts as a Tool Provider. The flow: Platform registers with JSMath, user clicks link in external LMS, redirect to JSMath login endpoint, JSMath validates JWT from platform, redirects to content, grades pass back via Assignment and Grade Service (AGS).

**Step 1: Add LtiPlatform model**

```prisma
model LtiPlatform {
  id             String   @id @default(cuid())
  name           String
  issuer         String   @unique
  clientId       String   @map("client_id")
  authUrl        String   @map("auth_url")
  tokenUrl       String   @map("token_url")
  jwksUrl        String   @map("jwks_url")
  deploymentId   String?  @map("deployment_id")
  createdAt      DateTime @default(now()) @map("created_at")

  @@map("lti_platforms")
  @@schema("public")
}
```

**Step 2: Install dependencies**

```bash
cd apps/lms-api && pnpm add jose
```

**Step 3: Create LTI service**

Create `apps/lms-api/src/integrations/lti/lti.service.ts`:

Core methods:
- `initLogin(iss, loginHint, targetLinkUri)` — OIDC login initiation, generates nonce + state, redirects to platform auth URL
- `handleLaunch(idToken)` — Validates the JWT from platform using JWKS, extracts claims (user, resource link, roles), creates/finds user, returns session
- `sendGrade(platformId, lineItemUrl, userId, score, maxScore)` — AGS grade passback via service-to-service JWT

The service uses `jose` for JWT creation/verification and the platform's JWKS endpoint for key resolution.

**Step 4: Create LTI controller**

```typescript
@Controller("integrations/lti")
export class LtiController {
  @Get("login")
  async login(@Query() query) {
    // OIDC third-party initiated login
    return this.ltiService.initLogin(query.iss, query.login_hint, query.target_link_uri);
  }

  @Post("launch")
  async launch(@Body() body) {
    // Receives id_token from platform after OIDC auth
    return this.ltiService.handleLaunch(body.id_token);
  }

  @Post("deep-linking")
  async deepLinking(@Body() body) {
    // Returns content items (assignments/problems) that platform can embed
    return this.ltiService.handleDeepLinking(body);
  }
}
```

**Step 5: Register in IntegrationsModule**

```typescript
@Module({
  controllers: [QtiController, LtiController],
  providers: [QtiExportService, QtiImportService, LtiService],
  exports: [QtiExportService],
})
export class IntegrationsModule {}
```

Add `IntegrationsModule` to `app.module.ts`.

**Verify:** External LMS can register as a platform. LTI launch flow redirects to JSMath content. Grades pass back to external LMS.

---

## Task 14: Shared Types & Mobile Integration

**Files:**
- Modify: `packages/shared-types/src/index.ts`
- Modify: `apps/mobile/lib/api.ts`
- Modify: `apps/mobile/app/(parent)/_layout.tsx`

**Step 1: Add shared types for new features**

Add to `packages/shared-types/src/index.ts`:

```typescript
// ─── Phase 4 Types ───

export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export type BillingStatus = "pending" | "paid" | "overdue" | "cancelled";
export type BadgeType =
  | "first_submission" | "streak_7" | "streak_30"
  | "problems_100" | "problems_500" | "perfect_score" | "accuracy_90";

export interface ParentWeeklyReport {
  id: string;
  parentId: string;
  studentId: string;
  weekStart: string;
  weekEnd: string;
  assignmentCompletionRate: number;
  avgScore: number | null;
  problemsSolved: number;
  correctRate: number | null;
  lessonsAttended: number;
  lessonsTotal: number;
  weaknessHeatmap: { unit: string; accuracy: number; color: "red" | "yellow" | "green" }[] | null;
  scoreTrend: { date: string; score: number }[] | null;
}

export interface GradePrediction {
  currentEstimatedGrade: number;
  currentScore: number;
  trendSlope: number;
  projectedScore: number;
  projectedGrade: number;
  referenceCutoffs: { grade: number; cutoff: number }[];
  scoreHistory: { date: string; score: number; normalizedScore: number }[];
}

export interface GamificationStats {
  currentStreak: number;
  longestStreak: number;
  totalXp: number;
  badges: {
    type: BadgeType;
    name: string;
    description: string;
    icon: string;
    unlockedAt: string;
  }[];
  allBadges: {
    type: BadgeType;
    name: string;
    description: string;
    icon: string;
    unlocked: boolean;
    unlockedAt: string | null;
  }[];
}

export interface LeaderboardEntry {
  rank: number;
  studentId: string;
  name: string;
  xp: number;
  correctThisPeriod: number;
  currentStreak: number;
}

export interface Attendance {
  id: string;
  studentId: string;
  classId: string;
  date: string;
  status: AttendanceStatus;
  note: string | null;
}

export interface BillingRecord {
  id: string;
  studentId: string;
  classId: string | null;
  amount: number;
  description: string | null;
  dueDate: string;
  status: BillingStatus;
  paidAt: string | null;
}
```

**Step 2: Add parent dashboard tab to mobile layout**

In `apps/mobile/app/(parent)/_layout.tsx`, add new tab for "리포트" pointing to `/(parent)/dashboard`.

**Verify:** All new API response types are available in both web and mobile via shared-types package.

---

## Execution Order & Dependency Graph

```
                    ┌─────────────────────────────────┐
                    │  Task 1: Parent Weekly Report    │
                    │  (Schema + API)                  │
                    └────────────┬────────────────────┘
                                 │
                    ┌────────────▼────────────────────┐
                    │  Task 2: Parent Dashboard UI     │
                    │  (Mobile + Web)                  │
                    └─────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │  Task 3: Grade Cutoff Schema +   │
                    │  Prediction API                  │
                    └────────────┬────────────────────┘
                                 │
                    ┌────────────▼────────────────────┐
                    │  Task 4: Grade Prediction UI     │
                    └─────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │  Task 5: Gamification Schema +   │
                    │  Core Logic                      │
                    └────────────┬────────────────────┘
                                 │
                    ┌────────────▼────────────────────┐
                    │  Task 6: Gamification UI         │
                    └─────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │  Task 7: Class Monitor Backend   │
                    │  (WebSocket Gateway)             │
                    └────────────┬────────────────────┘
                                 │
                    ┌────────────▼────────────────────┐
                    │  Task 8: Class Monitor UI        │
                    └─────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │  Task 9: Attendance Schema + API │
                    └────────────┬────────────────────┘
                                 │
                    ┌────────────▼────────────────────┐
                    │  Task 10: Billing API            │
                    └────────────┬────────────────────┘
                                 │
                    ┌────────────▼────────────────────┐
                    │  Task 11: Operations Dashboard   │
                    └─────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │  Task 12: QTI Export/Import      │
                    └────────────┬────────────────────┘
                                 │
                    ┌────────────▼────────────────────┐
                    │  Task 13: LTI 1.3 Provider      │
                    └─────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │  Task 14: Shared Types + Mobile  │
                    │  (can run anytime, best first)   │
                    └─────────────────────────────────┘
```

**Recommended execution order:**

1. **Task 14** (Shared Types) — no dependencies, unlocks type safety for all other tasks
2. **Tasks 1, 3, 5, 9** (Schema tasks) — independent, can run in parallel; single migration recommended
3. **Task 10** (Billing) — depends on Task 9 schema
4. **Tasks 2, 4, 6, 7, 11, 12** — backend + frontend for each feature, can run in parallel
5. **Task 8** (Class Monitor UI) — depends on Task 7
6. **Task 13** (LTI) — depends on Task 12 module existing

**Total new files:** ~30
**Modified files:** ~12
**New Prisma models:** 6 (`ParentWeeklyReport`, `GradeCutoff`, `StudentStreak`, `StudentAchievement`, `Attendance`, `BillingRecord`, `LtiPlatform`)
**New NestJS modules:** 5 (`ParentAnalyticsModule`, `GradePredictionModule`, `GamificationModule`, `ClassMonitorModule`, `OperationsModule`, `IntegrationsModule`)
**Estimated migration count:** 3 (group related models per migration)
