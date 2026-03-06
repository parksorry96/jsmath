import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { ProblemType } from "@prisma/client";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "crypto";
import { Redis } from "ioredis";
import { Subject } from "rxjs";

const VALID_PROBLEM_TYPES = new Set(Object.values(ProblemType));

@Injectable()
export class FilesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FilesService.name);
  private s3: S3Client;
  private redisPublisher: Redis;
  private redisSubscriber: Redis;
  private bucket: string;
  private progressSubject = new Subject<{
    ocrJobId: string;
    stage: string;
    current: number;
    total: number;
    message: string;
  }>();

  getProgressStream() {
    return this.progressSubject.asObservable();
  }

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    const s3Region =
      this.config.get<string>("AWS_REGION") ??
      this.config.getOrThrow<string>("S3_REGION");
    const s3AccessKeyId =
      this.config.get<string>("AWS_ACCESS_KEY_ID") ??
      this.config.getOrThrow<string>("S3_ACCESS_KEY_ID");
    const s3SecretAccessKey =
      this.config.get<string>("AWS_SECRET_ACCESS_KEY") ??
      this.config.getOrThrow<string>("S3_SECRET_ACCESS_KEY");

    this.s3 = new S3Client({
      region: s3Region,
      credentials: {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
      },
    });
    this.bucket = this.config.getOrThrow<string>("S3_BUCKET");
    const redisUrl = this.config.getOrThrow<string>("REDIS_URL");
    this.redisPublisher = new Redis(redisUrl);
    this.redisSubscriber = new Redis(redisUrl);
  }

  async onModuleInit() {
    await this.redisSubscriber.subscribe(
      "ocr:completed",
      "ocr:failed",
      "analysis:completed",
      "analysis:failed",
      "pipeline:progress",
    );
    this.redisSubscriber.on("message", (channel, message) => {
      void this.handleOcrPipelineEvent(channel, message);
    });
  }

  async onModuleDestroy() {
    await Promise.allSettled([
      this.redisSubscriber.quit(),
      this.redisPublisher.quit(),
    ]);
  }

  private async handleOcrPipelineEvent(channel: string, message: string) {
    try {
      const payload = JSON.parse(message) as {
        ocrJobId?: string;
        problemIds?: string[];
        problemCount?: unknown;
        problems?: Array<Record<string, unknown>>;
        reason?: unknown;
      };

      if (channel === "pipeline:progress") {
        this.progressSubject.next(payload as any);
        return;
      }

      const isAnalysisEvent = channel === "analysis:completed" || channel === "analysis:failed";
      if (!payload.ocrJobId && !isAnalysisEvent) {
        this.logger.warn(`Ignored ${channel}: missing ocrJobId`);
        return;
      }

      if (channel === "ocr:completed") {
        const maybeCount = payload.problemCount;
        const job = await this.prisma.ocrJob.update({
          where: { id: payload.ocrJobId },
          data: {
            status: "completed",
            problemCount:
              typeof maybeCount === "number" ? maybeCount : undefined,
            errorMessage: null,
            completedAt: new Date(),
          },
        });

        // Create Problem records from pipeline results
        if (Array.isArray(payload.problems) && payload.problems.length > 0) {
          await this.createProblemsFromOcr(
            payload.ocrJobId!,
            job.sourceFileId,
            payload.problems,
          );

          // AUTO-TRIGGER: Start AI analysis immediately
          const createdProblems = await this.prisma.problem.findMany({
            where: { ocrJobId: payload.ocrJobId },
            select: { id: true },
          });
          const problemIds = createdProblems.map((p) => p.id);
          if (problemIds.length > 0) {
            await this.prisma.problem.updateMany({
              where: { id: { in: problemIds } },
              data: { analysisStatus: "analyzing" },
            });
            await this.redisPublisher.publish(
              "analysis:request",
              JSON.stringify({
                ocrJobId: payload.ocrJobId,
                problemIds,
              }),
            );
            this.logger.log(
              `Auto-triggered analysis for ${problemIds.length} problems (job ${payload.ocrJobId})`,
            );
          }
        }
        return;
      }

      if (channel === "ocr:failed") {
        await this.prisma.ocrJob.update({
          where: { id: payload.ocrJobId },
          data: {
            status: "failed",
            errorMessage:
              typeof payload.reason === "string"
                ? payload.reason
                : "OCR pipeline failed",
            completedAt: new Date(),
          },
        });
        return;
      }

      if (channel === "analysis:completed") {
        const ids = Array.isArray(payload.problemIds) ? payload.problemIds : [];
        if (ids.length > 0) {
          await this.prisma.problem.updateMany({
            where: { id: { in: ids } },
            data: { analysisStatus: "completed", analyzedAt: new Date() },
          });
          this.logger.log(`analysis:completed for ${ids.length} problems`);
        }
        return;
      }

      if (channel === "analysis:failed") {
        const ids = Array.isArray(payload.problemIds) ? payload.problemIds : [];
        if (ids.length > 0) {
          await this.prisma.problem.updateMany({
            where: { id: { in: ids } },
            data: { analysisStatus: "failed" },
          });
          this.logger.warn(`analysis:failed for ${ids.length} problems`);
        }
        return;
      }
    } catch (error) {
      this.logger.error(
        `Failed to process OCR event on channel ${channel}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async createProblemsFromOcr(
    ocrJobId: string,
    sourceFileId: string,
    problems: Array<Record<string, unknown>>,
  ) {
    for (const p of problems) {
      try {
        const choices = Array.isArray(p.choices)
          ? (p.choices as Array<Record<string, unknown>>)
          : undefined;

        const created = await this.prisma.problem.create({
          data: {
            ocrJobId,
            sourceFileId,
            problemNumber: typeof p.problemNumber === "string" ? p.problemNumber : null,
            displayNumber: typeof p.displayNumber === "string" ? p.displayNumber : null,
            problemType:
              typeof p.problemType === "string" &&
              VALID_PROBLEM_TYPES.has(p.problemType as ProblemType)
                ? (p.problemType as ProblemType)
                : ProblemType.short_answer,
            startPage: typeof p.startPage === "number" ? p.startPage : 0,
            endPage: typeof p.endPage === "number" ? p.endPage : 0,
            stemLatex: typeof p.stemLatex === "string" ? p.stemLatex : "",
            stemText: typeof p.stemText === "string" ? p.stemText : "",
            gradeLevel: typeof p.gradeLevel === "string" ? p.gradeLevel : null,
            subject: typeof p.subject === "string" ? p.subject : null,
            unitMajor: typeof p.unitMajor === "string" ? p.unitMajor : null,
            unitMinor: typeof p.unitMinor === "string" ? p.unitMinor : null,
            unitSub: typeof p.unitSub === "string" ? p.unitSub : null,
            difficulty: typeof p.difficulty === "number" ? p.difficulty : null,
            classificationConfidence:
              typeof p.classificationConfidence === "number"
                ? p.classificationConfidence
                : null,
            ...(p.bookSource ? { bookSource: p.bookSource as any } : {}),
            answerMatchStatus: typeof p.answerMatchStatus === "string" ? p.answerMatchStatus : null,
            solutionLatex: typeof p.solutionLatex === "string" ? p.solutionLatex : null,
            solutionText: typeof p.solutionText === "string" ? p.solutionText : null,
            ...(typeof p.answerText === "string" ? { answerText: p.answerText } : {}),
            reviewStatus: "pending_review",
            ...(choices && choices.length > 0
              ? {
                  choices: {
                    create: choices.map((c, i) => ({
                      position: typeof c.position === "number" ? c.position : i + 1,
                      label: typeof c.label === "string" ? c.label : `${i + 1}`,
                      contentLatex: typeof c.contentLatex === "string" ? c.contentLatex : "",
                      contentText: typeof c.contentText === "string" ? c.contentText : "",
                    })),
                  },
                }
              : {}),
          },
        });

        // Create ProblemAsset for page image if available
        const pageImageKey = p.pageImageS3Key;
        if (typeof pageImageKey === "string" && pageImageKey) {
          await this.prisma.problemAsset.create({
            data: {
              problemId: created.id,
              kind: "page_image",
              s3Key: pageImageKey,
              format: "png",
            },
          });
        }

        // Create ProblemAsset for cropped problem image if available
        const problemImageKey = p.problemImageS3Key;
        if (typeof problemImageKey === "string" && problemImageKey) {
          await this.prisma.problemAsset.create({
            data: {
              problemId: created.id,
              kind: "problem_crop",
              s3Key: problemImageKey,
              format: "webp",
            },
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to create problem record for job ${ocrJobId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    this.logger.log(
      `Created ${problems.length} problem records for OCR job ${ocrJobId}`,
    );
  }

  async uploadPdf(file: Express.Multer.File, uploaderId: string, meta?: {
    documentType: string;
    bookTitle: string | null;
    publisher: string | null;
  }) {
    const fileHash = createHash("sha256").update(file.buffer).digest("hex");

    // Idempotency: return existing record if same file already uploaded
    const existing = await this.prisma.sourceFile.findUnique({
      where: { fileHash },
      include: { ocrJobs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (existing) {
      return {
        id: existing.id,
        filename: existing.filename,
        status: existing.ocrJobs[0]?.status ?? "pending",
        jobId: existing.ocrJobs[0]?.id ?? null,
      };
    }

    const s3Key = `uploads/${uploaderId}/${Date.now()}-${file.originalname}`;

    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: file.buffer,
          ContentType: "application/pdf",
        }),
      );
    } catch {
      throw new InternalServerErrorException("S3 upload failed");
    }

    const sourceFile = await this.prisma.sourceFile.create({
      data: {
        filename: file.originalname,
        s3Key,
        fileHash,
        sizeBytes: file.size,
        documentType: meta?.documentType ?? "exam",
        bookTitle: meta?.bookTitle ?? null,
        publisher: meta?.publisher ?? null,
      },
    });

    const ocrJob = await this.prisma.ocrJob.create({
      data: {
        sourceFileId: sourceFile.id,
        documentType: meta?.documentType ?? "exam",
        bookTitle: meta?.bookTitle ?? null,
        publisher: meta?.publisher ?? null,
      },
    });

    // Publish OCR submit event to Redis
    await this.redisPublisher.publish(
      "ocr:submit",
      JSON.stringify({
        jobId: ocrJob.id,
        sourceFileId: sourceFile.id,
        s3Key,
        filename: file.originalname,
        documentType: meta?.documentType ?? "exam",
        bookTitle: meta?.bookTitle ?? null,
        publisher: meta?.publisher ?? null,
      }),
    );

    return {
      id: sourceFile.id,
      filename: sourceFile.filename,
      status: "pending",
      jobId: ocrJob.id,
    };
  }

  async listFiles() {
    const files = await this.prisma.sourceFile.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        ocrJobs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { _count: { select: { problems: true } } },
        },
      },
    });

    return files.map((f) => {
      const job = f.ocrJobs[0];
      return {
        id: f.id,
        filename: f.filename,
        createdAt: f.createdAt,
        ocrJobId: job?.id ?? null,
        ocrStatus: job?.status ?? null,
        problemCount: job?._count?.problems ?? 0,
        documentType: f.documentType ?? "exam",
        bookTitle: f.bookTitle ?? null,
      };
    });
  }

  async getAssetUrl(s3Key: string): Promise<{ url: string }> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: s3Key,
    });
    const url = await getSignedUrl(this.s3, command, { expiresIn: 900 });
    return { url };
  }

  async deleteFile(id: string) {
    const sourceFile = await this.prisma.sourceFile.findUnique({
      where: { id },
      include: { ocrJobs: { select: { id: true } } },
    });
    if (!sourceFile) throw new NotFoundException("File not found");

    const jobIds = sourceFile.ocrJobs.map((j) => j.id);

    // Delete in dependency order
    if (jobIds.length > 0) {
      await this.prisma.problemAsset.deleteMany({
        where: { problem: { ocrJobId: { in: jobIds } } },
      });
      await this.prisma.problemChoice.deleteMany({
        where: { problem: { ocrJobId: { in: jobIds } } },
      });
      await this.prisma.problem.deleteMany({
        where: { ocrJobId: { in: jobIds } },
      });
      await this.prisma.ocrJob.deleteMany({
        where: { id: { in: jobIds } },
      });
    }

    await this.prisma.sourceFile.delete({ where: { id } });

    return { deleted: true };
  }

  async getStatus(id: string) {
    const sourceFile = await this.prisma.sourceFile.findUnique({
      where: { id },
      include: { ocrJobs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!sourceFile) throw new NotFoundException("File not found");

    const job = sourceFile.ocrJobs[0];
    return {
      id: sourceFile.id,
      filename: sourceFile.filename,
      status: job?.status ?? "pending",
      jobId: job?.id ?? null,
      problemCount: job?.problemCount ?? null,
      errorMessage: job?.errorMessage ?? null,
    };
  }
}
