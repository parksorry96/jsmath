import {
  Injectable,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeFilename } from "../common/filename";
import { UploadPolicyService, MultipartUploadRole } from "./upload-policy.service";
import { FileStorageService, MultipartUploadPart } from "./file-storage.service";
import { SourceFileIngestionService, UploadMeta } from "./source-file-ingestion.service";
import { PipelineProgressService } from "./pipeline-progress.service";

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploadPolicy: UploadPolicyService,
    private readonly storage: FileStorageService,
    private readonly sourceFileIngestion: SourceFileIngestionService,
    private readonly progress: PipelineProgressService,
  ) {}

  // ── SSE ──

  getProgressStream() {
    return this.progress.getProgressStream();
  }

  // ── Upload / Multipart — delegate to storage ──

  async createMultipartUpload(
    uploaderId: string,
    params: {
      filename: string;
      size: number;
      role: MultipartUploadRole;
      contentType?: string | null;
    },
  ) {
    const normalizedFilename = normalizeFilename(params.filename) ?? params.filename;
    if (!normalizedFilename.toLowerCase().endsWith(".pdf")) {
      throw new BadRequestException("Only PDF files are accepted");
    }
    if (
      ![
        "exam",
        "exam_problem",
        "exam_answer",
        "textbook_problem",
        "textbook_answer",
      ].includes(params.role)
    ) {
      throw new BadRequestException("Invalid upload role");
    }
    if (!params.size || params.size <= 0) {
      throw new BadRequestException("size must be a positive number");
    }

    return this.storage.createMultipartUpload(uploaderId, params);
  }

  async getMultipartUploadUrls(
    uploaderId: string,
    params: {
      key: string;
      uploadId: string;
      partNumbers: number[];
    },
  ) {
    return this.storage.getMultipartUploadUrls(uploaderId, params);
  }

  async completeMultipartUpload(
    uploaderId: string,
    params: {
      key: string;
      uploadId: string;
      parts: MultipartUploadPart[];
    },
  ) {
    return this.storage.completeMultipartUpload(uploaderId, params);
  }

  async abortMultipartUpload(
    uploaderId: string,
    params: {
      key: string;
      uploadId: string;
    },
  ) {
    return this.storage.abortMultipartUpload(uploaderId, params);
  }

  // ── PDF upload / register — delegate to ingestion ──

  async uploadPdf(file: Express.Multer.File, uploaderId: string, meta?: UploadMeta) {
    return this.sourceFileIngestion.uploadPdf(file, uploaderId, meta);
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
    return this.sourceFileIngestion.registerUploadedPdf(uploaderId, params);
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
    return this.sourceFileIngestion.registerUploadedExam(uploaderId, params);
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
    return this.sourceFileIngestion.registerUploadedTextbook(uploaderId, params);
  }

  async uploadExamPdf(
    problemFile: Express.Multer.File,
    answerFile: Express.Multer.File | undefined,
    uploaderId: string,
    meta: UploadMeta,
  ) {
    return this.sourceFileIngestion.uploadExamPdf(problemFile, answerFile, uploaderId, meta);
  }

  async uploadTextbookPdf(
    problemFile: Express.Multer.File,
    answerFile: Express.Multer.File | undefined,
    uploaderId: string,
    meta: UploadMeta,
  ) {
    return this.sourceFileIngestion.uploadTextbookPdf(problemFile, answerFile, uploaderId, meta);
  }

  // ── Query ──

  async listFiles(requesterId: string, requesterRole: string) {
    const files = await this.prisma.sourceFile.findMany({
      where: this.uploadPolicy.getSourceFileScopeWhere(requesterId, requesterRole),
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
        filename: normalizeFilename(f.filename) ?? f.filename,
        createdAt: f.createdAt,
        ocrJobId: job?.id ?? null,
        ocrStatus: job?.status ?? null,
        problemCount: job?._count?.problems ?? 0,
        documentType: f.documentType ?? "exam",
        bookTitle: f.bookTitle ?? null,
        autoAnalyze: job?.autoAnalyze ?? true,
      };
    });
  }

  async getAssetUrl(
    s3Key: string,
    requesterId: string,
    requesterRole: string,
  ): Promise<{ url: string }> {
    return this.storage.getAssetUrl(s3Key, requesterId, requesterRole);
  }

  async getStatus(id: string, requesterId: string, requesterRole: string) {
    return this.sourceFileIngestion.getStatus(id, requesterId, requesterRole);
  }

  async deleteFile(id: string, requesterId: string, requesterRole: string) {
    return this.sourceFileIngestion.deleteFile(id, requesterId, requesterRole);
  }

  async assertCanAccessOcrJob(
    jobId: string,
    requesterId: string,
    requesterRole: string,
  ) {
    return this.sourceFileIngestion.assertCanAccessOcrJob(jobId, requesterId, requesterRole);
  }
}
