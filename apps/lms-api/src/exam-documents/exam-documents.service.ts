import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { LatexCompilerService } from "./latex-compiler.service";
import { CreateExamDocumentDto } from "./dto/create-exam-document.dto";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
  ) {
    this.s3 = new S3Client({
      region: this.config.get("AWS_REGION", "ap-northeast-2"),
      ...(this.config.get("AWS_ENDPOINT")
        ? { endpoint: this.config.get("AWS_ENDPOINT"), forcePathStyle: true }
        : {}),
    });
    this.bucket = this.config.getOrThrow("S3_BUCKET");
  }

  async create(dto: CreateExamDocumentDto, userId: string) {
    const doc = await this.prisma.examDocument.create({
      data: {
        title: dto.title,
        type: dto.type,
        creatorId: userId,
        headerConfig: dto.headerConfig ?? undefined,
        layoutConfig: dto.layoutConfig,
        coverConfig: dto.coverConfig ?? undefined,
        status: "draft",
        problems: {
          create: dto.problemIds.map((problemId, index) => ({
            problemId,
            orderIndex: index,
          })),
        },
      },
      include: {
        problems: { orderBy: { orderIndex: "asc" } },
      },
    });

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

  async findAll(userId: string) {
    return this.prisma.examDocument.findMany({
      where: { creatorId: userId },
      include: {
        _count: { select: { problems: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(id: string, userId: string) {
    const doc = await this.prisma.examDocument.findUnique({
      where: { id },
      include: {
        problems: {
          orderBy: { orderIndex: "asc" },
        },
      },
    });
    if (!doc) throw new NotFoundException("Document not found");
    if (doc.creatorId !== userId) {
      throw new ForbiddenException("Not authorized");
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

  async generatePdf(documentId: string, generateAnswerSheet: boolean) {
    const doc = await this.prisma.examDocument.findUnique({
      where: { id: documentId },
      include: {
        problems: {
          orderBy: { orderIndex: "asc" },
        },
      },
    });
    if (!doc) throw new NotFoundException("Document not found");

    // Fetch full problem data
    const problemIds = doc.problems.map((p) => p.problemId);
    const problems = await this.prisma.problem.findMany({
      where: { id: { in: problemIds } },
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

    const header = (doc.headerConfig as Record<string, unknown>) ?? {};
    const layout = (doc.layoutConfig as Record<string, unknown>) ?? {};
    const cover = (doc.coverConfig as Record<string, unknown>) ?? {};

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
      const finalPdf = coverPdf
        ? Buffer.concat([coverPdf, mainPdf])
        : mainPdf;

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
