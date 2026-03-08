# Exam/Workbook PDF Builder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable teachers to select problems from the question bank and generate professional 2-column exam papers and workbooks as PDFs, with auto-generated answer/explanation sheets and workbook cover pages.

**Architecture:** NestJS `exam-documents` module with LaTeX template engine → xelatex compilation via BullMQ worker → PDF stored in S3. Frontend: dedicated builder wizard page + enhanced problem bank filters.

**Tech Stack:** xelatex (Korean math typesetting), BullMQ (async PDF generation), S3 (PDF storage), Next.js wizard UI with @dnd-kit (drag reorder)

---

### Task 1: DB Schema — ExamDocument + ExamDocumentProblem

**Files:**
- Modify: `packages/db-schema/prisma/schema.prisma`

**Step 1: Add ExamDocument and ExamDocumentProblem models to Prisma schema**

Add after the `AssignmentProblem` model block (around line 168):

```prisma
model ExamDocument {
  id              String               @id @default(cuid())
  title           String
  type            ExamDocumentType
  creatorId       String               @map("creator_id")
  creator         User                 @relation(fields: [creatorId], references: [id])
  headerConfig    Json?                @map("header_config")
  layoutConfig    Json                 @map("layout_config")
  coverConfig     Json?                @map("cover_config")
  pdfS3Key        String?              @map("pdf_s3_key")
  answerPdfS3Key  String?              @map("answer_pdf_s3_key")
  status          ExamDocumentStatus   @default(draft)
  errorMessage    String?              @map("error_message")
  problems        ExamDocumentProblem[]
  createdAt       DateTime             @default(now()) @map("created_at")
  updatedAt       DateTime             @updatedAt @map("updated_at")

  @@index([creatorId])
  @@index([status])
  @@map("exam_documents")
  @@schema("public")
}

model ExamDocumentProblem {
  id             String       @id @default(cuid())
  examDocumentId String       @map("exam_document_id")
  examDocument   ExamDocument @relation(fields: [examDocumentId], references: [id], onDelete: Cascade)
  problemId      String       @map("problem_id")
  orderIndex     Int          @map("order_index")

  @@unique([examDocumentId, problemId])
  @@index([examDocumentId])
  @@map("exam_document_problems")
  @@schema("public")
}

enum ExamDocumentType {
  exam
  workbook

  @@schema("public")
}

enum ExamDocumentStatus {
  draft
  generating
  completed
  failed

  @@schema("public")
}
```

Also add the relation to the `User` model:
```prisma
// In model User, add:
examDocuments  ExamDocument[]
```

**Step 2: Generate and run the migration**

Run:
```bash
cd packages/db-schema && pnpm db:migrate -- --name add_exam_documents
```

**Step 3: Generate Prisma client**

Run:
```bash
pnpm --filter @jsmath/db-schema db:generate
```

**Step 4: Commit**

```bash
git add packages/db-schema/prisma/
git commit -m "feat: add ExamDocument schema for PDF exam/workbook builder"
```

---

### Task 2: LaTeX Templates — Exam, Workbook, Answer Sheet, Cover

**Files:**
- Create: `apps/lms-api/src/exam-documents/templates/exam.tex.ejs`
- Create: `apps/lms-api/src/exam-documents/templates/workbook.tex.ejs`
- Create: `apps/lms-api/src/exam-documents/templates/answer-sheet.tex.ejs`
- Create: `apps/lms-api/src/exam-documents/templates/cover.tex.ejs`

These are EJS templates that produce LaTeX source. The service will render EJS → `.tex` string → xelatex compile → PDF.

**Step 1: Create exam template**

`apps/lms-api/src/exam-documents/templates/exam.tex.ejs`:

```latex
\documentclass[10pt,a4paper]{article}
\usepackage{kotex}
\usepackage{amsmath,amssymb,amsfonts}
\usepackage{multicol}
\usepackage{geometry}
\usepackage{graphicx}
\usepackage{enumitem}
\usepackage{fancyhdr}
\usepackage{tikz}
\usepackage{setspace}

\geometry{top=2cm, bottom=2cm, left=1.5cm, right=1.5cm}

\pagestyle{fancy}
\fancyhf{}
<% if (header.title) { %>
\fancyhead[C]{\textbf{<%= header.title %>}}
<% } %>
<% if (header.schoolName) { %>
\fancyhead[L]{\small <%= header.schoolName %>}
<% } %>
<% if (header.date) { %>
\fancyhead[R]{\small <%= header.date %>}
<% } %>
\fancyfoot[C]{\thepage}
\renewcommand{\headrulewidth}{0.4pt}

\setlength{\columnsep}{1.5cm}
\setlength{\columnseprule}{0.2pt}

\begin{document}

<% if (layout.showNameField) { %>
\noindent
\begin{tabular}{|p{3cm}|p{5cm}|p{3cm}|p{5cm}|}
\hline
\textbf{학년/반} & \hspace{3cm} & \textbf{이름} & \hspace{3cm} \\
\hline
\end{tabular}
\vspace{0.5cm}
<% } %>

<% if (header.duration) { %>
\begin{center}
\small 시험 시간: <%= header.duration %>분
\end{center}
\vspace{0.3cm}
<% } %>

\begin{multicols}{2}

<% problems.forEach((p, idx) => { %>
\noindent\textbf{<%= idx + 1 %>.}
<%= p.stemLatex %>

<% if (p.choices && p.choices.length > 0) { %>
\begin{enumerate}[label=\textcircled{\small\arabic*}, itemsep=2pt, parsep=0pt]
<% p.choices.forEach((c) => { %>
\item <%= c.contentLatex %>
<% }); %>
\end{enumerate}
<% } %>

<% if (layout.problemsPerPage && (idx + 1) % layout.problemsPerPage === 0 && idx + 1 < problems.length) { %>
\newpage
<% } else { %>
\vspace{0.5cm}
<% } %>

<% }); %>

\end{multicols}

\end{document}
```

**Step 2: Create workbook template**

`apps/lms-api/src/exam-documents/templates/workbook.tex.ejs`:

Same structure as exam but without name field by default, and includes section headings if provided.

**Step 3: Create answer sheet template**

`apps/lms-api/src/exam-documents/templates/answer-sheet.tex.ejs`:

```latex
\documentclass[10pt,a4paper]{article}
\usepackage{kotex}
\usepackage{amsmath,amssymb,amsfonts}
\usepackage{multicol}
\usepackage{geometry}
\usepackage{enumitem}
\usepackage{fancyhdr}
\usepackage{xcolor}
\usepackage{tcolorbox}

\geometry{top=2cm, bottom=2cm, left=1.5cm, right=1.5cm}

\pagestyle{fancy}
\fancyhf{}
\fancyhead[C]{\textbf{<%= header.title %> — 해설지}}
\fancyfoot[C]{\thepage}
\renewcommand{\headrulewidth}{0.4pt}

\setlength{\columnsep}{1.5cm}
\setlength{\columnseprule}{0.2pt}

\begin{document}

\begin{multicols}{2}

<% problems.forEach((p, idx) => { %>
\noindent\textbf{<%= idx + 1 %>.}
<%= p.stemLatex %>

<% if (p.choices && p.choices.length > 0) { %>
\begin{enumerate}[label=\textcircled{\small\arabic*}, itemsep=2pt, parsep=0pt]
<% p.choices.forEach((c) => { %>
\item <%= c.contentLatex %>
<% }); %>
\end{enumerate}
<% } %>

\begin{tcolorbox}[colback=gray!5, colframe=gray!50, title=정답 및 해설]
<% if (p.answerText || p.answerLatex) { %>
\textbf{정답:} <%= p.answerLatex || p.answerText %>
<% } %>

<% if (p.solutionSteps && p.solutionSteps.length > 0) { %>
\textbf{풀이:}
\begin{enumerate}[itemsep=1pt, parsep=0pt]
<% p.solutionSteps.forEach((step) => { %>
\item <%= step.explanation || step %>
<% }); %>
\end{enumerate}
<% } else if (p.solutionLatex) { %>
\textbf{풀이:}
<%= p.solutionLatex %>
<% } %>

<% if (p.solutionStrategy) { %>
\small\textit{풀이 전략: <%= p.solutionStrategy %>}
<% } %>
\end{tcolorbox}

\vspace{0.5cm}

<% }); %>

\end{multicols}

\end{document}
```

**Step 4: Create cover template**

`apps/lms-api/src/exam-documents/templates/cover.tex.ejs`:

```latex
\documentclass[a4paper]{article}
\usepackage{kotex}
\usepackage{geometry}
\usepackage{tikz}
\usepackage{xcolor}
\usepackage{setspace}

\geometry{margin=0pt}
\pagestyle{empty}

\begin{document}

\begin{tikzpicture}[remember picture, overlay]
  \fill[<%= cover.backgroundColor || 'blue!80!black' %>]
    (current page.south west) rectangle (current page.north east);

  \node[text=white, font=\Huge\bfseries, text width=14cm, align=center]
    at ([yshift=3cm]current page.center) {<%= cover.title %>};

<% if (cover.subtitle) { %>
  \node[text=white!80, font=\Large, text width=14cm, align=center]
    at ([yshift=1cm]current page.center) {<%= cover.subtitle %>};
<% } %>

<% if (cover.author) { %>
  \node[text=white!70, font=\large]
    at ([yshift=-2cm]current page.center) {<%= cover.author %>};
<% } %>

<% if (cover.year) { %>
  \node[text=white!50, font=\normalsize]
    at ([yshift=-4cm]current page.center) {<%= cover.year %>};
<% } %>
\end{tikzpicture}

\end{document}
```

**Step 5: Commit**

```bash
git add apps/lms-api/src/exam-documents/templates/
git commit -m "feat: add LaTeX templates for exam, workbook, answer sheet, cover"
```

---

### Task 3: LaTeX Compiler Service

**Files:**
- Create: `apps/lms-api/src/exam-documents/latex-compiler.service.ts`

This service handles: EJS template rendering → write .tex file → spawn xelatex → read .pdf → return Buffer.

**Step 1: Install dependencies**

```bash
cd apps/lms-api && pnpm add ejs
cd apps/lms-api && pnpm add -D @types/ejs
```

**Step 2: Create LaTeX compiler service**

`apps/lms-api/src/exam-documents/latex-compiler.service.ts`:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as ejs from "ejs";

const execFileAsync = promisify(execFile);

interface CompileOptions {
  templateName: string;
  data: Record<string, unknown>;
}

@Injectable()
export class LatexCompilerService {
  private readonly logger = new Logger(LatexCompilerService.name);
  private readonly templateDir = path.join(__dirname, "templates");

  async compile(options: CompileOptions): Promise<Buffer> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jsmath-latex-"));
    const texPath = path.join(tmpDir, "document.tex");
    const pdfPath = path.join(tmpDir, "document.pdf");

    try {
      // 1. Render EJS template to LaTeX source
      const templatePath = path.join(
        this.templateDir,
        `${options.templateName}.tex.ejs`,
      );
      const templateStr = await fs.readFile(templatePath, "utf-8");
      const texSource = ejs.render(templateStr, options.data);

      // 2. Write .tex file
      await fs.writeFile(texPath, texSource, "utf-8");

      // 3. Run xelatex (twice for references)
      for (let i = 0; i < 2; i++) {
        await execFileAsync("xelatex", [
          "-interaction=nonstopmode",
          "-halt-on-error",
          "-output-directory", tmpDir,
          texPath,
        ], { timeout: 60_000 });
      }

      // 4. Read PDF
      const pdf = await fs.readFile(pdfPath);
      return pdf;
    } catch (error) {
      this.logger.error(`LaTeX compilation failed: ${error}`);
      // Try to read log for debugging
      try {
        const logPath = path.join(tmpDir, "document.log");
        const log = await fs.readFile(logPath, "utf-8");
        const lastLines = log.split("\n").slice(-30).join("\n");
        this.logger.error(`LaTeX log:\n${lastLines}`);
      } catch {}
      throw error;
    } finally {
      // Cleanup temp dir
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async compileMultipleAndMerge(
    compilations: CompileOptions[],
  ): Promise<Buffer> {
    // For cover + content, compile separately then return content
    // (cover merging can be done via pdftk or similar later;
    //  for MVP, just compile the main document)
    if (compilations.length === 1) {
      return this.compile(compilations[0]);
    }

    // Compile each and concatenate using a wrapper LaTeX doc with pdfpages
    const pdfs: Buffer[] = [];
    for (const comp of compilations) {
      pdfs.push(await this.compile(comp));
    }

    // For MVP: return the last compiled PDF (main content)
    // TODO: merge PDFs with pdfpages or external tool
    return pdfs[pdfs.length - 1];
  }
}
```

**Step 3: Commit**

```bash
git add apps/lms-api/src/exam-documents/latex-compiler.service.ts
git commit -m "feat: add LaTeX compiler service with xelatex integration"
```

---

### Task 4: Backend Module — ExamDocuments CRUD + PDF Generation

**Files:**
- Create: `apps/lms-api/src/exam-documents/exam-documents.module.ts`
- Create: `apps/lms-api/src/exam-documents/exam-documents.controller.ts`
- Create: `apps/lms-api/src/exam-documents/exam-documents.service.ts`
- Create: `apps/lms-api/src/exam-documents/dto/create-exam-document.dto.ts`
- Create: `apps/lms-api/src/exam-documents/dto/update-exam-document.dto.ts`
- Create: `apps/lms-api/src/exam-documents/exam-documents.processor.ts`
- Modify: `apps/lms-api/src/app.module.ts` (register module)

**Step 1: Create DTOs**

`create-exam-document.dto.ts`:
```typescript
import { IsString, IsEnum, IsObject, IsOptional, IsArray } from "class-validator";

export class CreateExamDocumentDto {
  @IsString()
  title: string;

  @IsEnum(["exam", "workbook"])
  type: "exam" | "workbook";

  @IsObject()
  @IsOptional()
  headerConfig?: {
    title?: string;
    schoolName?: string;
    date?: string;
    duration?: number;
  };

  @IsObject()
  layoutConfig: {
    problemsPerPage?: number;
    showNameField?: boolean;
  };

  @IsObject()
  @IsOptional()
  coverConfig?: {
    title?: string;
    subtitle?: string;
    author?: string;
    year?: string;
    backgroundColor?: string;
  };

  @IsArray()
  @IsString({ each: true })
  problemIds: string[];

  @IsOptional()
  generateAnswerSheet?: boolean;
}
```

**Step 2: Create service**

`exam-documents.service.ts` — handles CRUD, fetches problems with full data (stemLatex, choices, answerText, solutionSteps, solutionLatex, solutionStrategy), delegates to BullMQ for PDF generation.

Key methods:
- `create(dto, userId)` — create ExamDocument + ExamDocumentProblem rows, enqueue PDF generation
- `findAll(userId)` — list user's documents
- `findById(id, userId)` — get document with problems
- `generatePdf(documentId)` — called by BullMQ processor
- `getDownloadUrl(id, type: 'pdf' | 'answer')` — return presigned S3 URL

**Step 3: Create BullMQ processor**

`exam-documents.processor.ts` — listens on `exam-document-pdf` queue, calls service.generatePdf().

**Step 4: Create controller**

Routes:
- `POST /exam-documents` — create + enqueue PDF
- `GET /exam-documents` — list mine
- `GET /exam-documents/:id` — get detail
- `GET /exam-documents/:id/download` — get PDF download URL
- `GET /exam-documents/:id/download/answer` — get answer PDF download URL
- `DELETE /exam-documents/:id` — delete document + S3 files
- `POST /exam-documents/:id/regenerate` — re-trigger PDF generation

**Step 5: Create module and register in app.module.ts**

```typescript
// exam-documents.module.ts
@Module({
  imports: [
    BullModule.registerQueue({ name: "exam-document-pdf" }),
  ],
  controllers: [ExamDocumentsController],
  providers: [ExamDocumentsService, LatexCompilerService, ExamDocumentsPdfProcessor],
})
export class ExamDocumentsModule {}
```

Add `ExamDocumentsModule` to `app.module.ts` imports.

**Step 6: Commit**

```bash
git add apps/lms-api/src/exam-documents/ apps/lms-api/src/app.module.ts
git commit -m "feat: add exam-documents module with CRUD, PDF generation pipeline"
```

---

### Task 5: Problem Bank Filter Enhancement (Backend)

**Files:**
- Modify: `apps/lms-api/src/problems/problems.service.ts`
- Modify: `apps/lms-api/src/problems/problems.controller.ts`

The backend already supports `gradeLevel`, `subject`, `unitMajor`, `difficulty`, `problemType`, `bookTitle` query params. We need to add an endpoint that returns available filter options (distinct values).

**Step 1: Add `getFilterOptions` method to ProblemsService**

```typescript
async getFilterOptions(requesterId: string, requesterRole: string) {
  const where = this.getProblemScopeWhere(requesterId, requesterRole);

  const [subjects, gradeLevels, textbooks, difficulties] = await Promise.all([
    this.prisma.problem.findMany({
      where: { ...where, subject: { not: null } },
      select: { subject: true },
      distinct: ["subject"],
    }),
    this.prisma.problem.findMany({
      where: { ...where, gradeLevel: { not: null } },
      select: { gradeLevel: true },
      distinct: ["gradeLevel"],
    }),
    this.prisma.problem.findMany({
      where: { ...where, sourceFileId: { not: null } },
      select: {
        ocrJob: {
          select: {
            sourceFile: { select: { filename: true, bookTitle: true } },
          },
        },
      },
      distinct: ["sourceFileId"],
    }),
    this.prisma.problem.findMany({
      where: { ...where, difficulty: { not: null } },
      select: { difficulty: true },
      distinct: ["difficulty"],
      orderBy: { difficulty: "asc" },
    }),
  ]);

  return {
    subjects: subjects.map((s) => s.subject).filter(Boolean),
    gradeLevels: gradeLevels.map((g) => g.gradeLevel).filter(Boolean),
    textbooks: textbooks
      .map((t) => ({
        filename: t.ocrJob?.sourceFile?.filename,
        bookTitle: t.ocrJob?.sourceFile?.bookTitle,
      }))
      .filter((t) => t.filename),
    difficulties: difficulties.map((d) => d.difficulty).filter((d) => d !== null),
  };
}
```

**Step 2: Add controller endpoint**

```typescript
@Get("filter-options")
@Roles("admin", "teacher")
getFilterOptions(@Request() req: AuthRequest) {
  return this.problems.getFilterOptions(req.user.id, req.user.role);
}
```

**Step 3: Commit**

```bash
git add apps/lms-api/src/problems/
git commit -m "feat: add problem filter options endpoint"
```

---

### Task 6: Frontend — Enhanced Problem Bank Filters

**Files:**
- Modify: `apps/web/src/app/(authenticated)/problems/page.tsx`

**Step 1: Add filter state and filter options query**

Add `useQuery` for `/problems/filter-options`. Add state for `subject`, `gradeLevel`, `difficulty`, `bookTitle` filters. Add these to the query string.

**Step 2: Add filter bar UI**

Add a row of `<Select>` dropdowns (using shadcn Select component) above the problem list:
- 과목 (subject)
- 학년 (gradeLevel)
- 교재 (bookTitle)
- 난이도 (difficulty)
- 문제유형 (problemType)

**Step 3: Wire filters to API query**

Update the `queryString` builder and `queryKey` to include new filters.

**Step 4: Commit**

```bash
git add apps/web/src/app/\(authenticated\)/problems/
git commit -m "feat: add subject, grade, difficulty, textbook filters to problem bank"
```

---

### Task 7: Frontend — Sidebar Menu Addition

**Files:**
- Modify: `apps/web/src/components/layout/app-sidebar.tsx`

**Step 1: Add "시험지/교재 제작" to sidebar**

Add to `mainNav` array:
```typescript
{ title: "시험지 제작", href: "/exam-builder", icon: Printer },
```

Import `Printer` from `lucide-react`.

**Step 2: Commit**

```bash
git add apps/web/src/components/layout/app-sidebar.tsx
git commit -m "feat: add exam builder menu to sidebar"
```

---

### Task 8: Frontend — Exam Builder Wizard Page

**Files:**
- Create: `apps/web/src/app/(authenticated)/exam-builder/page.tsx`

This is the main feature page — a 3-step wizard:

**Step 1: Install dnd-kit for drag reorder**

```bash
cd apps/web && pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**Step 2: Build Step 1 — Basic Settings**

Form fields:
- Type selector (exam / workbook) — toggle buttons
- Title (text input)
- School name (optional)
- Date (date picker or text)
- Duration in minutes (optional, exam only)
- Show name/student-ID field (checkbox, exam only)
- Problems per page (select: 3, 4, 5, 6)

If type is "workbook", show cover settings:
- Cover title, subtitle, author, year
- Background color picker (preset options)

**Step 3: Build Step 2 — Problem Selection**

Split layout:
- Left panel: Filter bar (subject, grade, difficulty, textbook, text search) + paginated problem list with "Add" button per problem
- Right panel: "Selected problems" list with drag-to-reorder (@dnd-kit/sortable), remove button, problem count

**Step 4: Build Step 3 — Review & Generate**

Summary view:
- Document settings recap
- Problem list with numbers
- "해설지 포함" toggle
- "Generate PDF" button

On submit → `POST /exam-documents` → show progress → on completion show download buttons.

**Step 5: Add polling/SSE for generation status**

Use `useQuery` with refetch interval while status is `generating`. When `completed`, show download links.

**Step 6: Commit**

```bash
git add apps/web/src/app/\(authenticated\)/exam-builder/
git commit -m "feat: add exam builder wizard page with problem selection and PDF generation"
```

---

### Task 9: Frontend — Document History List

**Files:**
- Create: `apps/web/src/app/(authenticated)/exam-builder/history/page.tsx`

**Step 1: Build history page**

List of previously generated documents with:
- Title, type badge (exam/workbook), creation date, status
- Download buttons (PDF / Answer PDF)
- Delete button

**Step 2: Link from builder page**

Add "이전 제작 내역" link button on the builder page header.

**Step 3: Commit**

```bash
git add apps/web/src/app/\(authenticated\)/exam-builder/history/
git commit -m "feat: add exam document history page"
```

---

### Execution Order & Dependencies

```
Task 1 (Schema) ← no deps
Task 2 (Templates) ← no deps
Task 3 (Compiler) ← no deps
Task 4 (Backend Module) ← depends on Task 1, 2, 3
Task 5 (Filter Backend) ← no deps
Task 6 (Filter Frontend) ← depends on Task 5
Task 7 (Sidebar) ← no deps
Task 8 (Builder Page) ← depends on Task 4, 6, 7
Task 9 (History Page) ← depends on Task 4, 8
```

**Parallelizable groups:**
- Group A: Task 1 + Task 2 + Task 3 + Task 5 + Task 7 (all independent)
- Group B: Task 4 (after Group A's 1, 2, 3) + Task 6 (after 5)
- Group C: Task 8 (after 4, 6, 7)
- Group D: Task 9 (after 8)
