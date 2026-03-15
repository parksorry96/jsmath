# Phase 3: AI Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add six AI-powered features (adaptive diagnostics, knowledge graph analysis, Socratic tutor, SmartScore grading, variant generation, partial credit rubric) that transform JSMath from a problem bank into a personalized learning platform.
**Architecture:** All six features follow the existing schema boundary: NestJS (`apps/lms-api`) owns `public.*` tables and orchestrates student-facing APIs; FastAPI (`apps/ocr-api`) owns `ocr.*` tables and runs GPU/AI-heavy workloads. Cross-boundary communication uses Redis Pub/Sub channels. New AI calls use OpenAI GPT-4 structured output (existing pattern in `unified_analysis.py`) and Anthropic Claude for vision tasks (existing pattern in `analyze_photo.py`). SSE streaming reuses the existing `apps/web/src/lib/sse.ts` fetch-based SSE client.
**Tech Stack:** NestJS, FastAPI + Celery, Prisma + SQLAlchemy, PostgreSQL 16 + pgvector, Redis (BullMQ + Celery), OpenAI GPT-4 (structured output), Anthropic Claude, Next.js 15, React Native (Expo)

---

## Task 1: Adaptive Diagnostic Assessment (3-1)

**Files:**
- Create: `packages/db-schema/prisma/migrations/YYYYMMDD_diagnostic_tables/migration.sql`
- Modify: `packages/db-schema/prisma/schema.prisma`
- Create: `apps/lms-api/src/diagnostics/diagnostics.module.ts`
- Create: `apps/lms-api/src/diagnostics/diagnostics.controller.ts`
- Create: `apps/lms-api/src/diagnostics/diagnostics.service.ts`
- Create: `apps/lms-api/src/diagnostics/dto/start-diagnostic.dto.ts`
- Create: `apps/lms-api/src/diagnostics/dto/answer-diagnostic.dto.ts`
- Create: `apps/lms-api/src/diagnostics/irt-engine.ts`
- Modify: `apps/lms-api/src/app.module.ts`
- Create: `apps/web/src/app/(authenticated)/diagnostics/page.tsx`
- Create: `apps/web/src/app/(authenticated)/diagnostics/[id]/page.tsx`
- Create: `apps/web/src/app/(authenticated)/diagnostics/[id]/result/page.tsx`
- Create: `apps/web/src/components/diagnostics/question-card.tsx`
- Create: `apps/web/src/components/diagnostics/ability-radar-chart.tsx`

**Step 1: Add Prisma schema for DiagnosticSession and DiagnosticResponse**

Add to `packages/db-schema/prisma/schema.prisma`:

```prisma
model DiagnosticSession {
  id              String               @id @default(cuid())
  studentId       String               @map("student_id")
  student         User                 @relation(fields: [studentId], references: [id])
  status          DiagnosticStatus     @default(in_progress)
  currentAbility  Json?                @map("current_ability")   // { [subject]: float } running estimate
  result          Json?                                          // final per-topic ability profile
  startedAt       DateTime             @default(now()) @map("started_at")
  completedAt     DateTime?            @map("completed_at")
  responses       DiagnosticResponse[]
  createdAt       DateTime             @default(now()) @map("created_at")
  updatedAt       DateTime             @updatedAt @map("updated_at")

  @@index([studentId])
  @@map("diagnostic_sessions")
  @@schema("public")
}

model DiagnosticResponse {
  id              String             @id @default(cuid())
  sessionId       String             @map("session_id")
  session         DiagnosticSession  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  problemId       String             @map("problem_id")
  studentAnswer   String?            @map("student_answer")
  isCorrect       Boolean?           @map("is_correct")
  responseTimeSec Int?               @map("response_time_sec")
  abilityBefore   Float?             @map("ability_before")  // theta before this response
  abilityAfter    Float?             @map("ability_after")   // theta after this response
  orderIndex      Int                @map("order_index")
  createdAt       DateTime           @default(now()) @map("created_at")

  @@unique([sessionId, problemId])
  @@index([sessionId])
  @@map("diagnostic_responses")
  @@schema("public")
}

enum DiagnosticStatus {
  in_progress
  completed
  abandoned

  @@schema("public")
}
```

Add `diagnosticSessions DiagnosticSession[]` to the `User` model relations.

**Step 2: Implement the IRT-inspired adaptive engine**

Create `apps/lms-api/src/diagnostics/irt-engine.ts`:

```typescript
/**
 * Simplified 1PL (Rasch) IRT engine for adaptive item selection.
 *
 * - Ability (theta): real number, starts at 0 (medium difficulty).
 * - Difficulty (b): mapped from Problem.difficulty (1-5) to IRT scale (-2 to +2).
 * - P(correct | theta, b) = 1 / (1 + exp(-(theta - b)))
 * - After each response, update theta via MLE step.
 * - Next item selection: pick problem whose difficulty is closest to current theta
 *   from the least-tested curriculum node.
 */

export interface AbilityEstimate {
  theta: number;        // current ability estimate
  se: number;           // standard error
  responses: number;    // total responses so far
}

export interface TopicAbility {
  subject: string;
  unitMajor: string;
  theta: number;
  se: number;
  responses: number;
}

// Map Problem.difficulty (1-5 integer) to IRT b-parameter (-2 to +2)
export function difficultyToB(difficulty: number): number {
  return (difficulty - 3); // 1->-2, 2->-1, 3->0, 4->1, 5->2
}

// Map IRT b-parameter back to difficulty scale
export function bToDifficulty(b: number): number {
  return Math.max(1, Math.min(5, Math.round(b + 3)));
}

// P(correct | theta, b) under 1PL model
export function pCorrect(theta: number, b: number): number {
  return 1 / (1 + Math.exp(-(theta - b)));
}

// Fisher information at (theta, b)
function fisherInfo(theta: number, b: number): number {
  const p = pCorrect(theta, b);
  return p * (1 - p);
}

// Update ability estimate after a single response using Newton-Raphson MLE step
export function updateAbility(
  current: AbilityEstimate,
  b: number,
  correct: boolean,
): AbilityEstimate {
  const p = pCorrect(current.theta, b);
  const u = correct ? 1 : 0;

  // Newton-Raphson step: theta_new = theta + (u - p) / I(theta)
  const info = fisherInfo(current.theta, b);
  const step = info > 0.001 ? (u - p) / info : (u - p) * 4;

  // Clamp step to avoid wild jumps
  const clampedStep = Math.max(-1, Math.min(1, step));
  const newTheta = Math.max(-3, Math.min(3, current.theta + clampedStep));

  // Updated SE based on cumulative information
  const totalInfo = 1 / (current.se * current.se) + info;
  const newSe = Math.sqrt(1 / totalInfo);

  return {
    theta: newTheta,
    se: newSe,
    responses: current.responses + 1,
  };
}

// Select next problem: balance topic coverage with ability-matched difficulty
export function selectNextDifficulty(theta: number): { min: number; max: number } {
  const targetB = theta;
  const targetDiff = bToDifficulty(targetB);
  return {
    min: Math.max(1, targetDiff - 1),
    max: Math.min(5, targetDiff + 1),
  };
}

// Determine which topic to test next (least-tested topic with fewest responses)
export function selectNextTopic(
  topicAbilities: TopicAbility[],
  allTopics: Array<{ subject: string; unitMajor: string }>,
): { subject: string; unitMajor: string } {
  // Find topics not yet tested or with fewest responses
  const tested = new Map(
    topicAbilities.map((t) => [`${t.subject}::${t.unitMajor}`, t.responses]),
  );

  let minResponses = Infinity;
  let target = allTopics[0];

  for (const topic of allTopics) {
    const key = `${topic.subject}::${topic.unitMajor}`;
    const count = tested.get(key) ?? 0;
    if (count < minResponses) {
      minResponses = count;
      target = topic;
    }
  }

  return target;
}

// Compute final per-topic ability profile
export function computeProfile(
  topicAbilities: TopicAbility[],
): Record<string, { ability: number; confidence: number; level: string }> {
  const profile: Record<string, { ability: number; confidence: number; level: string }> = {};

  for (const ta of topicAbilities) {
    const key = `${ta.subject} > ${ta.unitMajor}`;
    const normalizedAbility = Math.round(((ta.theta + 3) / 6) * 100); // 0-100 scale
    const confidence = Math.max(0, Math.min(1, 1 - ta.se / 3));

    let level = "보통";
    if (normalizedAbility >= 80) level = "우수";
    else if (normalizedAbility >= 60) level = "양호";
    else if (normalizedAbility >= 40) level = "보통";
    else if (normalizedAbility >= 20) level = "부족";
    else level = "매우 부족";

    profile[key] = {
      ability: normalizedAbility,
      confidence: Math.round(confidence * 100) / 100,
      level,
    };
  }

  return profile;
}
```

**Step 3: Implement the diagnostics service**

Create `apps/lms-api/src/diagnostics/diagnostics.service.ts`:

```typescript
@Injectable()
export class DiagnosticsService {
  constructor(private prisma: PrismaService) {}

  // POST /diagnostics/start
  // 1. Create DiagnosticSession with initial ability = { theta: 0, se: 1.5 }
  // 2. Select first problem: medium difficulty (3), from least-tested topic
  // 3. Query ocr.problems for approved problems matching criteria
  // 4. Return session ID + first problem

  // POST /diagnostics/:id/answer
  // 1. Validate session belongs to student and is in_progress
  // 2. Auto-grade answer (reuse SubmissionsService.autoGrade logic for MC/SA)
  // 3. Update ability estimate via IRT engine
  // 4. Store DiagnosticResponse with abilityBefore/After
  // 5. If responses >= 25 or SE < 0.3 for all topics: complete session
  // 6. Otherwise: select next problem and return it

  // GET /diagnostics/:id/result
  // 1. Validate session belongs to student or teacher
  // 2. Return computed ability profile per topic
}
```

**Step 4: Add API controller and module**

Create `apps/lms-api/src/diagnostics/diagnostics.controller.ts` with:
- `POST /v1/diagnostics/start` — starts a diagnostic session, returns first question
- `POST /v1/diagnostics/:id/answer` — submits answer, returns next question or result
- `GET /v1/diagnostics/:id/result` — returns final profile

Register `DiagnosticsModule` in `apps/lms-api/src/app.module.ts`.

**Step 5: Build diagnostic test-taking UI**

Create pages in `apps/web/src/app/(authenticated)/diagnostics/`:
- Landing page with "Start Diagnostic" button and explanation (10 min, 25-30 questions)
- Test-taking page with: timer (10 min countdown), current question (LaTeX-rendered), answer input (MC buttons or short answer field), progress indicator (N/25)
- Results page with: radar chart showing per-topic ability, table view of topic-level scores, link to start remediation assignments

---

## Task 2: Knowledge Graph Weakness Analysis (3-2)

**Files:**
- Create: `packages/db-schema/prisma/migrations/YYYYMMDD_curriculum_prerequisite/migration.sql`
- Modify: `packages/db-schema/prisma/schema.prisma`
- Create: `apps/lms-api/src/analytics/knowledge-graph.service.ts`
- Modify: `apps/lms-api/src/analytics/analytics.controller.ts`
- Modify: `apps/lms-api/src/analytics/analytics.module.ts`
- Create: `apps/lms-api/src/analytics/seed/prerequisite-data.ts`
- Create: `apps/web/src/components/analytics/knowledge-graph-viz.tsx`
- Modify: `apps/web/src/app/(authenticated)/review/page.tsx`

**Step 1: Add CurriculumPrerequisite table**

Add to `packages/db-schema/prisma/schema.prisma`:

```prisma
model CurriculumPrerequisite {
  id          String   @id @default(cuid())
  fromSubject String   @map("from_subject")    // prerequisite topic's subject
  fromUnit    String   @map("from_unit")        // prerequisite topic's unitMajor
  toSubject   String   @map("to_subject")       // dependent topic's subject
  toUnit      String   @map("to_unit")          // dependent topic's unitMajor
  strength    Float    @default(1.0)            // edge weight (1.0 = hard prereq, 0.5 = soft)
  createdAt   DateTime @default(now()) @map("created_at")

  @@unique([fromSubject, fromUnit, toSubject, toUnit])
  @@index([toSubject, toUnit])
  @@map("curriculum_prerequisites")
  @@schema("public")
}
```

**Step 2: Seed prerequisite DAG data**

Create `apps/lms-api/src/analytics/seed/prerequisite-data.ts` containing the Korean math 2015 curriculum prerequisite graph. Key edges:

```typescript
export const PREREQUISITE_EDGES = [
  // 수학I -> 미적분 connections
  { from: ["수학I", "지수함수와 로그함수"], to: ["미적분", "미분법"], strength: 1.0 },
  { from: ["수학I", "삼각함수"], to: ["미적분", "미분법"], strength: 1.0 },
  { from: ["수학I", "수열"], to: ["미적분", "수열의 극한"], strength: 1.0 },

  // 수학II -> 미적분 connections
  { from: ["수학II", "함수의 극한과 연속"], to: ["미적분", "수열의 극한"], strength: 0.7 },
  { from: ["수학II", "미분"], to: ["미적분", "미분법"], strength: 1.0 },
  { from: ["수학II", "적분"], to: ["미적분", "적분법"], strength: 1.0 },

  // Internal 수학II dependencies
  { from: ["수학II", "함수의 극한과 연속"], to: ["수학II", "미분"], strength: 1.0 },
  { from: ["수학II", "미분"], to: ["수학II", "적분"], strength: 0.8 },

  // 확률과 통계 internal
  { from: ["확률과 통계", "경우의 수"], to: ["확률과 통계", "확률"], strength: 1.0 },
  { from: ["확률과 통계", "확률"], to: ["확률과 통계", "통계"], strength: 0.8 },

  // 기하 internal
  { from: ["기하", "이차곡선"], to: ["기하", "평면벡터"], strength: 0.5 },
  { from: ["기하", "평면벡터"], to: ["기하", "공간도형과 공간벡터"], strength: 1.0 },

  // Cross-subject connections
  { from: ["수학I", "삼각함수"], to: ["기하", "평면벡터"], strength: 0.6 },
  { from: ["수학II", "함수의 극한과 연속"], to: ["수학II", "미분"], strength: 1.0 },
];
```

Provide a seed script callable as `npx ts-node apps/lms-api/src/analytics/seed/prerequisite-data.ts` or via an admin endpoint.

**Step 3: Implement weakness trace-back algorithm**

Create `apps/lms-api/src/analytics/knowledge-graph.service.ts`:

```typescript
@Injectable()
export class KnowledgeGraphService {
  constructor(private prisma: PrismaService) {}

  // GET /analytics/student/:id/knowledge-graph
  async getStudentKnowledgeGraph(studentId: string) {
    // 1. Fetch all CurriculumPrerequisite edges -> build adjacency list
    // 2. Fetch student mastery per topic from SubmissionAnswer + Problem join
    //    (same query pattern as AnalyticsService.getStudentReport accuracyByUnit)
    // 3. For each weak topic (accuracy < 50%), BFS backwards through DAG
    //    to find root-cause prerequisite gaps
    // 4. Return:
    //    {
    //      nodes: [{ subject, unitMajor, mastery: 0-100, status: "strong"|"weak"|"untested" }],
    //      edges: [{ from, to, strength }],
    //      weaknessRoots: [{ subject, unitMajor, reason: "prerequisite gap for X" }],
    //      recommendations: [{ topic, action: "review prerequisite" | "practice more" }]
    //    }
  }

  // BFS backward from weak node through prerequisite DAG
  private traceWeaknessRoots(
    weakNode: { subject: string; unitMajor: string },
    adjacencyReverse: Map<string, Array<{ subject: string; unitMajor: string; strength: number }>>,
    masteryMap: Map<string, number>,
  ): Array<{ subject: string; unitMajor: string }> {
    // Walk backwards from weakNode; collect nodes that are also weak or untested
    // Stop when reaching a strong node or a node with no prerequisites
    // Return the deepest weak nodes as "root causes"
  }
}
```

**Step 4: Add API endpoint**

Add to `apps/lms-api/src/analytics/analytics.controller.ts`:
- `GET /v1/analytics/student/:id/knowledge-graph` — returns DAG with mastery overlay

**Step 5: Build interactive DAG visualization**

Create `apps/web/src/components/analytics/knowledge-graph-viz.tsx`:
- Use a lightweight DAG rendering approach (CSS grid layout or simple SVG)
- Nodes colored by mastery: green (>70%), yellow (40-70%), red (<40%), gray (untested)
- Edges drawn as SVG arrows with thickness proportional to `strength`
- Click a node to see detail: accuracy, total problems attempted, recent wrong answers
- Highlight weakness root-cause paths in red

---

## Task 3: Socratic AI Tutor (3-3)

**Files:**
- Create: `packages/db-schema/prisma/migrations/YYYYMMDD_tutor_session/migration.sql`
- Modify: `packages/db-schema/prisma/schema.prisma`
- Create: `apps/lms-api/src/tutor/tutor.module.ts`
- Create: `apps/lms-api/src/tutor/tutor.controller.ts`
- Create: `apps/lms-api/src/tutor/tutor.service.ts`
- Create: `apps/lms-api/src/tutor/tutor-sse.gateway.ts`
- Modify: `apps/lms-api/src/app.module.ts`
- Create: `apps/web/src/app/(authenticated)/tutor/[problemId]/page.tsx`
- Create: `apps/web/src/components/tutor/chat-message.tsx`
- Create: `apps/web/src/components/tutor/chat-input.tsx`
- Create: `apps/web/src/hooks/useTutorChat.ts`

**Step 1: Add Prisma schema for TutorSession and TutorMessage**

Add to `packages/db-schema/prisma/schema.prisma`:

```prisma
model TutorSession {
  id          String         @id @default(cuid())
  studentId   String         @map("student_id")
  student     User           @relation(fields: [studentId], references: [id])
  problemId   String         @map("problem_id")
  status      TutorStatus    @default(active)
  messages    TutorMessage[]
  createdAt   DateTime       @default(now()) @map("created_at")
  updatedAt   DateTime       @updatedAt @map("updated_at")

  @@index([studentId])
  @@index([problemId])
  @@map("tutor_sessions")
  @@schema("public")
}

model TutorMessage {
  id          String        @id @default(cuid())
  sessionId   String        @map("session_id")
  session     TutorSession  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  role        MessageRole
  content     String
  metadata    Json?                    // { misconception?: string, hintLevel?: number }
  createdAt   DateTime      @default(now()) @map("created_at")

  @@index([sessionId, createdAt])
  @@map("tutor_messages")
  @@schema("public")
}

enum TutorStatus {
  active
  resolved
  abandoned

  @@schema("public")
}

enum MessageRole {
  student
  tutor

  @@schema("public")
}
```

Add `tutorSessions TutorSession[]` to the `User` model relations.

**Step 2: Implement the tutor service with OpenAI streaming**

Create `apps/lms-api/src/tutor/tutor.service.ts`:

```typescript
@Injectable()
export class TutorService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private buildSystemPrompt(problem: {
    stemLatex: string;
    stemText: string;
    answerText: string | null;
    solutionSteps: unknown;
    solutionStrategy: string | null;
    requiredConcepts: unknown;
    commonMistakes: unknown;
  }): string {
    return `You are a Socratic math tutor helping a Korean high school student.

## Rules
1. NEVER give the answer directly. Guide the student to discover it.
2. Ask one question at a time. Wait for the student to respond.
3. If the student is stuck, give a small hint, not the solution.
4. If the student makes a mistake, ask questions that expose the error.
5. Use Korean (한국어) for all responses.
6. Use $...$ for inline LaTeX and $$...$$ for display math.
7. Keep responses concise (2-4 sentences max).
8. Track which step the student is on and guide them forward.

## Problem
${problem.stemLatex}

## Correct Answer (hidden from student)
${problem.answerText ?? "정답 없음"}

## Solution Steps (hidden from student)
${JSON.stringify(problem.solutionSteps ?? [])}

## Solution Strategy (hidden from student)
${problem.solutionStrategy ?? ""}

## Required Concepts
${JSON.stringify(problem.requiredConcepts ?? [])}

## Common Mistakes to Watch For
${JSON.stringify(problem.commonMistakes ?? [])}

## Hint Progression
1. First: Ask what the student knows about the relevant concept
2. Second: Point to the key formula or theorem needed
3. Third: Give the first step of the solution
4. Fourth: Walk through the next step together
5. Last resort: Show most of the solution, ask student to complete final step`;
  }

  // POST /tutor/sessions — create session, return initial greeting message
  async createSession(studentId: string, problemId: string): Promise<TutorSession> {
    // 1. Fetch problem from ocr.problems (via Prisma cross-schema)
    // 2. Create TutorSession
    // 3. Generate initial greeting: "어떤 부분에서 막혔나요?" (via non-streaming call)
    // 4. Store as first TutorMessage (role: tutor)
    // 5. Return session with messages
  }

  // POST /tutor/sessions/:id/message — student sends message, get streaming AI response
  async *sendMessage(
    sessionId: string,
    studentId: string,
    content: string,
  ): AsyncGenerator<string> {
    // 1. Validate session belongs to student
    // 2. Store student message
    // 3. Build message history from TutorMessage records
    // 4. Call OpenAI with streaming enabled
    // 5. Yield chunks as they arrive (for SSE)
    // 6. After stream completes, store full tutor response as TutorMessage
  }
}
```

**Step 3: Implement SSE streaming controller**

Create `apps/lms-api/src/tutor/tutor.controller.ts`:

```typescript
@Controller("v1/tutor")
export class TutorController {
  constructor(private tutorService: TutorService) {}

  @Post("sessions")
  @UseGuards(JwtAuthGuard)
  async createSession(
    @CurrentUser() user,
    @Body() dto: { problemId: string },
  ) {
    return this.tutorService.createSession(user.id, dto.problemId);
  }

  @Post("sessions/:id/message")
  @UseGuards(JwtAuthGuard)
  @Header("Content-Type", "text/event-stream")
  @Header("Cache-Control", "no-cache")
  @Header("Connection", "keep-alive")
  async sendMessage(
    @Param("id") sessionId: string,
    @CurrentUser() user,
    @Body() dto: { content: string },
    @Res() res: Response,
  ) {
    // Write SSE headers
    // Iterate over tutorService.sendMessage() async generator
    // For each chunk: write `data: ${JSON.stringify({ chunk })}\n\n`
    // On completion: write `event: done\ndata: {}\n\n`
    // Handle errors: write `event: error\ndata: ${reason}\n\n`
  }
}
```

**Step 4: Build chat frontend**

Create `apps/web/src/hooks/useTutorChat.ts`:
- Manages chat state, sends messages, reads SSE stream for AI responses
- Accumulates streaming chunks into complete messages
- Reuses `streamSse` from `apps/web/src/lib/sse.ts` (extended for POST + body)

Create `apps/web/src/app/(authenticated)/tutor/[problemId]/page.tsx`:
- Split layout: problem display on left (LaTeX-rendered stem + choices), chat on right
- Chat messages rendered with LaTeX support via existing `latex-renderer.tsx`
- Input field with send button at bottom
- "Need more help" button that explicitly requests next hint level

---

## Task 4: SmartScore Grading (3-4)

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma` (add `smartScore` to `Submission`)
- Create: `packages/db-schema/prisma/migrations/YYYYMMDD_smart_score/migration.sql`
- Create: `apps/lms-api/src/submissions/smart-score.service.ts`
- Modify: `apps/lms-api/src/submissions/submissions.service.ts`
- Modify: `apps/lms-api/src/submissions/submissions.module.ts`
- Modify: `apps/web/src/app/(authenticated)/review/page.tsx` (show SmartScore)

**Step 1: Add smartScore column to Submission**

Add to `Submission` model in `packages/db-schema/prisma/schema.prisma`:

```prisma
  smartScore    Float?           @map("smart_score")
  smartScoreMeta Json?           @map("smart_score_meta")  // breakdown of scoring factors
```

**Step 2: Implement SmartScore calculation engine**

Create `apps/lms-api/src/submissions/smart-score.service.ts`:

```typescript
interface SmartScoreBreakdown {
  rawScore: number;           // 0-100 raw percentage
  difficultyWeight: number;   // multiplier based on problem difficulty
  consistencyBonus: number;   // bonus for consistent performance across topics
  streakBonus: number;        // bonus for consecutive correct answers
  timeFactor: number;         // slight bonus for faster completion (if timed)
  finalScore: number;         // weighted final score
}

@Injectable()
export class SmartScoreService {
  constructor(private prisma: PrismaService) {}

  async calculate(submissionId: string): Promise<SmartScoreBreakdown> {
    // 1. Fetch submission with answers
    // 2. Fetch problems for difficulty data (cross-schema via Prisma)
    // 3. Compute components:

    // a) Base score: raw correct/total percentage
    // b) Difficulty weight: average(problem.difficulty * weight_table[difficulty])
    //    weight_table: { 1: 0.6, 2: 0.8, 3: 1.0, 4: 1.3, 5: 1.6 }
    // c) Consistency bonus: if accuracy varies < 15% across topics, +5%
    // d) Streak bonus: longest consecutive correct streak * 0.5, capped at +10%
    // e) Time factor: 1.0 (no time data) or slight bonus if completed under target

    // SmartScore = base_score * difficulty_weight * (1 + consistency_bonus + streak_bonus) * time_factor
    // Clamped to 0-100
  }
}
```

**Step 3: Integrate SmartScore into auto-grading flow**

Modify `apps/lms-api/src/submissions/submissions.service.ts`:

In `autoGrade()`, after computing `score`, call `smartScoreService.calculate(submissionId)` and store result:

```typescript
// After existing score calculation:
const smartResult = await this.smartScoreService.calculate(submissionId);

return this.prisma.submission.update({
  where: { id: submissionId },
  data: {
    score,
    smartScore: smartResult.finalScore,
    smartScoreMeta: smartResult as any,
    status: "graded",
    gradedAt: new Date(),
  },
  include: { answers: true },
});
```

**Step 4: Display SmartScore in frontend**

Modify `apps/web/src/app/(authenticated)/review/page.tsx`:
- Show SmartScore alongside raw score in submission cards
- Add tooltip showing breakdown (difficulty weight, consistency bonus, streak bonus)
- Color-code: SmartScore > raw score = green indicator, below = amber

---

## Task 5: AI Problem Variant Generation (3-5)

**Files:**
- Modify: `apps/lms-api/src/problems/twin-problem.service.ts`
- Create: `apps/lms-api/src/problems/dto/generate-variants.dto.ts`
- Modify: `apps/lms-api/src/problems/problems.controller.ts`
- Modify: `apps/lms-api/src/problems/problems.service.ts`

**Step 1: Add DTO for variant generation**

Create `apps/lms-api/src/problems/dto/generate-variants.dto.ts`:

```typescript
import { IsInt, IsOptional, Min, Max } from "class-validator";

export class GenerateVariantsDto {
  @IsInt()
  @Min(1)
  @Max(10)
  count: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficultyTarget?: number;  // null = same as source
}
```

**Step 2: Extend TwinProblemService with parametric variant generation**

Modify `apps/lms-api/src/problems/twin-problem.service.ts`:

Add a new method `generateVariants()` that extends the existing `generate()`:

```typescript
async generateVariants(
  source: TwinProblemSource,
  count: number,
  difficultyTarget?: number,
): Promise<TwinProblemResult[]> {
  // 1. Build an extended system prompt that instructs GPT to generate N variants
  //    - Each variant must have different numbers/conditions
  //    - Each variant must have a different answer from source AND from each other
  //    - If difficultyTarget is set, adjust difficulty modifiers in prompt
  //    - Use structured output with array schema: { variants: GeneratedTwinProblem[] }

  // 2. For count <= 3: single API call with batch schema
  //    For count > 3: parallel calls of 3 each (avoid token limit)

  // 3. Run verification pass on each variant (reuse existing verification logic)

  // 4. Return array of TwinProblemResult

  // Difficulty control prompt additions:
  //   difficultyTarget < source.difficulty:
  //     "Make the variant EASIER: simplify conditions, use smaller numbers, reduce steps"
  //   difficultyTarget > source.difficulty:
  //     "Make the variant HARDER: add conditions, use complex numbers, require more steps"
}
```

**Step 3: Add API endpoint**

Modify `apps/lms-api/src/problems/problems.controller.ts`:

```typescript
@Post(":id/generate-variants")
@UseGuards(JwtAuthGuard, RoleGuard("admin", "teacher"))
async generateVariants(
  @Param("id") problemId: string,
  @Body() dto: GenerateVariantsDto,
  @CurrentUser() user,
) {
  return this.problemsService.generateVariants(
    problemId,
    user.id,
    user.role,
    dto.count,
    dto.difficultyTarget,
  );
}
```

Add corresponding method to `ProblemsService` that fetches the source problem and delegates to `TwinProblemService.generateVariants()`.

---

## Task 6: AI Written Response Partial Credit (3-6)

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma` (add rubric fields to `SubmissionAnswer`)
- Create: `packages/db-schema/prisma/migrations/YYYYMMDD_rubric_grading/migration.sql`
- Create: `apps/ocr-api/app/workers/rubric_grader.py`
- Modify: `apps/ocr-api/app/workers/analyze_photo.py`
- Modify: `apps/ocr-api/app/services/redis_events.py`
- Modify: `apps/lms-api/src/submission-photos/submission-photos.service.ts`

**Step 1: Add rubric grading fields to SubmissionAnswer**

Modify `SubmissionAnswer` in `packages/db-schema/prisma/schema.prisma`:

```prisma
model SubmissionAnswer {
  // ... existing fields ...
  rubricResult  Json?     @map("rubric_result")   // structured rubric breakdown
  rubricScore   Float?    @map("rubric_score")     // partial credit score (0-1)
  rubricVersion Int?      @map("rubric_version")   // for tracking rubric changes
}
```

**Step 2: Implement rubric generation and grading worker**

Create `apps/ocr-api/app/workers/rubric_grader.py`:

```python
"""Celery task: rubric-based partial credit grading for written responses.

Generates a rubric from problem solutionSteps, then applies it to
student's handwritten work via Claude Vision.
"""

RUBRIC_SYSTEM_PROMPT = """You are a Korean math grading expert.

## Goal
Given a math problem and its solution steps, generate a scoring rubric,
then apply it to the student's handwritten work.

## Rubric Rules
- Each solution step maps to one rubric item
- Partial credit: student gets credit for correct intermediate steps
- Rubric items: { step, description, maxPoints, criteria }
- Total points across all items must sum to 10

## Grading Rules
- For each rubric item, assess the student's work visible in the photo
- Award 0, partial, or full points based on what is visible
- If handwriting is unclear, note uncertainty but grade what is readable
- Return structured result with per-item scores and feedback

## Output Format
{
  "rubric": [
    { "step": 1, "description": "...", "maxPoints": N, "criteria": "..." }
  ],
  "grades": [
    { "step": 1, "earnedPoints": N, "maxPoints": N, "feedback": "..." }
  ],
  "totalScore": N,
  "maxScore": 10,
  "overallFeedback": "..."
}
"""

@celery.task(
    bind=True,
    name="task.photo.rubric_grade",
    max_retries=3,
    default_retry_delay=10,
    acks_late=True,
)
def rubric_grade_photo(self, payload: dict) -> dict:
    """Apply rubric-based partial credit grading to a photo submission.

    payload: {
        submissionPhotoId: str,
        submissionAnswerId: str,
        s3Key: str,
        problem: {
            id: str,
            stemLatex: str,
            answerText: str,
            solutionSteps: list[dict],
            solutionStrategy: str,
        }
    }
    """
    # 1. Download image from S3 (reuse _download_image from analyze_photo)
    # 2. Build rubric from problem.solutionSteps
    # 3. Call Anthropic Claude Vision with rubric + image
    # 4. Parse structured rubric result
    # 5. Publish to "photo:rubric:completed" channel
    #    payload: { submissionAnswerId, rubricResult, rubricScore }
```

**Step 3: Integrate rubric grading into photo analysis flow**

Modify `apps/ocr-api/app/workers/analyze_photo.py`:

After existing analysis completes, check if the matched problem has `written_solution` type. If so, chain the rubric grading task:

```python
# At end of analyze_submission_photo, after publishing feedback:
if feedback.get("matchedProblemId"):
    # Chain rubric grading for written_solution problems
    rubric_grade_photo.delay({
        "submissionPhotoId": photo_id,
        "submissionAnswerId": payload.get("submissionAnswerId"),
        "s3Key": payload["s3Key"],
        "problem": next(
            (p for p in (payload.get("problems") or [])
             if p.get("id") == feedback["matchedProblemId"]),
            None,
        ),
    })
```

**Step 4: Add Redis channel for rubric results**

Add to `apps/ocr-api/app/services/redis_events.py`:

```python
# Add new channel
# photo:rubric:completed — FastAPI -> NestJS: rubric grading done
```

**Step 5: Handle rubric results in NestJS**

Modify `apps/lms-api/src/submission-photos/submission-photos.service.ts`:

Listen on `photo:rubric:completed` channel, update `SubmissionAnswer` with rubric result:

```typescript
// On receiving photo:rubric:completed event:
await this.prisma.submissionAnswer.update({
  where: { id: event.submissionAnswerId },
  data: {
    rubricResult: event.rubricResult,
    rubricScore: event.rubricScore,
    score: event.rubricScore * maxPointsForThisProblem,
  },
});
```

---

## Execution Order & Dependency Graph

```
Task 4 (SmartScore) ─────────────────────────────── standalone, no deps
Task 5 (Variant Generation) ─────────────────────── standalone, extends existing twin-problem
Task 6 (Rubric Grading) ─────────────────────────── standalone, extends existing photo analysis
Task 1 (Diagnostic Assessment) ──────────────────── needs: approved problems in DB
Task 2 (Knowledge Graph) ────┬───────────────────── needs: Task 1 data (diagnostic ability) useful but not required
                              └── soft dep on analytics data
Task 3 (Socratic Tutor) ─────────────────────────── needs: problems with solutionSteps (existing)
```

### Recommended implementation order:

```
Phase 3a (parallel, no dependencies):
  ├── Task 4: SmartScore Grading          ~2 days   [simple formula, modify existing flow]
  ├── Task 5: Variant Generation          ~3 days   [extends existing twin-problem service]
  └── Task 6: Rubric Partial Credit       ~3 days   [extends existing photo analysis]

Phase 3b (after 3a, needs schema migrations):
  ├── Task 1: Diagnostic Assessment       ~5 days   [new module, IRT engine, full UI]
  └── Task 2: Knowledge Graph             ~4 days   [DAG data + visualization]

Phase 3c (after 3b):
  └── Task 3: Socratic Tutor              ~5 days   [streaming, chat UI, careful prompt eng]
```

### Total estimated effort: ~22 days

### Key risks:
1. **IRT calibration (Task 1):** The simplified 1PL model may need tuning after real student data. Plan for a calibration pass after initial launch.
2. **Socratic prompt quality (Task 3):** The "never give answers" constraint requires careful testing. Budget time for prompt iteration with real problems.
3. **Rubric consistency (Task 6):** Vision model rubric grading may vary across runs. Consider storing rubric separately and re-grading on rubric updates.
4. **Prerequisite DAG completeness (Task 2):** The initial seed data covers major edges. Plan for teacher-editable UI in a future phase.

### Migration order:
1. `smart_score` columns (Task 4)
2. `rubric_result` columns (Task 6)
3. `DiagnosticSession` + `DiagnosticResponse` tables (Task 1)
4. `CurriculumPrerequisite` table (Task 2)
5. `TutorSession` + `TutorMessage` tables (Task 3)

Each migration is independent and can be run in any order, but the above sequence matches the recommended implementation order.
