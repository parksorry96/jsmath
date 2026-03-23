import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  OnModuleDestroy,
  InternalServerErrorException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { createHash, randomUUID } from "crypto";
import { normalizeFilename } from "../common/filename";
import { RedisEventBusService } from "../common/redis-event-bus.service";
import { UploadPolicyService } from "./upload-policy.service";
import { FileStorageService } from "./file-storage.service";
import { PdfBundleService } from "./pdf-bundle.service";

export type UploadMeta = {
  documentType: string;
  bookTitle: string | null;
  publisher: string | null;
  answerS3Key?: string | null;
  autoAnalyze?: boolean;
};

const MAX_DIRECT_PDF_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_DIRECT_EXAM_COMBINED_BYTES = 25 * 1024 * 1024;
const MAX_DIRECT_TEXTBOOK_COMBINED_BYTES = 25 * 1024 * 1024;
const QUEUE_FAILURE_MESSAGE = "Failed to queue OCR job";

@Injectable()
export class SourceFileIngestionService implements OnModuleDestroy {
  private readonly logger = new Logger(SourceFileIngestionService.name);

  constructor(
    private prisma: PrismaService,
    private eventBus: RedisEventBusService,
    private uploadPolicy: UploadPolicyService,
    private storage: FileStorageService,
    private pdfBundle: PdfBundleService,
  ) {}

  async onModuleDestroy() {
    return;
  }

  private async createSourceFileAndQueueOcr(args: {
    uploaderId: string;
    filename: string;
    s3Key: string;
    sizeBytes: number;
    fileHash: string;
    meta?: UploadMeta;
  }) {
    const normalizedFilename = normalizeFilename(args.filename) ?? args.filename;
    const { sourceFile, ocrJob } = await this.prisma.$transaction(async (tx) => {
      const sourceFile = await tx.sourceFile.create({
        data: {
          filename: normalizedFilename,
          uploaderId: args.uploaderId,
          s3Key: args.s3Key,
          answerS3Key: args.meta?.answerS3Key ?? null,
          fileHash: args.fileHash,
          sizeBytes: args.sizeBytes,
          documentType: args.meta?.documentType ?? "exam",
          bookTitle: args.meta?.bookTitle ?? null,
          publisher: args.meta?.publisher ?? null,
        },
      });

      const ocrJob = await tx.ocrJob.create({
        data: {
          sourceFileId: sourceFile.id,
          autoAnalyze: args.meta?.autoAnalyze ?? true,
          documentType: args.meta?.documentType ?? "exam",
          bookTitle: args.meta?.bookTitle ?? null,
          publisher: args.meta?.publisher ?? null,
        },
      });

      return { sourceFile, ocrJob };
    });

    try {
      await this.eventBus.publishDurable("ocr:submit", {
        jobId: ocrJob.id,
        sourceFileId: sourceFile.id,
        s3Key: args.s3Key,
        answerS3Key: args.meta?.answerS3Key ?? null,
        filename: normalizedFilename,
        documentType: args.meta?.documentType ?? "exam",
        bookTitle: args.meta?.bookTitle ?? null,
        publisher: args.meta?.publisher ?? null,
      });
    } catch (error) {
      await this.prisma.ocrJob.update({
        where: { id: ocrJob.id },
        data: {
          status: "failed",
          errorMessage: QUEUE_FAILURE_MESSAGE,
          completedAt: new Date(),
        },
      });
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : QUEUE_FAILURE_MESSAGE,
      );
    }

    return {
      id: sourceFile.id,
      filename: normalizeFilename(sourceFile.filename) ?? sourceFile.filename,
      status: "pending",
      jobId: ocrJob.id,
    };
  }

  private async findExistingSourceFile(uploaderId: string, fileHash: string) {
    return this.prisma.sourceFile.findFirst({
      where: { uploaderId, fileHash },
      include: { ocrJobs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
  }

  private async reprocessExistingSourceFile(args: {
    existing: Awaited<ReturnType<SourceFileIngestionService["findExistingSourceFile"]>>;
    filename: string;
    meta?: UploadMeta;
  }) {
    const { existing, filename, meta } = args;
    if (!existing) {
      return null;
    }

    const normalizedFilename = normalizeFilename(filename) ?? filename;
    const docType = meta?.documentType ?? "exam";

    if (existing.documentType === docType) {
      return {
        id: existing.id,
        filename: normalizeFilename(existing.filename) ?? existing.filename,
        status: existing.ocrJobs[0]?.status ?? "pending",
        jobId: existing.ocrJobs[0]?.id ?? null,
      };
    }

    await this.prisma.sourceFile.update({
      where: { id: existing.id },
      data: {
        documentType: docType,
        bookTitle: meta?.bookTitle,
        publisher: meta?.publisher,
        answerS3Key: meta?.answerS3Key ?? null,
        filename: normalizedFilename,
      },
    });

    const ocrJob = await this.prisma.ocrJob.create({
      data: {
        sourceFileId: existing.id,
        autoAnalyze: meta?.autoAnalyze ?? true,
        documentType: docType,
        bookTitle: meta?.bookTitle ?? null,
        publisher: meta?.publisher ?? null,
      },
    });

    try {
      await this.eventBus.publishDurable("ocr:submit", {
        jobId: ocrJob.id,
        sourceFileId: existing.id,
        s3Key: existing.s3Key,
        answerS3Key: meta?.answerS3Key ?? existing.answerS3Key ?? null,
        filename: normalizedFilename,
        documentType: docType,
        bookTitle: meta?.bookTitle ?? null,
        publisher: meta?.publisher ?? null,
      });
    } catch (error) {
      await this.prisma.ocrJob.update({
        where: { id: ocrJob.id },
        data: {
          status: "failed",
          errorMessage: QUEUE_FAILURE_MESSAGE,
          completedAt: new Date(),
        },
      });
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : QUEUE_FAILURE_MESSAGE,
      );
    }

    return {
      id: existing.id,
      filename: normalizeFilename(existing.filename) ?? existing.filename,
      status: "pending",
      jobId: ocrJob.id,
    };
  }

  async uploadPdf(file: Express.Multer.File, uploaderId: string, meta?: UploadMeta) {
    if (!file) {
      throw new BadRequestException("No file provided");
    }
    if (!this.uploadPolicy.isPdfUpload(file)) {
      throw new BadRequestException("Uploaded file is not a valid PDF");
    }
    if (file.size > MAX_DIRECT_PDF_UPLOAD_BYTES) {
      throw new BadRequestException(
        "Direct PDF uploads are limited to 20MB. Please use multipart upload for larger files.",
      );
    }

    const fileHash = createHash("sha256").update(file.buffer).digest("hex");
    const normalizedFilename = normalizeFilename(file.originalname) ?? file.originalname;

    // Idempotency: same file + same document type → return existing
    const existing = await this.findExistingSourceFile(uploaderId, fileHash);
    const existingResult = await this.reprocessExistingSourceFile({
      existing,
      filename: normalizedFilename,
      meta,
    });
    if (existingResult) {
      return existingResult;
    }

    const s3Key = `uploads/${uploaderId}/${randomUUID()}.pdf`;

    await this.storage.uploadBuffer(s3Key, file.buffer);

    return this.createSourceFileAndQueueOcr({
      uploaderId,
      filename: normalizedFilename,
      s3Key,
      sizeBytes: file.size,
      fileHash,
      meta,
    });
  }

  async registerUploadedPdf(
    uploaderId: string,
    params: {
      key: string;
      filename: string;
      size: number;
      documentType: "exam" | "textbook";
      bookTitle?: string | null;
      publisher?: string | null;
      autoAnalyze?: boolean;
    },
  ) {
    const uploaded = await this.storage.ensureUploadedPdfObject(
      params.key,
      uploaderId,
      params.size,
    );

    const fileHash = createHash("sha256")
      .update(`${params.key}:${uploaded.etag ?? uploaded.sizeBytes}`)
      .digest("hex");
    const existing = await this.findExistingSourceFile(uploaderId, fileHash);
    const existingResult = await this.reprocessExistingSourceFile({
      existing,
      filename: params.filename,
      meta: {
        documentType: params.documentType,
        bookTitle: params.bookTitle ?? null,
        publisher: params.publisher ?? null,
        autoAnalyze: params.autoAnalyze ?? true,
      },
    });
    if (existingResult) {
      return existingResult;
    }

    return this.createSourceFileAndQueueOcr({
      uploaderId,
      filename: params.filename,
      s3Key: params.key,
      sizeBytes: uploaded.sizeBytes,
      fileHash,
      meta: {
        documentType: params.documentType,
        bookTitle: params.bookTitle ?? null,
        publisher: params.publisher ?? null,
        autoAnalyze: params.autoAnalyze ?? true,
      },
    });
  }

  async registerUploadedTextbook(
    uploaderId: string,
    params: {
      problemKey: string;
      problemFilename: string;
      problemSize: number;
      answerKey?: string | null;
      answerSize?: number | null;
      bookTitle: string;
      publisher?: string | null;
      autoAnalyze?: boolean;
    },
  ) {
    const problemUpload = await this.storage.ensureUploadedPdfObject(
      params.problemKey,
      uploaderId,
      params.problemSize,
    );

    let answerS3Key: string | null = null;
    if (params.answerKey) {
      await this.storage.ensureUploadedPdfObject(
        params.answerKey,
        uploaderId,
        params.answerSize ?? undefined,
      );
      answerS3Key = params.answerKey;
    }

    const fileHash = createHash("sha256")
      .update(
        `${params.problemKey}:${answerS3Key ?? ""}:${problemUpload.etag ?? problemUpload.sizeBytes}`,
      )
      .digest("hex");
    const existing = await this.findExistingSourceFile(uploaderId, fileHash);
    const existingResult = await this.reprocessExistingSourceFile({
      existing,
      filename: params.problemFilename,
      meta: {
        documentType: "textbook",
        bookTitle: params.bookTitle,
        publisher: params.publisher ?? null,
        answerS3Key,
        autoAnalyze: params.autoAnalyze ?? true,
      },
    });
    if (existingResult) {
      return existingResult;
    }

    return this.createSourceFileAndQueueOcr({
      uploaderId,
      filename: params.problemFilename,
      s3Key: params.problemKey,
      sizeBytes: problemUpload.sizeBytes,
      fileHash,
      meta: {
        documentType: "textbook",
        bookTitle: params.bookTitle,
        publisher: params.publisher ?? null,
        answerS3Key,
        autoAnalyze: params.autoAnalyze ?? true,
      },
    });
  }

  async registerUploadedExam(
    uploaderId: string,
    params: {
      problemKey: string;
      problemFilename: string;
      problemSize: number;
      answerKey?: string | null;
      answerSize?: number | null;
      autoAnalyze?: boolean;
    },
  ) {
    const problemUpload = await this.storage.ensureUploadedPdfObject(
      params.problemKey,
      uploaderId,
      params.problemSize,
    );

    let answerS3Key: string | null = null;
    if (params.answerKey) {
      await this.storage.ensureUploadedPdfObject(
        params.answerKey,
        uploaderId,
        params.answerSize ?? undefined,
      );
      answerS3Key = params.answerKey;
    }

    const fileHash = createHash("sha256")
      .update(
        `${params.problemKey}:${answerS3Key ?? ""}:${problemUpload.etag ?? problemUpload.sizeBytes}`,
      )
      .digest("hex");
    const existing = await this.findExistingSourceFile(uploaderId, fileHash);
    const existingResult = await this.reprocessExistingSourceFile({
      existing,
      filename: params.problemFilename,
      meta: {
        documentType: "exam",
        bookTitle: null,
        publisher: null,
        answerS3Key,
        autoAnalyze: params.autoAnalyze ?? true,
      },
    });
    if (existingResult) {
      return existingResult;
    }

    return this.createSourceFileAndQueueOcr({
      uploaderId,
      filename: params.problemFilename,
      s3Key: params.problemKey,
      sizeBytes: problemUpload.sizeBytes,
      fileHash,
      meta: {
        documentType: "exam",
        bookTitle: null,
        publisher: null,
        answerS3Key,
        autoAnalyze: params.autoAnalyze ?? true,
      },
    });
  }

  async uploadExamPdf(
    problemFile: Express.Multer.File,
    answerFile: Express.Multer.File | undefined,
    uploaderId: string,
    meta: UploadMeta,
  ) {
    if (!this.uploadPolicy.isPdfUpload(problemFile)) {
      throw new BadRequestException("problem_file must be a valid PDF");
    }
    if (answerFile && !this.uploadPolicy.isPdfUpload(answerFile)) {
      throw new BadRequestException("answer_file must be a valid PDF");
    }
    if (!answerFile) {
      return this.uploadPdf(problemFile, uploaderId, meta);
    }

    const combinedSize = problemFile.size + answerFile.size;
    if (combinedSize > MAX_DIRECT_EXAM_COMBINED_BYTES) {
      throw new BadRequestException(
        "Direct exam uploads are limited to a combined 25MB. Please use multipart upload for larger files.",
      );
    }

    const fileHash = createHash("sha256")
      .update(problemFile.buffer)
      .update(answerFile.buffer)
      .digest("hex");
    const existing = await this.findExistingSourceFile(uploaderId, fileHash);
    const existingResult = await this.reprocessExistingSourceFile({
      existing,
      filename: problemFile.originalname,
      meta: {
        documentType: "exam",
        bookTitle: null,
        publisher: null,
        answerS3Key: existing?.answerS3Key ?? null,
        autoAnalyze: meta.autoAnalyze ?? true,
      },
    });
    if (existingResult) {
      return existingResult;
    }

    const problemKey = `uploads/${uploaderId}/exam/${randomUUID()}.pdf`;
    const answerKey = `uploads/${uploaderId}/exam-answer/${randomUUID()}.pdf`;

    await this.storage.uploadBuffer(problemKey, problemFile.buffer);
    await this.storage.uploadBuffer(answerKey, answerFile.buffer);

    return this.createSourceFileAndQueueOcr({
      uploaderId,
      filename: problemFile.originalname,
      s3Key: problemKey,
      sizeBytes: combinedSize,
      fileHash,
      meta: {
        documentType: "exam",
        bookTitle: null,
        publisher: null,
        answerS3Key: answerKey,
        autoAnalyze: meta.autoAnalyze ?? true,
      },
    });
  }

  async uploadTextbookPdf(
    problemFile: Express.Multer.File,
    answerFile: Express.Multer.File | undefined,
    uploaderId: string,
    meta: UploadMeta,
  ) {
    if (!this.uploadPolicy.isPdfUpload(problemFile)) {
      throw new BadRequestException("problem_file must be a valid PDF");
    }
    if (answerFile && !this.uploadPolicy.isPdfUpload(answerFile)) {
      throw new BadRequestException("answer_file must be a valid PDF");
    }
    const combinedSize = problemFile.size + (answerFile?.size ?? 0);
    if (combinedSize > MAX_DIRECT_TEXTBOOK_COMBINED_BYTES) {
      throw new BadRequestException(
        "Direct textbook uploads are limited to a combined 25MB. Please use multipart upload for larger files.",
      );
    }

    if (!answerFile) {
      return this.uploadPdf(problemFile, uploaderId, meta);
    }

    try {
      const mergedBuffer = await this.pdfBundle.mergePdfBuffers([
        problemFile.buffer,
        answerFile.buffer,
      ]);

      const mergedFile = {
        ...problemFile,
        buffer: mergedBuffer,
        size: mergedBuffer.length,
        originalname: this.uploadPolicy.buildTextbookBundleFilename(
          problemFile.originalname,
          answerFile.originalname,
          meta.bookTitle,
        ),
        mimetype: "application/pdf",
      } satisfies Express.Multer.File;

      return this.uploadPdf(mergedFile, uploaderId, meta);
    } catch (error) {
      this.logger.warn(
        "Failed to merge textbook problem/answer PDFs",
        error instanceof Error ? error.stack : String(error),
      );
      throw new BadRequestException(
        "문제집 PDF와 답지 PDF를 병합하지 못했습니다. 파일 형식을 확인해주세요.",
      );
    }
  }

  async deleteFile(id: string, requesterId: string, requesterRole: string) {
    const sourceFile = await this.prisma.sourceFile.findFirst({
      where: {
        id,
        ...this.uploadPolicy.getSourceFileScopeWhere(requesterId, requesterRole),
      },
      include: { ocrJobs: { select: { id: true } } },
    });
    if (!sourceFile) throw new NotFoundException("File not found");

    const jobIds = sourceFile.ocrJobs.map((j) => j.id);
    const problemAssets = jobIds.length
      ? await this.prisma.problemAsset.findMany({
          where: { problem: { ocrJobId: { in: jobIds } } },
          select: { s3Key: true },
        })
      : [];

    // Delete in dependency order
    if (jobIds.length > 0) {
      await this.prisma.problemAsset.deleteMany({
        where: { problem: { ocrJobId: { in: jobIds } } },
      });
      await this.prisma.problemChoice.deleteMany({
        where: { problem: { ocrJobId: { in: jobIds } } },
      });
      await this.prisma.examQuestionMeta.updateMany({
        where: { problem: { ocrJobId: { in: jobIds } } },
        data: { problemId: null },
      });
      await this.prisma.problem.deleteMany({
        where: { ocrJobId: { in: jobIds } },
      });
      await this.prisma.ocrJob.deleteMany({
        where: { id: { in: jobIds } },
      });
    }

    await this.prisma.sourceFile.delete({ where: { id } });
    await this.storage.deleteS3Objects([
      sourceFile.s3Key,
      sourceFile.answerS3Key ?? "",
      ...problemAssets.map((asset) => asset.s3Key),
    ]);

    return { deleted: true };
  }

  async getStatus(id: string, requesterId: string, requesterRole: string) {
    const sourceFile = await this.prisma.sourceFile.findFirst({
      where: {
        id,
        ...this.uploadPolicy.getSourceFileScopeWhere(requesterId, requesterRole),
      },
      include: { ocrJobs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!sourceFile) throw new NotFoundException("File not found");

    const job = sourceFile.ocrJobs[0];
    return {
      id: sourceFile.id,
      filename: normalizeFilename(sourceFile.filename) ?? sourceFile.filename,
      status: job?.status ?? "pending",
      jobId: job?.id ?? null,
      problemCount: job?.problemCount ?? null,
      errorMessage: job?.errorMessage ?? null,
    };
  }

  async assertCanAccessOcrJob(
    jobId: string,
    requesterId: string,
    requesterRole: string,
  ) {
    const job = await this.prisma.ocrJob.findFirst({
      where: {
        id: jobId,
        sourceFile: this.uploadPolicy.getSourceFileScopeWhere(requesterId, requesterRole),
      },
      select: { id: true },
    });
    if (!job) {
      throw new NotFoundException("OCR job not found");
    }
    return job;
  }
}
