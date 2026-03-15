# Exam Document Sharing & Assignment Integration

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow teachers to share exam documents (시험지/교재) within their organization and create assignments directly from them, with optional PDF attachment for students.

**Architecture:** Add `visibility` field to `ExamDocument` for public/private control. Extend `Assignment` with optional `examDocumentId` and `attachPdf` fields. New API endpoints for duplicate and assign-from-exam. Frontend adds tabs to history page and "import from exam" flow to assignment creation.

**Tech Stack:** Prisma (schema), NestJS (API), Next.js 15 (frontend)

---

## File Structure

### Modified Files
- `packages/db-schema/prisma/schema.prisma` — add `visibility` to ExamDocument, add `examDocumentId`/`attachPdf` to Assignment
- `apps/lms-api/src/exam-documents/dto/create-exam-document.dto.ts` — add `visibility` field
- `apps/lms-api/src/exam-documents/exam-documents.controller.ts` — add `scope` query, `duplicate`, `assign` endpoints
- `apps/lms-api/src/exam-documents/exam-documents.service.ts` — add `findAll` scope filtering, `duplicate`, `assign` methods
- `apps/lms-api/src/assignments/dto/create-assignment.dto.ts` — add `examDocumentId`, `attachPdf`
- `apps/lms-api/src/assignments/assignments.service.ts` — handle `examDocumentId` in create
- `apps/lms-api/src/assignments/assignments.controller.ts` — expose `attachPdf` download for students
- `apps/web/src/app/(authenticated)/exam-builder/history/page.tsx` — tabs, shared list, action buttons
- `apps/web/src/app/(authenticated)/assignments/page.tsx` — "import from exam" button

### New Files
- `packages/db-schema/prisma/migrations/YYYYMMDD_exam_document_sharing/migration.sql` — auto-generated
- `apps/lms-api/src/exam-documents/dto/assign-from-exam.dto.ts` — DTO for assign endpoint

---

## Task 1: Database Schema — Add Visibility and Assignment Link

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`

- [ ] **Step 1: Add visibility to ExamDocument model**

In `packages/db-schema/prisma/schema.prisma`, add after `creatorId` line (line 194):

```prisma
  visibility      ExamDocumentVisibility @default(private)
```

Add the enum after `ExamDocumentStatus` (line 240):

```prisma
enum ExamDocumentVisibility {
  private
  public

  @@schema("public")
}
```

Add index for shared queries after the existing `@@index([status])`:

```prisma
  @@index([visibility])
```

- [ ] **Step 2: Add examDocumentId and attachPdf to Assignment model**

In `packages/db-schema/prisma/schema.prisma`, add to `Assignment` model after `sourceAssignmentId` (line 100):

```prisma
  examDocumentId     String?             @map("exam_document_id")
  examDocument       ExamDocument?       @relation(fields: [examDocumentId], references: [id])
  attachPdf          Boolean             @default(false) @map("attach_pdf")
```

Add reverse relation to `ExamDocument` model, after `problems` field (line 203):

```prisma
  assignments     Assignment[]
```

- [ ] **Step 3: Run migration**

```bash
cd packages/db-schema && pnpm db:migrate --name exam_document_sharing
```

- [ ] **Step 4: Regenerate Prisma client**

```bash
pnpm --filter @jsmath/db-schema db:generate
```

- [ ] **Step 5: Verify**

```bash
cd packages/db-schema && npx prisma validate
```

- [ ] **Step 6: Commit**

```bash
git add packages/db-schema/
git commit -m "feat: add exam document visibility and assignment link schema"
```

---

## Task 2: Backend — ExamDocument Sharing API

**Files:**
- Modify: `apps/lms-api/src/exam-documents/dto/create-exam-document.dto.ts`
- Create: `apps/lms-api/src/exam-documents/dto/assign-from-exam.dto.ts`
- Modify: `apps/lms-api/src/exam-documents/exam-documents.service.ts`
- Modify: `apps/lms-api/src/exam-documents/exam-documents.controller.ts`

- [ ] **Step 1: Add visibility to CreateExamDocumentDto**

In `apps/lms-api/src/exam-documents/dto/create-exam-document.dto.ts`, add:

```typescript
  @IsIn(["private", "public"])
  @IsOptional()
  visibility?: "private" | "public";
```

- [ ] **Step 2: Create AssignFromExamDto**

Create `apps/lms-api/src/exam-documents/dto/assign-from-exam.dto.ts`:

```typescript
import { IsString, IsNotEmpty, IsOptional, IsDateString, IsBoolean, IsInt, Min } from "class-validator";

export class AssignFromExamDto {
  @IsString()
  @IsNotEmpty()
  classId: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsDateString()
  @IsOptional()
  dueAt?: string;

  @IsBoolean()
  @IsOptional()
  attachPdf?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxScore?: number;
}
```

- [ ] **Step 3: Update ExamDocumentsService — create with visibility**

In `apps/lms-api/src/exam-documents/exam-documents.service.ts`, update the `create` method. In the `prisma.examDocument.create` call (line 286), add `visibility` to `data`:

```typescript
  data: {
    title: dto.title,
    type: dto.type,
    creatorId: userId,
    visibility: dto.visibility ?? "private",
    headerConfig: dto.headerConfig ?? undefined,
    // ... rest unchanged
  },
```

- [ ] **Step 4: Update ExamDocumentsService — findAll with scope**

Replace the existing `findAll` method (line 320-328) with:

```typescript
  async findAll(userId: string, scope: "mine" | "shared" | "all" = "mine") {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true },
    });

    let where: Record<string, unknown>;

    if (scope === "mine") {
      where = { creatorId: userId };
    } else if (scope === "shared") {
      // Public documents from same organization, excluding own
      where = {
        visibility: "public",
        creatorId: { not: userId },
        creator: { organizationId: user?.organizationId ?? "__none__" },
      };
    } else {
      // All = mine + shared
      where = {
        OR: [
          { creatorId: userId },
          {
            visibility: "public",
            creator: { organizationId: user?.organizationId ?? "__none__" },
          },
        ],
      };
    }

    return this.prisma.examDocument.findMany({
      where,
      include: {
        _count: { select: { problems: true } },
        creator: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }
```

- [ ] **Step 5: Update ExamDocumentsService — findById with shared access**

Replace the `findById` method (line 330-344) to allow access to public documents within the same org:

```typescript
  async findById(id: string, userId: string) {
    const doc = await this.prisma.examDocument.findUnique({
      where: { id },
      include: {
        problems: { orderBy: { orderIndex: "asc" } },
        creator: { select: { id: true, name: true, organizationId: true } },
      },
    });
    if (!doc) throw new NotFoundException("Document not found");

    // Allow access if: owner, or public + same org
    if (doc.creatorId !== userId) {
      if (doc.visibility !== "public") {
        throw new ForbiddenException("Not authorized");
      }
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { organizationId: true },
      });
      if (doc.creator.organizationId !== user?.organizationId) {
        throw new ForbiddenException("Not authorized");
      }
    }

    return doc;
  }
```

- [ ] **Step 6: Add getDownloadUrl — allow shared access**

Update `getDownloadUrl` to call the updated `findById` (already does, so no change needed — `findById` now handles shared access).

- [ ] **Step 7: Add duplicate method**

Add to `ExamDocumentsService`:

```typescript
  async duplicate(id: string, userId: string, userRole: string) {
    const doc = await this.findById(id, userId);

    const newDoc = await this.prisma.examDocument.create({
      data: {
        title: `${doc.title} (복사본)`,
        type: doc.type,
        creatorId: userId,
        visibility: "private",
        headerConfig: doc.headerConfig ?? undefined,
        layoutConfig: doc.layoutConfig,
        coverConfig: doc.coverConfig ?? undefined,
        status: "draft",
        problems: {
          create: doc.problems.map((p, i) => ({
            problemId: p.problemId,
            orderIndex: i,
          })),
        },
      },
      include: {
        _count: { select: { problems: true } },
        creator: { select: { id: true, name: true } },
      },
    });

    // Auto-generate PDF
    await this.pdfQueue.add("generate", {
      documentId: newDoc.id,
      generateAnswerSheet: true,
    });

    await this.prisma.examDocument.update({
      where: { id: newDoc.id },
      data: { status: "generating" },
    });

    return { ...newDoc, status: "generating" };
  }
```

- [ ] **Step 8: Add assign method**

Add to `ExamDocumentsService`:

```typescript
  async assign(
    examDocumentId: string,
    dto: { classId: string; title?: string; dueAt?: string; attachPdf?: boolean; maxScore?: number },
    userId: string,
    userRole: string,
  ) {
    const doc = await this.findById(examDocumentId, userId);

    if (doc.problems.length === 0) {
      throw new BadRequestException("Document has no problems");
    }

    const assignment = await this.prisma.assignment.create({
      data: {
        title: dto.title ?? doc.title,
        classId: dto.classId,
        type: "problem_set",
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        maxScore: dto.maxScore ?? 100,
        examDocumentId,
        attachPdf: dto.attachPdf ?? false,
        assignmentProblems: {
          create: doc.problems.map((p, i) => ({
            problemId: p.problemId,
            orderIndex: i,
          })),
        },
      },
      include: {
        assignmentProblems: true,
        class: { select: { id: true, title: true } },
      },
    });

    return assignment;
  }
```

- [ ] **Step 9: Update controller — add scope, duplicate, assign endpoints**

In `apps/lms-api/src/exam-documents/exam-documents.controller.ts`:

Add import for `AssignFromExamDto`:
```typescript
import { AssignFromExamDto } from "./dto/assign-from-exam.dto";
```

Update `findAll`:
```typescript
  @Get()
  findAll(
    @Query("scope") scope: "mine" | "shared" | "all" = "mine",
    @Request() req: AuthRequest,
  ) {
    return this.examDocuments.findAll(req.user.id, scope);
  }
```

Add new endpoints before `remove`:
```typescript
  @Post(":id/duplicate")
  duplicate(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.examDocuments.duplicate(id, req.user.id, req.user.role);
  }

  @Post(":id/assign")
  assign(
    @Param("id") id: string,
    @Body() dto: AssignFromExamDto,
    @Request() req: AuthRequest,
  ) {
    return this.examDocuments.assign(id, dto, req.user.id, req.user.role);
  }
```

- [ ] **Step 10: Verify compilation**

```bash
pnpm --filter lms-api build
```

- [ ] **Step 11: Commit**

```bash
git add apps/lms-api/src/exam-documents/
git commit -m "feat: add exam document sharing, duplicate, and assign APIs"
```

---

## Task 3: Backend — Assignment Integration

**Files:**
- Modify: `apps/lms-api/src/assignments/dto/create-assignment.dto.ts`
- Modify: `apps/lms-api/src/assignments/assignments.service.ts`
- Modify: `apps/lms-api/src/assignments/assignments.controller.ts`

- [ ] **Step 1: Add examDocumentId and attachPdf to CreateAssignmentDto**

In `apps/lms-api/src/assignments/dto/create-assignment.dto.ts`, add:

```typescript
  @IsString()
  @IsOptional()
  examDocumentId?: string;

  @IsBoolean()
  @IsOptional()
  attachPdf?: boolean;
```

Add `IsBoolean` to the import.

- [ ] **Step 2: Update AssignmentsService.create — handle examDocumentId**

In `apps/lms-api/src/assignments/assignments.service.ts`, find the `create` method. After the assignment is created with `prisma.assignment.create`, if `dto.examDocumentId` is provided and `dto.problemIds` is empty, auto-populate problems from the exam document:

```typescript
  // Inside create method, add to the create data:
  examDocumentId: dto.examDocumentId ?? undefined,
  attachPdf: dto.attachPdf ?? false,
```

When `dto.examDocumentId` is set and no `dto.problemIds` provided, fetch problems from the exam document and create `assignmentProblems`:

```typescript
  if (dto.examDocumentId && (!dto.problemIds || dto.problemIds.length === 0)) {
    const examDoc = await this.prisma.examDocument.findUnique({
      where: { id: dto.examDocumentId },
      include: { problems: { orderBy: { orderIndex: "asc" } } },
    });
    if (examDoc) {
      await this.prisma.assignmentProblem.createMany({
        data: examDoc.problems.map((p, i) => ({
          assignmentId: assignment.id,
          problemId: p.problemId,
          orderIndex: i,
        })),
      });
    }
  }
```

- [ ] **Step 3: Add PDF download endpoint for students**

In `apps/lms-api/src/assignments/assignments.controller.ts`, add an endpoint that lets students download the attached PDF:

```typescript
  @Get("assignments/:id/exam-pdf")
  getExamPdf(
    @Param("id") id: string,
    @Request() req: AuthRequest,
  ) {
    return this.assignments.getExamPdf(id, req.user.id, req.user.role);
  }
```

In `assignments.service.ts`, add:

```typescript
  async getExamPdf(assignmentId: string, userId: string, userRole: string) {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        examDocument: true,
        class: { include: { enrollments: { select: { userId: true } } } },
      },
    });
    if (!assignment) throw new NotFoundException("Assignment not found");

    // Check access: teacher/admin of the class, or enrolled student
    const isTeacher = isPrivilegedRole(userRole);
    const isEnrolled = assignment.class.enrollments.some((e) => e.userId === userId);
    if (!isTeacher && !isEnrolled) throw new ForbiddenException("Not authorized");

    if (!assignment.attachPdf || !assignment.examDocument?.pdfS3Key) {
      throw new NotFoundException("PDF not available for this assignment");
    }

    const s3 = new S3Client({
      region: this.config.get("AWS_REGION", "ap-northeast-2"),
      ...(this.config.get("AWS_ENDPOINT")
        ? { endpoint: this.config.get("AWS_ENDPOINT"), forcePathStyle: true }
        : {}),
    });
    const command = new GetObjectCommand({
      Bucket: this.config.getOrThrow("S3_BUCKET"),
      Key: assignment.examDocument.pdfS3Key,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    return { url };
  }
```

Add the necessary imports to `assignments.service.ts`:
```typescript
import { ConfigService } from "@nestjs/config";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
```

And inject `ConfigService` in the constructor:
```typescript
constructor(
  private prisma: PrismaService,
  private config: ConfigService,
) {}
```

- [ ] **Step 4: Verify compilation**

```bash
pnpm --filter lms-api build
```

- [ ] **Step 5: Commit**

```bash
git add apps/lms-api/src/assignments/
git commit -m "feat: add exam document reference and PDF attachment to assignments"
```

---

## Task 4: Frontend — Exam Document History with Sharing

**Files:**
- Modify: `apps/web/src/app/(authenticated)/exam-builder/history/page.tsx`

- [ ] **Step 1: Update interface and add tab state**

Replace the `ExamDocument` interface and add tab state at the top of the component:

```typescript
interface ExamDocument {
  id: string;
  title: string;
  type: "exam" | "workbook";
  status: "draft" | "generating" | "completed" | "failed";
  visibility: "private" | "public";
  pdfS3Key: string | null;
  answerPdfS3Key: string | null;
  errorMessage: string | null;
  createdAt: string;
  _count?: { problems: number };
  creator?: { id: string; name: string };
}
```

Add state for active tab:
```typescript
const [tab, setTab] = useState<"mine" | "shared">("mine");
```

- [ ] **Step 2: Update query to use scope**

```typescript
const { data: documents, isLoading, isError } = useQuery({
  queryKey: ["exam-documents", tab],
  queryFn: () => api.get<ExamDocument[]>(`/exam-documents?scope=${tab}`),
});
```

- [ ] **Step 3: Add tab UI**

After the page header, before the document list, add tabs:

```tsx
<div className="flex gap-1 rounded-lg bg-muted p-1">
  <button
    className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
      tab === "mine" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
    }`}
    onClick={() => setTab("mine")}
  >
    내 시험지
  </button>
  <button
    className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
      tab === "shared" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
    }`}
    onClick={() => setTab("shared")}
  >
    공유된 시험지
  </button>
</div>
```

- [ ] **Step 4: Add duplicate and assign mutations**

```typescript
const duplicateMutation = useMutation({
  mutationFn: (id: string) => api.post(`/exam-documents/${id}/duplicate`),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["exam-documents"] });
    setTab("mine");
  },
});

const [assignTarget, setAssignTarget] = useState<ExamDocument | null>(null);
```

- [ ] **Step 5: Add action buttons to each document card**

In the card actions area (after download buttons), add for shared docs:

```tsx
{tab === "shared" && doc.status === "completed" && (
  <>
    {doc.pdfS3Key && (
      <Button variant="ghost" size="sm" onClick={() => handleDownload(doc.id, "pdf")}>
        <Download className="h-4 w-4 mr-1" />
        PDF
      </Button>
    )}
    <Button
      variant="ghost"
      size="sm"
      onClick={() => duplicateMutation.mutate(doc.id)}
      disabled={duplicateMutation.isPending}
    >
      <Copy className="h-4 w-4 mr-1" />
      복제
    </Button>
  </>
)}

<Button variant="ghost" size="sm" onClick={() => setAssignTarget(doc)}>
  <Send className="h-4 w-4 mr-1" />
  과제 출제
</Button>
```

Add `Copy`, `Send` to lucide-react imports.

Show creator name for shared docs in the card metadata:
```tsx
{tab === "shared" && doc.creator && (
  <>
    <span>&middot;</span>
    <span>{doc.creator.name}</span>
  </>
)}
```

- [ ] **Step 6: Add "과제 출제" modal (AssignDialog)**

Add a Dialog component at the bottom of the page, controlled by `assignTarget`:

```tsx
{assignTarget && (
  <AssignFromExamDialog
    doc={assignTarget}
    onClose={() => setAssignTarget(null)}
  />
)}
```

Create the `AssignFromExamDialog` component inline in the same file (or extract later):

```tsx
function AssignFromExamDialog({
  doc,
  onClose,
}: {
  doc: ExamDocument;
  onClose: () => void;
}) {
  const [classId, setClassId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [attachPdf, setAttachPdf] = useState(false);
  const queryClient = useQueryClient();

  const { data: classes } = useQuery({
    queryKey: ["classes"],
    queryFn: () => api.get<Array<{ id: string; title: string }>>("/classes"),
  });

  const assignMutation = useMutation({
    mutationFn: () =>
      api.post(`/exam-documents/${doc.id}/assign`, {
        classId,
        title: doc.title,
        dueAt: dueAt || undefined,
        attachPdf,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>과제로 출제</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            &ldquo;{doc.title}&rdquo; ({doc._count?.problems ?? 0}문제)
          </p>

          <div>
            <label className="text-sm font-medium">반 선택</label>
            <select
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              <option value="">선택하세요</option>
              {classes?.map((c) => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">마감일 (선택)</label>
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={attachPdf}
              onChange={(e) => setAttachPdf(e.target.checked)}
            />
            <span className="text-sm">학생에게 PDF 첨부</span>
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>취소</Button>
          <Button
            onClick={() => assignMutation.mutate()}
            disabled={!classId || assignMutation.isPending}
          >
            {assignMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            출제
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

Add Dialog imports:
```typescript
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
```

- [ ] **Step 7: Add visibility toggle to exam builder create page**

In `apps/web/src/app/(authenticated)/exam-builder/page.tsx`, find where `headerConfig` is set in the settings step. Add a visibility toggle:

```tsx
<label className="flex items-center gap-2">
  <input
    type="checkbox"
    checked={visibility === "public"}
    onChange={(e) => setVisibility(e.target.checked ? "public" : "private")}
  />
  <span className="text-sm">다른 선생님에게 공개</span>
</label>
```

Pass `visibility` in the create API call body.

- [ ] **Step 8: Verify frontend**

```bash
pnpm dev:web
# Navigate to /exam-builder/history
# Check "내 시험지" / "공유된 시험지" tabs
# Check action buttons (다운로드/복제/과제 출제)
```

- [ ] **Step 9: Commit**

```bash
git add apps/web/
git commit -m "feat: add exam document sharing UI with tabs, duplicate, and assign-to-class"
```

---

## Task 5: Frontend — Import Exam Document in Assignment Creation

**Files:**
- Modify: `apps/web/src/app/(authenticated)/assignments/page.tsx`

- [ ] **Step 1: Add "시험지/교재에서 가져오기" button**

In the assignment creation flow (the problem selection area), add a button:

```tsx
<Button variant="outline" onClick={() => setShowExamPicker(true)}>
  <FileText className="h-4 w-4 mr-2" />
  시험지/교재에서 가져오기
</Button>
```

- [ ] **Step 2: Add exam document picker dialog**

When `showExamPicker` is true, show a Dialog that lists exam documents (scope=all):

```tsx
function ExamDocumentPickerDialog({
  onSelect,
  onClose,
}: {
  onSelect: (doc: { id: string; title: string; problemIds: string[]; attachPdf: boolean }) => void;
  onClose: () => void;
}) {
  const [attachPdf, setAttachPdf] = useState(false);

  const { data: documents, isLoading } = useQuery({
    queryKey: ["exam-documents", "all"],
    queryFn: () => api.get<ExamDocument[]>("/exam-documents?scope=all"),
  });

  const completedDocs = documents?.filter((d) => d.status === "completed") ?? [];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>시험지/교재에서 가져오기</DialogTitle>
        </DialogHeader>
        <label className="flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            checked={attachPdf}
            onChange={(e) => setAttachPdf(e.target.checked)}
          />
          <span className="text-sm">학생에게 PDF 첨부</span>
        </label>
        {isLoading && <Skeleton className="h-20" />}
        {completedDocs.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            사용할 수 있는 시험지/교재가 없습니다
          </p>
        )}
        <div className="space-y-2">
          {completedDocs.map((doc) => (
            <Card
              key={doc.id}
              className="cursor-pointer hover:border-brand-beige transition-colors"
              onClick={async () => {
                const detail = await api.get<{
                  problems: Array<{ problemId: string }>;
                }>(`/exam-documents/${doc.id}`);
                onSelect({
                  id: doc.id,
                  title: doc.title,
                  problemIds: detail.problems.map((p) => p.problemId),
                  attachPdf,
                });
                onClose();
              }}
            >
              <CardContent className="flex items-center gap-3 p-3">
                <FileText className="h-5 w-5 text-brand-beige shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{doc.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {doc.type === "exam" ? "시험지" : "교재"} &middot;
                    {doc._count?.problems ?? 0}문제
                    {doc.creator && ` · ${doc.creator.name}`}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire selected exam document to assignment creation**

When `onSelect` is called from the picker:
1. Set `examDocumentId` in the form state
2. Set `attachPdf` in the form state
3. Populate `problemIds` from the exam document
4. Pass these to the `POST /classes/:classId/assignments` API call

- [ ] **Step 4: Verify**

```bash
pnpm dev:web
# Navigate to /assignments
# Create new assignment → click "시험지/교재에서 가져오기"
# Select an exam document → verify problems are added
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat: add import from exam document in assignment creation flow"
```

---

## Execution Order & Dependencies

```
Task 1 (Schema) → Task 2 (ExamDoc API) → Task 4 (ExamDoc Frontend)
                → Task 3 (Assignment API) → Task 5 (Assignment Frontend)
```

Task 1 must be first. Tasks 2 and 3 can run in parallel after Task 1. Tasks 4 and 5 depend on their respective backend tasks.
