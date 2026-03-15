import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  OnModuleDestroy,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { createHash, randomUUID } from "crypto";
import { Redis } from "ioredis";
import { normalizeFilename } from "../common/filename";
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

const MAX_DIRECT_PDF_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_DIRECT_TEXTBOOK_COMBINED_BYTES = 150 * 1024 * 1024;

@Injectable()
export class SourceFileIngestionService implements OnModuleDestroy {
  private readonly logger = new Logger(SourceFileIngestionService.name);
  private redisPublisher: Redis;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private uploadPolicy: UploadPolicyService,
    private storage: FileStorageService,
    private pdfBundle: PdfBundleService,
  ) {
    const redisUrl = this.config.getOrThrow<string>("REDIS_URL");
    this.redisPublisher = new Redis(redisUrl);
  }

  async onModuleDestroy() {
    await this.redisPublisher.quit();
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
    const sourceFile = await this.prisma.sourceFile.create({
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

    const ocrJob = await this.prisma.ocrJob.create({
      data: {
        sourceFileId: sourceFile.id,
        autoAnalyze: args.meta?.autoAnalyze ?? true,
        documentType: args.meta?.documentType ?? "exam",
        bookTitle: args.meta?.bookTitle ?? null,
        publisher: args.meta?.publisher ?? null,
      },
    });

    await this.redisPublisher.publish(
      "ocr:submit",
      JSON.stringify({
        jobId: ocrJob.id,
        sourceFileId: sourceFile.id,
        s3Key: args.s3Key,
        answerS3Key: args.meta?.answerS3Key ?? null,
        filename: normalizedFilename,
        documentType: args.meta?.documentType ?? "exam",
        bookTitle: args.meta?.bookTitle ?? null,
        publisher: args.meta?.publisher ?? null,
      }),
    );

    return {
      id: sourceFile.id,
      filename: normalizeFilename(sourceFile.filename) ?? sourceFile.filename,
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
        "Direct PDF uploads are limited to 100MB. Please use multipart upload for larger files.",
      );
    }

    const fileHash = createHash("sha256").update(file.buffer).digest("hex");
    const normalizedFilename = normalizeFilename(file.originalname) ?? file.originalname;

    // Idempotency: same file + same document type → return existing
    const docType = meta?.documentType ?? "exam";
    const existing = await this.prisma.sourceFile.findFirst({
      where: { uploaderId, fileHash },
      include: { ocrJobs: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (existing && existing.documentType === docType) {
      return {
        id: existing.id,
        filename: normalizeFilename(existing.filename) ?? existing.filename,
        status: existing.ocrJobs[0]?.status ?? "pending",
        jobId: existing.ocrJobs[0]?.id ?? null,
      };
    }
    // Same file but different type → update source and re-process
    if (existing) {
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
      await this.redisPublisher.publish(
        "ocr:submit",
        JSON.stringify({
          jobId: ocrJob.id,
          sourceFileId: existing.id,
          s3Key: existing.s3Key,
          answerS3Key: meta?.answerS3Key ?? existing.answerS3Key ?? null,
          filename: normalizedFilename,
          documentType: docType,
          bookTitle: meta?.bookTitle ?? null,
          publisher: meta?.publisher ?? null,
        }),
      );
      return {
        id: existing.id,
        filename: normalizeFilename(existing.filename) ?? existing.filename,
        status: "pending",
        jobId: ocrJob.id,
      };
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

    return this.createSourceFileAndQueueOcr({
      uploaderId,
      filename: params.filename,
      s3Key: params.key,
      sizeBytes: uploaded.sizeBytes,
      fileHash: createHash("sha256")
        .update(`${params.key}:${uploaded.etag ?? uploaded.sizeBytes}`)
        .digest("hex"),
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

    return this.createSourceFileAndQueueOcr({
      uploaderId,
      filename: params.problemFilename,
      s3Key: params.problemKey,
      sizeBytes: problemUpload.sizeBytes,
      fileHash: createHash("sha256")
        .update(
          `${params.problemKey}:${answerS3Key ?? ""}:${problemUpload.etag ?? problemUpload.sizeBytes}`,
        )
        .digest("hex"),
      meta: {
        documentType: "textbook",
        bookTitle: params.bookTitle,
        publisher: params.publisher ?? null,
        answerS3Key,
        autoAnalyze: params.autoAnalyze ?? true,
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
        "Direct textbook uploads are limited to a combined 150MB. Please use multipart upload for larger files.",
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
