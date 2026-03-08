# LMS + Mobile App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add full LMS features (calendar, assignments, submissions, grading, analytics, notifications) with Course→Class rename, parent role, and a separate React Native (Expo) mobile app.

**Architecture:** Extend existing NestJS backend with new modules. Rename Course→Class throughout. Add Expo mobile app as `apps/mobile/`. Vision LLM photo analysis via FastAPI Celery worker.

**Tech Stack:** NestJS, Prisma, React Native (Expo), Expo Router, NativeWind, react-native-calendars, victory-native, expo-camera, expo-notifications

---

## Phase 1: Schema & Backend Foundation

### Task 1: Rename Course → Class in Prisma Schema + Add Parent Role

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`

**Step 1: Update schema**

Rename `Course` model to `Class`, update `Role` enum to include `parent`, update all references:

```prisma
enum Role {
  admin
  teacher
  student
  parent

  @@schema("public")
}

model Class {
  id             String       @id @default(cuid())
  title          String
  description    String?
  organizationId String       @map("organization_id")
  organization   Organization @relation(fields: [organizationId], references: [id])
  enrollments    Enrollment[]
  assignments    Assignment[]
  lessons        Lesson[]
  deletedAt      DateTime?    @map("deleted_at")
  createdAt      DateTime     @default(now()) @map("created_at")
  updatedAt      DateTime     @updatedAt @map("updated_at")

  @@map("classes")
  @@schema("public")
}
```

Update `Organization` relation: `courses Course[]` → `classes Class[]`

Update `Enrollment`: `courseId` → `classId`, `course Course` → `class Class`

Update `Assignment`: `courseId` → `classId`, `course Course` → `class Class`

**Step 2: Run migration**

```bash
cd packages/db-schema && pnpm db:migrate --name rename_course_to_class_add_parent
```

**Step 3: Generate Prisma client**

```bash
pnpm --filter @jsmath/db-schema db:generate
```

**Step 4: Commit**

```bash
git add packages/db-schema/
git commit -m "feat: rename Course → Class, add parent role to schema"
```

---

### Task 2: Add New Models to Prisma Schema

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`

**Step 1: Add ParentStudent model**

```prisma
model ParentStudent {
  id        String   @id @default(cuid())
  parentId  String   @map("parent_id")
  studentId String   @map("student_id")
  parent    User     @relation("ParentRelation", fields: [parentId], references: [id])
  student   User     @relation("StudentRelation", fields: [studentId], references: [id])
  createdAt DateTime @default(now()) @map("created_at")

  @@unique([parentId, studentId])
  @@map("parent_students")
  @@schema("public")
}
```

Add to User model:
```prisma
parentLinks    ParentStudent[] @relation("ParentRelation")
childLinks     ParentStudent[] @relation("StudentRelation")
notifications  Notification[]
```

**Step 2: Add Lesson model**

```prisma
model Lesson {
  id                 String       @id @default(cuid())
  classId            String       @map("class_id")
  class              Class        @relation(fields: [classId], references: [id])
  title              String
  startAt            DateTime     @map("start_at")
  endAt              DateTime     @map("end_at")
  recurrenceRule     String?      @map("recurrence_rule")
  recurrenceParentId String?      @map("recurrence_parent_id")
  recurrenceParent   Lesson?      @relation("RecurringLessons", fields: [recurrenceParentId], references: [id])
  recurrenceChildren Lesson[]     @relation("RecurringLessons")
  status             LessonStatus @default(scheduled)
  location           String?
  memo               String?
  createdAt          DateTime     @default(now()) @map("created_at")
  updatedAt          DateTime     @updatedAt @map("updated_at")

  @@index([classId, startAt])
  @@index([recurrenceParentId])
  @@map("lessons")
  @@schema("public")
}

enum LessonStatus {
  scheduled
  completed
  cancelled

  @@schema("public")
}
```

**Step 3: Extend Assignment model + add AssignmentProblem**

Add to Assignment:
```prisma
  type             AssignmentType @default(text_task)
  assignmentProblems AssignmentProblem[]
  submissions      Submission[]
```

```prisma
enum AssignmentType {
  problem_set
  text_task

  @@schema("public")
}

model AssignmentProblem {
  id           String     @id @default(cuid())
  assignmentId String     @map("assignment_id")
  assignment   Assignment @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  problemId    String     @map("problem_id")
  orderIndex   Int        @map("order_index")

  @@unique([assignmentId, problemId])
  @@index([assignmentId])
  @@map("assignment_problems")
  @@schema("public")
}
```

**Step 4: Add Submission, SubmissionAnswer, SubmissionPhoto**

```prisma
model Submission {
  id           String           @id @default(cuid())
  assignmentId String           @map("assignment_id")
  assignment   Assignment       @relation(fields: [assignmentId], references: [id])
  studentId    String           @map("student_id")
  student      User             @relation(fields: [studentId], references: [id])
  type         SubmissionType
  status       SubmissionStatus @default(submitted)
  score        Float?
  maxScore     Float?           @map("max_score")
  submittedAt  DateTime         @default(now()) @map("submitted_at")
  gradedAt     DateTime?        @map("graded_at")
  gradedBy     String?          @map("graded_by")
  answers      SubmissionAnswer[]
  photos       SubmissionPhoto[]
  createdAt    DateTime         @default(now()) @map("created_at")
  updatedAt    DateTime         @updatedAt @map("updated_at")

  @@index([assignmentId, studentId])
  @@index([studentId])
  @@map("submissions")
  @@schema("public")
}

enum SubmissionType {
  online
  photo

  @@schema("public")
}

enum SubmissionStatus {
  submitted
  grading
  graded
  returned

  @@schema("public")
}

model SubmissionAnswer {
  id            String     @id @default(cuid())
  submissionId  String     @map("submission_id")
  submission    Submission @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  problemId     String     @map("problem_id")
  studentAnswer String?    @map("student_answer")
  isCorrect     Boolean?   @map("is_correct")
  score         Float?
  feedback      String?
  createdAt     DateTime   @default(now()) @map("created_at")

  @@unique([submissionId, problemId])
  @@map("submission_answers")
  @@schema("public")
}

model SubmissionPhoto {
  id             String                @id @default(cuid())
  submissionId   String                @map("submission_id")
  submission     Submission            @relation(fields: [submissionId], references: [id], onDelete: Cascade)
  s3Key          String                @map("s3_key")
  originalName   String?               @map("original_name")
  analysisStatus SubmissionPhotoStatus @default(pending)
  aiFeedback     Json?                 @map("ai_feedback")
  analyzedAt     DateTime?             @map("analyzed_at")
  createdAt      DateTime              @default(now()) @map("created_at")

  @@index([submissionId])
  @@map("submission_photos")
  @@schema("public")
}

enum SubmissionPhotoStatus {
  pending
  analyzing
  completed
  failed

  @@schema("public")
}
```

**Step 5: Add Notification model**

```prisma
model Notification {
  id            String   @id @default(cuid())
  userId        String   @map("user_id")
  user          User     @relation(fields: [userId], references: [id])
  type          String
  title         String
  body          String
  referenceType String?  @map("reference_type")
  referenceId   String?  @map("reference_id")
  readAt        DateTime? @map("read_at")
  createdAt     DateTime @default(now()) @map("created_at")

  @@index([userId, readAt])
  @@map("notifications")
  @@schema("public")
}
```

**Step 6: Add User relation for submissions**

Add to User model:
```prisma
submissions    Submission[]
```

**Step 7: Run migration & generate**

```bash
cd packages/db-schema && pnpm db:migrate --name add_lms_models
pnpm --filter @jsmath/db-schema db:generate
```

**Step 8: Commit**

```bash
git add packages/db-schema/
git commit -m "feat: add Lesson, Submission, Notification, ParentStudent models"
```

---

### Task 3: Rename courses → classes NestJS Module

**Files:**
- Delete: `apps/lms-api/src/courses/` (entire directory)
- Create: `apps/lms-api/src/classes/classes.module.ts`
- Create: `apps/lms-api/src/classes/classes.service.ts`
- Create: `apps/lms-api/src/classes/classes.controller.ts`
- Create: `apps/lms-api/src/classes/dto/create-class.dto.ts`
- Create: `apps/lms-api/src/classes/dto/update-class.dto.ts`
- Modify: `apps/lms-api/src/app.module.ts`
- Modify: `apps/lms-api/src/enrollments/enrollments.service.ts`
- Modify: `apps/lms-api/src/enrollments/enrollments.controller.ts`
- Modify: `apps/lms-api/src/assignments/assignments.service.ts`
- Modify: `apps/lms-api/src/assignments/assignments.controller.ts`

**Step 1: Create classes module**

`classes.service.ts` — same logic as courses.service.ts but with `prisma.class` instead of `prisma.course`:
```typescript
@Injectable()
export class ClassesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateClassDto) {
    return this.prisma.class.create({
      data: { title: dto.title, description: dto.description, organizationId: dto.organizationId },
      include: { organization: { select: { id: true, name: true } } },
    });
  }

  async findAll(organizationId?: string) {
    return this.prisma.class.findMany({
      where: { deletedAt: null, ...(organizationId ? { organizationId } : {}) },
      include: {
        organization: { select: { id: true, name: true } },
        _count: { select: { enrollments: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }
  // ... findById, update, softDelete — same pattern, s/course/class/g
}
```

`classes.controller.ts`:
```typescript
@Controller("classes")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClassesController {
  // ... same endpoints, s/courses/classes/g
}
```

**Step 2: Update enrollments — courseId → classId**

In `enrollments.controller.ts`: change route from `courses/:courseId/enroll` to `classes/:classId/enroll`

In `enrollments.service.ts`: change all `courseId` references to `classId`, `prisma.course` → `prisma.class`

**Step 3: Update assignments — courseId → classId**

In `assignments.controller.ts`: change route from `courses/:courseId/assignments` to `classes/:classId/assignments`

In `assignments.service.ts`: change `courseId` → `classId`, add `type` field support

**Step 4: Update app.module.ts**

Replace `CoursesModule` with `ClassesModule`

**Step 5: Delete old courses directory**

```bash
rm -rf apps/lms-api/src/courses/
```

**Step 6: Verify build**

```bash
cd apps/lms-api && pnpm build
```

**Step 7: Commit**

```bash
git add apps/lms-api/
git commit -m "refactor: rename courses → classes module"
```

---

### Task 4: Update Shared Types

**Files:**
- Modify: `packages/shared-types/src/index.ts`

**Step 1: Add parent role, class types, LMS types**

```typescript
export type Role = "admin" | "teacher" | "student" | "parent";

// ─── Class / LMS Types ───

export interface Class {
  id: string;
  title: string;
  description: string | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export type LessonStatus = "scheduled" | "completed" | "cancelled";

export interface Lesson {
  id: string;
  classId: string;
  title: string;
  startAt: string;
  endAt: string;
  recurrenceRule: string | null;
  recurrenceParentId: string | null;
  status: LessonStatus;
  location: string | null;
  memo: string | null;
}

export type AssignmentType = "problem_set" | "text_task";
export type SubmissionType = "online" | "photo";
export type SubmissionStatus = "submitted" | "grading" | "graded" | "returned";
export type PhotoAnalysisStatus = "pending" | "analyzing" | "completed" | "failed";

export interface Assignment {
  id: string;
  classId: string;
  title: string;
  description: string | null;
  type: AssignmentType;
  dueAt: string | null;
  maxScore: number;
  createdAt: string;
}

export interface Submission {
  id: string;
  assignmentId: string;
  studentId: string;
  type: SubmissionType;
  status: SubmissionStatus;
  score: number | null;
  submittedAt: string;
}

export interface SubmissionAnswer {
  id: string;
  submissionId: string;
  problemId: string;
  studentAnswer: string | null;
  isCorrect: boolean | null;
  score: number | null;
  feedback: string | null;
}

export interface PhotoFeedback {
  isCorrect: boolean;
  score: number;
  maxScore: number;
  steps: {
    step: number;
    content: string;
    correct: boolean;
    feedback?: string;
  }[];
  errorType: string | null;
  conceptHint: string | null;
  overallFeedback: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  referenceType: string | null;
  referenceId: string | null;
  readAt: string | null;
  createdAt: string;
}

// ─── Redis Event Payloads (new) ───

export interface PhotoAnalysisRequestPayload {
  submissionPhotoId: string;
  s3Key: string;
  problemId: string;
  problemStemLatex: string;
  answerText: string | null;
  answerLatex: string | null;
}

export interface PhotoAnalysisCompletedPayload {
  submissionPhotoId: string;
  feedback: PhotoFeedback;
}
```

**Step 2: Commit**

```bash
git add packages/shared-types/
git commit -m "feat: add LMS types to shared-types (Class, Lesson, Submission, Notification)"
```

---

## Phase 2: Backend LMS Modules

### Task 5: Lessons Module (Calendar)

**Files:**
- Create: `apps/lms-api/src/lessons/lessons.module.ts`
- Create: `apps/lms-api/src/lessons/lessons.service.ts`
- Create: `apps/lms-api/src/lessons/lessons.controller.ts`
- Create: `apps/lms-api/src/lessons/dto/create-lesson.dto.ts`
- Create: `apps/lms-api/src/lessons/dto/update-lesson.dto.ts`
- Modify: `apps/lms-api/src/app.module.ts`

**Step 1: Create DTOs**

`create-lesson.dto.ts`:
```typescript
export class CreateLessonDto {
  classId: string;
  title: string;
  startAt: string;    // ISO datetime
  endAt: string;      // ISO datetime
  recurrenceRule?: string;  // RFC 5545 RRULE e.g. "FREQ=WEEKLY;BYDAY=TU,TH"
  location?: string;
  memo?: string;
}
```

**Step 2: Create service**

Key methods:
- `create(dto)` — create single lesson; if recurrenceRule exists, expand into individual lessons for next 12 weeks
- `findByDateRange(classId, start, end)` — calendar query
- `findByUser(userId, start, end)` — find all lessons for a user (across all enrolled classes)
- `update(id, dto)` — update single lesson
- `updateSeries(recurrenceParentId, dto)` — update all future lessons in series
- `cancel(id)` — set status to cancelled
- `complete(id)` — set status to completed

Recurrence expansion logic:
```typescript
async expandRecurrence(parentLesson: Lesson, rule: string, weeks: number = 12) {
  // Parse RRULE, generate dates for next N weeks
  // Create individual Lesson records with recurrenceParentId = parent.id
  // Each gets its own startAt/endAt based on the rule
}
```

**Step 3: Create controller**

```typescript
@Controller("lessons")
@UseGuards(JwtAuthGuard, RolesGuard)
export class LessonsController {
  @Post()
  @Roles("admin", "teacher")
  create(@Body() dto: CreateLessonDto) {}

  @Get("calendar")
  getCalendar(
    @Query("start") start: string,
    @Query("end") end: string,
    @Query("classId") classId?: string,
    @Request() req: AuthRequest,
  ) {}

  @Patch(":id")
  @Roles("admin", "teacher")
  update(@Param("id") id: string, @Body() dto: UpdateLessonDto) {}

  @Patch(":id/cancel")
  @Roles("admin", "teacher")
  cancel(@Param("id") id: string) {}

  @Patch(":id/complete")
  @Roles("admin", "teacher")
  complete(@Param("id") id: string) {}
}
```

**Step 4: Register in app.module.ts**

**Step 5: Verify build & commit**

```bash
git add apps/lms-api/src/lessons/
git commit -m "feat: add lessons module with calendar and recurrence support"
```

---

### Task 6: Submissions Module

**Files:**
- Create: `apps/lms-api/src/submissions/submissions.module.ts`
- Create: `apps/lms-api/src/submissions/submissions.service.ts`
- Create: `apps/lms-api/src/submissions/submissions.controller.ts`
- Create: `apps/lms-api/src/submissions/dto/create-submission.dto.ts`
- Create: `apps/lms-api/src/submissions/dto/grade-submission.dto.ts`
- Modify: `apps/lms-api/src/app.module.ts`

**Step 1: Create DTOs**

`create-submission.dto.ts`:
```typescript
export class CreateSubmissionDto {
  assignmentId: string;
  type: "online" | "photo";
  answers?: { problemId: string; studentAnswer: string }[];
}
```

`grade-submission.dto.ts`:
```typescript
export class GradeSubmissionDto {
  score: number;
  answers?: { problemId: string; score: number; feedback?: string }[];
}
```

**Step 2: Create service**

Key methods:
- `submit(studentId, dto)` — create submission with answers (online type auto-grades multiple choice)
- `findByAssignment(assignmentId)` — list all submissions for an assignment
- `findByStudent(studentId, classId?)` — list student's submissions
- `grade(id, dto, graderId)` — teacher grades a submission
- `getDetail(id)` — submission with answers and photos

Auto-grading logic for online submissions:
```typescript
async autoGrade(submissionId: string) {
  // For each answer, lookup Problem.answerText
  // Compare studentAnswer with correct answer
  // Set isCorrect, calculate total score
}
```

**Step 3: Create controller**

```typescript
@Controller("submissions")
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubmissionsController {
  @Post()
  submit(@Body() dto: CreateSubmissionDto, @Request() req: AuthRequest) {}

  @Get()
  findAll(
    @Query("assignmentId") assignmentId?: string,
    @Query("studentId") studentId?: string,
  ) {}

  @Get(":id")
  findOne(@Param("id") id: string) {}

  @Post(":id/grade")
  @Roles("admin", "teacher")
  grade(@Param("id") id: string, @Body() dto: GradeSubmissionDto, @Request() req: AuthRequest) {}
}
```

**Step 4: Register & commit**

```bash
git add apps/lms-api/src/submissions/
git commit -m "feat: add submissions module with auto-grading"
```

---

### Task 7: Submission Photos Module (Vision LLM Trigger)

**Files:**
- Create: `apps/lms-api/src/submission-photos/submission-photos.module.ts`
- Create: `apps/lms-api/src/submission-photos/submission-photos.service.ts`
- Create: `apps/lms-api/src/submission-photos/submission-photos.controller.ts`
- Modify: `apps/lms-api/src/app.module.ts`

**Step 1: Create service**

Key methods:
- `uploadPhoto(submissionId, file)` — upload to S3, create SubmissionPhoto record, publish Redis event
- `onAnalysisCompleted(payload)` — Redis subscriber, save AI feedback, create notification

```typescript
async uploadPhoto(submissionId: string, file: Express.Multer.File) {
  const s3Key = `submissions/${submissionId}/${Date.now()}-${file.originalname}`;
  await this.s3.upload(s3Key, file.buffer);

  const photo = await this.prisma.submissionPhoto.create({
    data: { submissionId, s3Key, originalName: file.originalname },
  });

  // Get problem context for Vision LLM
  const submission = await this.prisma.submission.findUnique({
    where: { id: submissionId },
    include: { assignment: { include: { assignmentProblems: true } } },
  });

  // Publish to Redis for FastAPI worker
  await this.redis.publish("photo:analyze", JSON.stringify({
    submissionPhotoId: photo.id,
    s3Key,
    // Include problem context...
  }));

  return photo;
}
```

**Step 2: Create controller**

```typescript
@Controller("submissions/:submissionId/photos")
@UseGuards(JwtAuthGuard)
export class SubmissionPhotosController {
  @Post()
  @UseInterceptors(FileInterceptor("file"))
  upload(
    @Param("submissionId") submissionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: AuthRequest,
  ) {}

  @Get(":photoId")
  getPhoto(@Param("photoId") photoId: string) {}
}
```

**Step 3: Register & commit**

```bash
git add apps/lms-api/src/submission-photos/
git commit -m "feat: add submission-photos module with S3 upload and Redis event"
```

---

### Task 8: Parent Links Module

**Files:**
- Create: `apps/lms-api/src/parent-links/parent-links.module.ts`
- Create: `apps/lms-api/src/parent-links/parent-links.service.ts`
- Create: `apps/lms-api/src/parent-links/parent-links.controller.ts`
- Modify: `apps/lms-api/src/app.module.ts`

**Step 1: Create service**

Key methods:
- `generateInviteCode(studentId)` — generate a 6-digit code (stored in Redis with 24h TTL)
- `linkParent(parentId, inviteCode)` — verify code, create ParentStudent record
- `getChildren(parentId)` — list linked students with their enrollment info
- `getParents(studentId)` — list linked parents

**Step 2: Create controller**

```typescript
@Controller("parent-links")
@UseGuards(JwtAuthGuard)
export class ParentLinksController {
  @Post("invite")
  @Roles("admin", "teacher")
  generateInvite(@Body("studentId") studentId: string) {}

  @Post("link")
  @Roles("parent")
  linkChild(@Body("inviteCode") code: string, @Request() req: AuthRequest) {}

  @Get("children")
  @Roles("parent")
  getChildren(@Request() req: AuthRequest) {}
}
```

**Step 3: Register & commit**

```bash
git add apps/lms-api/src/parent-links/
git commit -m "feat: add parent-links module with invite code system"
```

---

### Task 9: Notifications Module

**Files:**
- Create: `apps/lms-api/src/notifications/notifications.module.ts`
- Create: `apps/lms-api/src/notifications/notifications.service.ts`
- Create: `apps/lms-api/src/notifications/notifications.controller.ts`
- Modify: `apps/lms-api/src/app.module.ts`

**Step 1: Create service**

Key methods:
- `create(userId, type, title, body, ref?)` — create notification
- `createBulk(userIds[], type, title, body, ref?)` — notify multiple users
- `findByUser(userId, unreadOnly?)` — list notifications
- `markAsRead(id, userId)` — mark single notification read
- `markAllRead(userId)` — mark all as read
- `notifyParents(studentId, type, title, body)` — find all linked parents and notify

Notification triggers (called from other services):
- Lesson created/cancelled → notify enrolled students + parents
- Assignment created → notify enrolled students + parents
- Submission graded → notify student + parents
- Photo analysis completed → notify student

**Step 2: Create controller**

```typescript
@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  @Get()
  findAll(@Request() req: AuthRequest, @Query("unread") unread?: string) {}

  @Get("count")
  unreadCount(@Request() req: AuthRequest) {}

  @Patch(":id/read")
  markRead(@Param("id") id: string, @Request() req: AuthRequest) {}

  @Patch("read-all")
  markAllRead(@Request() req: AuthRequest) {}
}
```

**Step 3: Register & commit**

```bash
git add apps/lms-api/src/notifications/
git commit -m "feat: add notifications module"
```

---

### Task 10: Analytics Module

**Files:**
- Create: `apps/lms-api/src/analytics/analytics.module.ts`
- Create: `apps/lms-api/src/analytics/analytics.service.ts`
- Create: `apps/lms-api/src/analytics/analytics.controller.ts`
- Modify: `apps/lms-api/src/app.module.ts`

**Step 1: Create service**

Key methods:
- `getStudentReport(studentId, classId?)` — aggregate submission data:
  - Overall accuracy rate
  - Accuracy by unit (unitMajor)
  - Weak topics (lowest accuracy units)
  - Score trend over time (last N assignments)
  - Common error types from AI feedback
  - AI-generated study recommendations
- `getClassReport(classId)` — aggregate class data:
  - Average scores per assignment
  - Student ranking
  - Most common weak units
  - Assignment completion rates

```typescript
async getStudentReport(studentId: string, classId?: string) {
  const submissions = await this.prisma.submission.findMany({
    where: {
      studentId,
      ...(classId ? { assignment: { classId } } : {}),
      status: "graded",
    },
    include: {
      answers: { include: { /* problem for unit info */ } },
      assignment: true,
    },
    orderBy: { submittedAt: "asc" },
  });

  // Aggregate by unit
  const unitAccuracy = this.calculateUnitAccuracy(submissions);
  // Calculate trend
  const scoreTrend = this.calculateScoreTrend(submissions);
  // Find weak topics
  const weakTopics = this.findWeakTopics(unitAccuracy);

  return { unitAccuracy, scoreTrend, weakTopics, totalSubmissions: submissions.length };
}
```

**Step 2: Create controller**

```typescript
@Controller("analytics")
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  @Get("student/:studentId")
  studentReport(
    @Param("studentId") studentId: string,
    @Query("classId") classId?: string,
    @Request() req: AuthRequest,
  ) {}
  // Parent can access their children's reports
  // Teacher can access any enrolled student's report

  @Get("class/:classId")
  @Roles("admin", "teacher")
  classReport(@Param("classId") classId: string) {}
}
```

**Step 3: Register & commit**

```bash
git add apps/lms-api/src/analytics/
git commit -m "feat: add analytics module with student/class reports"
```

---

## Phase 3: Vision LLM Pipeline (FastAPI)

### Task 11: Photo Analysis Celery Worker

**Files:**
- Create: `apps/ocr-api/app/workers/analyze_photo.py`
- Modify: `apps/ocr-api/app/celery_app.py` (register task)
- Modify: `apps/ocr-api/app/config.py` (add Vision LLM config)

**Step 1: Create worker**

```python
import anthropic
from app.celery_app import celery
from app.config import settings

@celery.task(name="analyze_submission_photo")
def analyze_submission_photo(payload: dict):
    """
    Analyze student's handwritten solution photo using Vision LLM.

    payload: {
        submissionPhotoId: str,
        s3Key: str,
        problemStemLatex: str,
        answerText: str | None,
        answerLatex: str | None,
        solutionSteps: list | None,
    }
    """
    # 1. Download image from S3
    image_bytes = download_from_s3(payload["s3Key"])

    # 2. Call Vision LLM (Claude latest)
    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    system_prompt = """You are a math tutor analyzing a student's handwritten solution.
    Compare with the correct answer and provide detailed step-by-step feedback.
    Respond in Korean. Return JSON only."""

    response = client.messages.create(
        model="claude-sonnet-4-6-20250514",
        max_tokens=2000,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64_image}},
                {"type": "text", "text": f"""
                문제: {payload["problemStemLatex"]}
                정답: {payload.get("answerText") or payload.get("answerLatex")}

                위 문제에 대한 학생의 풀이 사진입니다.
                JSON으로 분석해주세요: {{
                    "isCorrect": bool,
                    "score": number (0-10),
                    "maxScore": 10,
                    "steps": [{{ "step": n, "content": "학생이 쓴 내용", "correct": bool, "feedback": "틀렸으면 설명" }}],
                    "errorType": "sign_error|calculation_error|concept_error|...|null",
                    "conceptHint": "관련 개념 힌트",
                    "overallFeedback": "전체 피드백"
                }}"""}
            ],
        }],
    )

    feedback = parse_json_response(response)

    # 3. Update DB via direct SQLAlchemy
    update_submission_photo(payload["submissionPhotoId"], feedback)

    # 4. Publish completion event to Redis
    publish_redis("photo:analysis:completed", {
        "submissionPhotoId": payload["submissionPhotoId"],
        "feedback": feedback,
    })
```

**Step 2: Add Redis subscriber in NestJS**

In `submission-photos.service.ts`, subscribe to `photo:analysis:completed`:
- Update SubmissionPhoto with feedback
- Create notification for student
- Notify parents

**Step 3: Commit**

```bash
git add apps/ocr-api/app/workers/analyze_photo.py
git commit -m "feat: add Vision LLM photo analysis worker"
```

---

## Phase 4: Web Frontend Updates

### Task 12: Rename Courses → Classes in Web Frontend

**Files:**
- Delete: `apps/web/src/app/(authenticated)/courses/`
- Create: `apps/web/src/app/(authenticated)/classes/page.tsx`
- Modify: `apps/web/src/components/layout/app-sidebar.tsx`
- Modify: `apps/web/src/lib/api.ts` (if course endpoints exist)

**Step 1: Update sidebar navigation**

In `app-sidebar.tsx`:
```typescript
const mainNav = [
  { title: "대시보드", href: "/dashboard", icon: LayoutDashboard },
  { title: "반 관리", href: "/classes", icon: BookOpen },
  { title: "캘린더", href: "/calendar", icon: Calendar },
  { title: "문제은행", href: "/problems", icon: FileText },
  { title: "과제/채점", href: "/assignments", icon: GraduationCap },
];
```

**Step 2: Create classes page with real API**

Replace mock data with React Query fetching from `/v1/classes`.

**Step 3: Commit**

```bash
git add apps/web/
git commit -m "refactor: rename courses → classes in web frontend"
```

---

### Task 13: Add Calendar Page (Web - Teacher)

**Files:**
- Create: `apps/web/src/app/(authenticated)/calendar/page.tsx`
- Install: shadcn calendar component if not already installed

**Step 1: Install dependencies**

```bash
cd apps/web && npx shadcn@latest add calendar
```

**Step 2: Build calendar page**

Features:
- Monthly/weekly view toggle
- Show lessons from `/v1/lessons/calendar?start=...&end=...`
- Click to create new lesson
- Click lesson to edit/cancel
- Color-code by class
- Show lesson status (scheduled/completed/cancelled)

Use `@/components/ui/calendar` as base, add event overlay.

**Step 3: Commit**

```bash
git add apps/web/
git commit -m "feat: add teacher calendar page with lesson management"
```

---

### Task 14: Add Assignments Management Page (Web - Teacher)

**Files:**
- Rewrite: `apps/web/src/app/(authenticated)/quizzes/page.tsx` → move to `assignments/page.tsx`
- Create: `apps/web/src/app/(authenticated)/assignments/[id]/page.tsx`

**Step 1: Build assignments list page**

Replace mock data. Features:
- List assignments by class
- Create new assignment (problem_set or text_task)
- For problem_set: search/select problems from problem bank
- Show submission count, average score
- Link to detail page

**Step 2: Build assignment detail page**

Features:
- View all submissions for this assignment
- Grade submissions (manual scoring)
- View photo submissions with AI feedback
- Score distribution chart

**Step 3: Commit**

```bash
git add apps/web/
git commit -m "feat: add assignments management pages"
```

---

## Phase 5: Mobile App (Expo)

### Task 15: Initialize Expo Project

**Step 1: Create Expo app**

```bash
cd apps && npx create-expo-app@latest mobile --template tabs
cd mobile
```

**Step 2: Install core dependencies**

```bash
npx expo install expo-router expo-camera expo-image-picker expo-notifications expo-secure-store
npx expo install nativewind tailwindcss react-native-reanimated
npx expo install react-native-calendars react-native-svg victory-native
npx expo install @tanstack/react-query
```

**Step 3: Configure NativeWind (Tailwind for RN)**

Create `tailwind.config.js`, update `babel.config.js` for NativeWind.

**Step 4: Set up API client**

Create `lib/api.ts` with:
- Base URL configuration (env-based)
- JWT token management via SecureStore
- Same pattern as web api.ts but using SecureStore instead of localStorage

**Step 5: Set up auth context**

Create `lib/auth.tsx` with:
- Login/register functions
- Token persistence via SecureStore
- User state management
- Role-based navigation redirect

**Step 6: Commit**

```bash
git add apps/mobile/
git commit -m "feat: initialize Expo mobile app with core dependencies"
```

---

### Task 16: Mobile Auth Screens

**Files:**
- Create: `apps/mobile/app/(auth)/login.tsx`
- Create: `apps/mobile/app/(auth)/register.tsx`
- Create: `apps/mobile/app/(auth)/_layout.tsx`

**Step 1: Build login screen**

- Email + password input
- Login button
- Link to register
- Role-based redirect after login:
  - student → `/(student)/home`
  - parent → `/(parent)/home`
  - teacher → `/(teacher)/home`

**Step 2: Build register screen**

- Name, email, password, role selector (student/parent)
- Teacher registration might require invite code

**Step 3: Commit**

```bash
git add apps/mobile/app/(auth)/
git commit -m "feat: add mobile auth screens"
```

---

### Task 17: Student Screens

**Files:**
- Create: `apps/mobile/app/(student)/_layout.tsx` — bottom tab navigator
- Create: `apps/mobile/app/(student)/home.tsx`
- Create: `apps/mobile/app/(student)/calendar.tsx`
- Create: `apps/mobile/app/(student)/assignments.tsx`
- Create: `apps/mobile/app/(student)/assignment/[id].tsx`
- Create: `apps/mobile/app/(student)/report.tsx`

**Step 1: Tab layout**

Bottom tabs: 홈, 캘린더, 과제, 성적

**Step 2: Home screen**

- Today's lessons (from calendar API)
- Pending assignments count
- Recent notifications
- Quick action: "과제 제출" button

**Step 3: Calendar screen**

- Monthly calendar view using `react-native-calendars`
- Dots on dates with lessons
- Tap date → show lesson details
- Color coding by class

**Step 4: Assignments screen**

- List of assignments grouped by class
- Status: pending / submitted / graded
- Tap → assignment detail

**Step 5: Assignment detail screen**

- Problem display (LaTeX rendering via WebView + KaTeX)
- For problem_set: answer input per problem
- For text_task: completion checkbox + optional photo upload
- Camera button → take photo of solution → upload
- Submit button
- After grading: show score, AI feedback per photo

**Step 6: Report screen**

- Overall score summary
- Accuracy by unit (bar chart via victory-native)
- Score trend (line chart)
- Weak topics list
- AI study recommendations

**Step 7: Commit**

```bash
git add apps/mobile/app/(student)/
git commit -m "feat: add student mobile screens"
```

---

### Task 18: Parent Screens

**Files:**
- Create: `apps/mobile/app/(parent)/_layout.tsx`
- Create: `apps/mobile/app/(parent)/home.tsx`
- Create: `apps/mobile/app/(parent)/calendar.tsx`
- Create: `apps/mobile/app/(parent)/children/[id].tsx`
- Create: `apps/mobile/app/(parent)/notifications.tsx`

**Step 1: Tab layout**

Bottom tabs: 홈, 캘린더, 알림

**Step 2: Home screen**

- Children list with summary cards
- Each child: next lesson, pending assignments count, latest grade
- Tap child → detail report

**Step 3: Calendar screen**

- Combined calendar for all children
- Different colors per child
- Tap → lesson details

**Step 4: Child detail screen**

- Same as student report but read-only
- Score trend, unit accuracy, weak topics

**Step 5: Notifications screen**

- List of all notifications
- Lesson schedule changes, assignment grades, etc.
- Pull-to-refresh

**Step 6: Commit**

```bash
git add apps/mobile/app/(parent)/
git commit -m "feat: add parent mobile screens"
```

---

### Task 19: Teacher Mobile Screens

**Files:**
- Create: `apps/mobile/app/(teacher)/_layout.tsx`
- Create: `apps/mobile/app/(teacher)/home.tsx`
- Create: `apps/mobile/app/(teacher)/calendar.tsx`
- Create: `apps/mobile/app/(teacher)/classes.tsx`
- Create: `apps/mobile/app/(teacher)/class/[id].tsx`
- Create: `apps/mobile/app/(teacher)/assignment/new.tsx`
- Create: `apps/mobile/app/(teacher)/grading.tsx`

**Step 1: Tab layout**

Bottom tabs: 홈, 캘린더, 반 관리, 채점

**Step 2: Home screen**

- Today's schedule summary
- Pending grading count
- Quick actions: create lesson, create assignment

**Step 3: Calendar screen**

- Full calendar with lesson management
- Long press date → create lesson
- Tap lesson → edit/cancel/complete
- Swipe to cancel

**Step 4: Classes screen**

- List of all classes
- Student count, next lesson
- Tap → class detail

**Step 5: Class detail screen**

- Student list
- Assignments for this class
- Create assignment (link to problem bank or text task)
- Class analytics summary

**Step 6: Create assignment screen**

- Title, type (problem_set/text_task), due date
- For problem_set: simplified problem selector (search + add)
- For text_task: description text field

**Step 7: Grading screen**

- List of pending submissions
- Quick grade view: student answer vs correct answer
- Score input, feedback input
- Photo submissions: view photo + AI feedback, confirm/override score

**Step 8: Commit**

```bash
git add apps/mobile/app/(teacher)/
git commit -m "feat: add teacher mobile screens"
```

---

### Task 20: Push Notifications Setup

**Files:**
- Modify: `apps/mobile/app/_layout.tsx` — register push token on app start
- Create: `apps/mobile/lib/notifications.ts` — push token management
- Modify: `apps/lms-api/src/notifications/notifications.service.ts` — send push via Expo Push API

**Step 1: Register push token on mobile**

```typescript
import * as Notifications from "expo-notifications";

async function registerPushToken() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return;
  const token = await Notifications.getExpoPushTokenAsync();
  // Send token to backend: POST /v1/users/me/push-token
  await api.post("/users/me/push-token", { token: token.data });
}
```

**Step 2: Add push-token endpoint to NestJS**

Store push token in User model (add `pushToken String?` field).

**Step 3: Send push from NestJS**

```typescript
import { Expo } from "expo-server-sdk";

async sendPush(userId: string, title: string, body: string) {
  const user = await this.prisma.user.findUnique({ where: { id: userId } });
  if (!user?.pushToken) return;

  const expo = new Expo();
  await expo.sendPushNotificationsAsync([{
    to: user.pushToken,
    title,
    body,
    data: { type: "notification" },
  }]);
}
```

**Step 4: Commit**

```bash
git add apps/mobile/ apps/lms-api/
git commit -m "feat: add Expo push notifications"
```

---

## Phase 6: Integration & Polish

### Task 21: Update Web Dashboard

**Files:**
- Modify: `apps/web/src/app/(authenticated)/dashboard/page.tsx`

Update dashboard to show:
- Total Classes (not Courses)
- Today's lessons
- Pending submissions to grade
- Recent assignment scores

### Task 22: Workspace Configuration

**Files:**
- Modify: `package.json` (root) — add `dev:mobile` script
- Modify: `pnpm-workspace.yaml` — add `apps/mobile`

```json
"dev:mobile": "cd apps/mobile && npx expo start"
```

### Task 23: End-to-End Smoke Test

Manual verification checklist:
1. Teacher creates a class via web
2. Teacher creates a recurring lesson (Tue/Thu 7pm)
3. Calendar shows lessons correctly
4. Teacher creates an assignment (problem_set) selecting problems from bank
5. Student sees assignment on mobile app
6. Student submits answers (online) → auto-graded
7. Student takes photo of solution → Vision LLM analyzes
8. Student sees AI feedback
9. Parent sees child's calendar + grades + AI feedback
10. Teacher sees grading dashboard, can override scores
11. Analytics show accuracy by unit + trend
12. Push notifications arrive for lesson/assignment/grade events

---

## Execution Dependencies

```
Task 1 (Schema rename) → Task 2 (New models) → Task 3 (NestJS rename) → Task 4 (Shared types)
                                                                              ↓
                                                    ┌─────────────────────────┼─────────────────────────┐
                                                    ↓                         ↓                         ↓
                                              Task 5 (Lessons)         Task 6 (Submissions)     Task 8 (Parent links)
                                                    ↓                    ↓          ↓                   ↓
                                              Task 13 (Web Cal)    Task 7 (Photos) Task 14 (Web Assign) Task 9 (Notifications)
                                                                        ↓                               ↓
                                                                  Task 11 (Vision LLM)          Task 10 (Analytics)
                                                                        ↓                               ↓
                                                    ┌───────────────────┴───────────────────┐            ↓
                                                    ↓                                       ↓            ↓
                                              Task 15 (Expo init) → Task 16 (Auth) → Tasks 17-19 (Screens)
                                                                                            ↓
                                                                                    Task 20 (Push)
                                                                                            ↓
                                                                                    Tasks 21-23 (Polish)
```

## Team Assignment Recommendation

| Agent | Tasks | Role |
|-------|-------|------|
| **db-architect** | 1, 2 | Schema design, migration |
| **lms-backend-architect** | 3, 4, 5, 6, 7, 8, 9, 10 | NestJS modules |
| **ocr-pipeline** | 11 | Vision LLM worker |
| **frontend-ui** | 12, 13, 14, 21 | Web frontend updates |
| **mobile-dev** (new) | 15, 16, 17, 18, 19, 20 | Expo mobile app |
| **project-manager** | 22, 23 | Integration, testing |
