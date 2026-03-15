import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PDFDocument } from "pdf-lib";
import { PrismaService } from "../prisma/prisma.service";
import { LatexCompilerService } from "./latex-compiler.service";
import { CreateExamDocumentDto } from "./dto/create-exam-document.dto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getAccessibleProblemWhere, canAccessClass } from "../common/access-control";
import { ProblemUsageLogService } from "../problems/problem-usage-log.service";

type CoverTextAlign = "left" | "center" | "right";

interface NormalizedCoverElement {
  align: CoverTextAlign;
  x: number;
  y: number;
}

interface NormalizedCoverConfig {
  accentColor: string;
  author: string;
  backgroundColor: string;
  elements: Record<"author" | "subtitle" | "title" | "year", NormalizedCoverElement>;
  mutedTextColor: string;
  style: "editorial" | "band" | "split";
  subtitle: string;
  textColor: string;
  title: string;
  year: string;
}

const DEFAULT_COVER_ELEMENTS: NormalizedCoverConfig["elements"] = {
  author: { align: "left", x: 0, y: 75 },
  subtitle: { align: "left", x: 0, y: 34 },
  title: { align: "left", x: 0, y: 18 },
  year: { align: "left", x: 0, y: 83 },
};

const DEFAULT_LIGHT_COVER_COLORS = {
  accentColor: "C49A4A",
  mutedTextColor: "6B7280",
  textColor: "101828",
};

const DEFAULT_DARK_COVER_COLORS = {
  accentColor: "D6C28B",
  mutedTextColor: "D0D5DD",
  textColor: "F8FAFC",
};

const LEGACY_BACKGROUND_COLOR_MAP: Record<
  string,
  {
    accentColor: string;
    backgroundColor: string;
    mutedTextColor: string;
    textColor: string;
  }
> = {
  "blue!80!black": {
    accentColor: "A9C1D9",
    backgroundColor: "1E3A5F",
    mutedTextColor: "D6E3F0",
    textColor: "F8FAFC",
  },
  "gray!80!black": {
    accentColor: "D6A36C",
    backgroundColor: "1F242C",
    mutedTextColor: "D0D5DD",
    textColor: "F8FAFC",
  },
  "green!80!black": {
    accentColor: "D7C28B",
    backgroundColor: "20352B",
    mutedTextColor: "DCE6D7",
    textColor: "F9FAFB",
  },
  "purple!80!black": {
    accentColor: "CBB7F5",
    backgroundColor: "4C2E73",
    mutedTextColor: "E9DDFB",
    textColor: "FAF5FF",
  },
  "red!80!black": {
    accentColor: "F1C2AF",
    backgroundColor: "7A2E2B",
    mutedTextColor: "F7D9D0",
    textColor: "FFF7ED",
  },
};

const VALID_COVER_ALIGNMENTS = new Set<CoverTextAlign>(["left", "center", "right"]);
const VALID_COVER_STYLES = new Set<NormalizedCoverConfig["style"]>([
  "editorial",
  "band",
  "split",
]);

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toText(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  return "";
}

function clampPercentage(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(100, Math.max(0, Number(parsed.toFixed(2))));
}

function sanitizeHexColor(value: unknown): string | null {
  const raw = toText(value).trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return null;
  }

  return normalized.toUpperCase();
}

function isLightHexColor(hex: string): boolean {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance >= 0.62;
}

function normalizeBaseCoverColors(rawBackgroundColor: unknown) {
  const legacyMatch = LEGACY_BACKGROUND_COLOR_MAP[toText(rawBackgroundColor).trim()];
  if (legacyMatch) {
    return legacyMatch;
  }

  const backgroundColor = sanitizeHexColor(rawBackgroundColor) ?? "FFFFFF";
  const defaults = isLightHexColor(backgroundColor)
    ? DEFAULT_LIGHT_COVER_COLORS
    : DEFAULT_DARK_COVER_COLORS;

  return {
    backgroundColor,
    ...defaults,
  };
}

function normalizeCoverElement(
  rawElement: unknown,
  fallback: NormalizedCoverElement,
): NormalizedCoverElement {
  const element = toRecord(rawElement);
  const align = toText(element?.align).trim() as CoverTextAlign;

  return {
    align: VALID_COVER_ALIGNMENTS.has(align) ? align : fallback.align,
    x: clampPercentage(element?.x, fallback.x),
    y: clampPercentage(element?.y, fallback.y),
  };
}

@Injectable()
export class ExamDocumentsService {
  private readonly logger = new Logger(ExamDocumentsService.name);
  private s3: S3Client;
  private bucket: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private latexCompiler: LatexCompilerService,
    @InjectQueue("exam-document-pdf") private pdfQueue: Queue,
    private usageLogService: ProblemUsageLogService,
  ) {
    this.s3 = new S3Client({
      region: this.config.get("AWS_REGION", "ap-northeast-2"),
      ...(this.config.get("AWS_ENDPOINT")
        ? { endpoint: this.config.get("AWS_ENDPOINT"), forcePathStyle: true }
        : {}),
    });
    this.bucket = this.config.getOrThrow("S3_BUCKET");
  }

  private normalizeCoverConfig(
    rawCoverConfig: unknown,
    header: Record<string, unknown>,
  ): NormalizedCoverConfig {
    const coverConfig = toRecord(rawCoverConfig);
    const baseColors = normalizeBaseCoverColors(coverConfig?.backgroundColor);
    const rawElements = toRecord(coverConfig?.elements);
    const style = toText(coverConfig?.style).trim() as NormalizedCoverConfig["style"];

    return {
      accentColor:
        sanitizeHexColor(coverConfig?.accentColor) ?? baseColors.accentColor,
      author: toText(coverConfig?.author).trim(),
      backgroundColor: baseColors.backgroundColor,
      elements: {
        author: normalizeCoverElement(
          rawElements?.author,
          DEFAULT_COVER_ELEMENTS.author,
        ),
        subtitle: normalizeCoverElement(
          rawElements?.subtitle,
          DEFAULT_COVER_ELEMENTS.subtitle,
        ),
        title: normalizeCoverElement(
          rawElements?.title,
          DEFAULT_COVER_ELEMENTS.title,
        ),
        year: normalizeCoverElement(rawElements?.year, DEFAULT_COVER_ELEMENTS.year),
      },
      mutedTextColor:
        sanitizeHexColor(coverConfig?.mutedTextColor) ??
        baseColors.mutedTextColor,
      style: VALID_COVER_STYLES.has(style) ? style : "editorial",
      subtitle: toText(coverConfig?.subtitle).trim(),
      textColor: sanitizeHexColor(coverConfig?.textColor) ?? baseColors.textColor,
      title:
        toText(coverConfig?.title).trim() ||
        toText(header.title).trim() ||
        "Untitled",
      year: toText(coverConfig?.year).trim(),
    };
  }

  async create(
    dto: CreateExamDocumentDto,
    userId: string,
    userRole: string,
  ) {
    const normalizedProblemIds = dto.problemIds.map((problemId) => problemId.trim());
    if (normalizedProblemIds.some((problemId) => problemId.length === 0)) {
      throw new BadRequestException("problemIds must not contain empty values");
    }

    const uniqueProblemIds = [...new Set(normalizedProblemIds)];
    if (uniqueProblemIds.length !== normalizedProblemIds.length) {
      throw new BadRequestException("problemIds must not contain duplicates");
    }

    const accessibleProblems = await this.prisma.problem.findMany({
      where: {
        id: { in: uniqueProblemIds },
        ...getAccessibleProblemWhere(userId, userRole),
      },
      select: { id: true },
    });
    if (accessibleProblems.length !== uniqueProblemIds.length) {
      throw new ForbiddenException("One or more problems are not accessible");
    }

    const doc = await this.prisma.examDocument.create({
      data: {
        title: dto.title,
        type: dto.type,
        creatorId: userId,
        visibility: dto.visibility ?? "private",
        headerConfig: dto.headerConfig ?? undefined,
        layoutConfig: dto.layoutConfig,
        coverConfig: dto.coverConfig ?? undefined,
        status: "draft",
        problems: {
          create: normalizedProblemIds.map((problemId, index) => ({
            problemId,
            orderIndex: index,
          })),
        },
      },
      include: {
        problems: { orderBy: { orderIndex: "asc" } },
      },
    });

    await this.usageLogService.logUsage(
      normalizedProblemIds.map((problemId) => ({
        problemId,
        usageType: "exam_document" as const,
        referenceId: doc.id,
        referenceType: "ExamDocument",
        usedByUserId: userId,
      })),
    );

    // Enqueue PDF generation
    await this.pdfQueue.add("generate", {
      documentId: doc.id,
      generateAnswerSheet: dto.generateAnswerSheet ?? true,
    });

    await this.prisma.examDocument.update({
      where: { id: doc.id },
      data: { status: "generating" },
    });

    return { ...doc, status: "generating" };
  }

  async findAll(userId: string, scope: "mine" | "shared" | "all" = "mine") {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true },
    });

    let where: Record<string, unknown>;

    if (scope === "mine") {
      where = { creatorId: userId };
    } else if (scope === "shared") {
      where = {
        visibility: "public",
        creatorId: { not: userId },
        creator: { organizationId: user?.organizationId ?? "__none__" },
      };
    } else {
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

  async findById(id: string, userId: string) {
    const doc = await this.prisma.examDocument.findUnique({
      where: { id },
      include: {
        problems: { orderBy: { orderIndex: "asc" } },
        creator: { select: { id: true, name: true, organizationId: true } },
      },
    });
    if (!doc) throw new NotFoundException("Document not found");

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

  async getDownloadUrl(id: string, userId: string, type: "pdf" | "answer") {
    const doc = await this.findById(id, userId);

    const s3Key = type === "answer" ? doc.answerPdfS3Key : doc.pdfS3Key;
    if (!s3Key) {
      throw new NotFoundException(
        type === "answer" ? "Answer PDF not available" : "PDF not available",
      );
    }

    const command = new GetObjectCommand({ Bucket: this.bucket, Key: s3Key });
    const url = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    return { url };
  }

  async remove(id: string, userId: string) {
    const doc = await this.findById(id, userId);
    await this.prisma.examDocument.delete({ where: { id: doc.id } });
  }

  async regenerate(id: string, userId: string) {
    const doc = await this.findById(id, userId);

    await this.prisma.examDocument.update({
      where: { id: doc.id },
      data: { status: "generating", errorMessage: null },
    });

    await this.pdfQueue.add("generate", {
      documentId: doc.id,
      generateAnswerSheet: true,
    });

    return { id: doc.id, status: "generating" };
  }

  async duplicate(id: string, userId: string) {
    const doc = await this.findById(id, userId);

    const newDoc = await this.prisma.examDocument.create({
      data: {
        title: `${doc.title} (복사본)`,
        type: doc.type,
        creatorId: userId,
        visibility: "private",
        headerConfig: doc.headerConfig ?? undefined,
        layoutConfig: doc.layoutConfig ?? {},
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

    await this.pdfQueue.add("generate", {
      documentId: newDoc.id,
      generateAnswerSheet: true,
    });

    await this.prisma.examDocument.update({
      where: { id: newDoc.id },
      data: { status: "generating" },
    });

    return { ...newDoc, status: "generating" as const };
  }

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

    const hasClassAccess = await canAccessClass(this.prisma, userId, userRole, dto.classId);
    if (!hasClassAccess) {
      throw new ForbiddenException("You do not have access to this class");
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

  private async mergePdfBuffers(buffers: Buffer[]): Promise<Buffer> {
    if (buffers.length === 1) {
      return buffers[0];
    }

    const mergedDocument = await PDFDocument.create();

    for (const buffer of buffers) {
      const sourceDocument = await PDFDocument.load(buffer);
      const copiedPages = await mergedDocument.copyPages(
        sourceDocument,
        sourceDocument.getPageIndices(),
      );

      copiedPages.forEach((page) => mergedDocument.addPage(page));
    }

    return Buffer.from(await mergedDocument.save());
  }

  async generatePdf(documentId: string, generateAnswerSheet: boolean) {
    const doc = await this.prisma.examDocument.findUnique({
      where: { id: documentId },
      include: {
        creator: {
          select: {
            role: true,
          },
        },
        problems: {
          orderBy: { orderIndex: "asc" },
        },
      },
    });
    if (!doc) throw new NotFoundException("Document not found");

    // Fetch full problem data
    const problemIds = doc.problems.map((p) => p.problemId);
    const problems = await this.prisma.problem.findMany({
      where: {
        id: { in: problemIds },
        ...getAccessibleProblemWhere(doc.creatorId, doc.creator.role),
      },
      select: {
        id: true,
        stemLatex: true,
        stemText: true,
        problemType: true,
        answerText: true,
        answerLatex: true,
        solutionLatex: true,
        solutionText: true,
        solutionStrategy: true,
        solutionSteps: true,
        choices: {
          select: {
            label: true,
            contentLatex: true,
            contentText: true,
            position: true,
          },
          orderBy: { position: "asc" },
        },
      },
    });

    // Maintain order
    const problemMap = new Map(problems.map((p) => [p.id, p]));
    const orderedProblems = doc.problems
      .map((dp) => problemMap.get(dp.problemId))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    if (orderedProblems.length !== doc.problems.length) {
      throw new ForbiddenException(
        "Document contains problems that are no longer accessible",
      );
    }

    const header = (doc.headerConfig as Record<string, unknown>) ?? {};
    const layout = (doc.layoutConfig as Record<string, unknown>) ?? {};
    const cover = this.normalizeCoverConfig(doc.coverConfig, header);

    try {
      // Generate cover page for workbooks
      let coverPdf: Buffer | null = null;
      if (doc.type === "workbook" && cover && Object.keys(cover).length > 0) {
        coverPdf = await this.latexCompiler.compile({
          templateName: "cover",
          data: { header, cover },
        });
      }

      // Generate main PDF
      const templateName = doc.type === "exam" ? "exam" : "workbook";
      const mainPdf = await this.latexCompiler.compile({
        templateName,
        data: { header, layout, problems: orderedProblems },
      });

      // Combine cover + main content if cover exists
      const finalPdf = await this.mergePdfBuffers(
        coverPdf ? [coverPdf, mainPdf] : [mainPdf],
      );

      const mainS3Key = `exam-documents/${doc.id}/document.pdf`;
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: mainS3Key,
          Body: finalPdf,
          ContentType: "application/pdf",
        }),
      );

      let answerS3Key: string | null = null;

      // Generate answer sheet if requested
      if (generateAnswerSheet) {
        const answerPdf = await this.latexCompiler.compile({
          templateName: "answer-sheet",
          data: { header, layout, problems: orderedProblems },
        });

        answerS3Key = `exam-documents/${doc.id}/answer-sheet.pdf`;
        await this.s3.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: answerS3Key,
            Body: answerPdf,
            ContentType: "application/pdf",
          }),
        );
      }

      await this.prisma.examDocument.update({
        where: { id: doc.id },
        data: {
          status: "completed",
          pdfS3Key: mainS3Key,
          answerPdfS3Key: answerS3Key,
        },
      });
    } catch (error) {
      this.logger.error(`PDF generation failed for ${doc.id}: ${error}`);
      await this.prisma.examDocument.update({
        where: { id: doc.id },
        data: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}
