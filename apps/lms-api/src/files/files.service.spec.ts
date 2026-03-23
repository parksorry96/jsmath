import { BadRequestException, NotFoundException } from "@nestjs/common";
import { FilesService } from "./files.service";

describe("FilesService", () => {
  let service: FilesService;

  const prisma = {
    sourceFile: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    ocrJob: {
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
    },
    problem: {
      create: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    problemAsset: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    problemChoice: {
      deleteMany: jest.fn(),
    },
  };

  const uploadPolicy = {
    isPdfUpload: jest.fn().mockReturnValue(true),
    buildMultipartUploadKey: jest
      .fn()
      .mockReturnValue("uploads/user-1/exam/mock-uuid.pdf"),
    assertScopedUploadKey: jest.fn(),
    getSourceFileScopeWhere: jest.fn().mockReturnValue({ uploaderId: "user-1" }),
    getProblemAssetScopeWhere: jest.fn().mockReturnValue({}),
    sanitizeBookSource: jest.fn().mockReturnValue(undefined),
    buildTextbookBundleFilename: jest.fn().mockReturnValue("bundle.pdf"),
  };

  const fileStorage = {
    ensureUploadedPdfObject: jest.fn(),
    createMultipartUpload: jest.fn(),
    getMultipartUploadUrls: jest.fn(),
    completeMultipartUpload: jest.fn(),
    abortMultipartUpload: jest.fn(),
    deleteS3Objects: jest.fn().mockResolvedValue(undefined),
    getAssetUrl: jest.fn(),
    uploadBuffer: jest.fn().mockResolvedValue(undefined),
  };

  const sourceFileIngestion = {
    uploadPdf: jest.fn(),
    uploadExamPdf: jest.fn(),
    uploadTextbookPdf: jest.fn(),
    registerUploadedPdf: jest.fn(),
    registerUploadedExam: jest.fn(),
    registerUploadedTextbook: jest.fn(),
    deleteFile: jest.fn(),
    getStatus: jest.fn(),
    assertCanAccessOcrJob: jest.fn(),
  };

  const pipelineProgress = {
    getProgressStream: jest.fn().mockReturnValue({ pipe: jest.fn() }),
    emit: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    uploadPolicy.isPdfUpload.mockReturnValue(true);
    uploadPolicy.buildMultipartUploadKey.mockReturnValue(
      "uploads/user-1/exam/mock-uuid.pdf",
    );
    uploadPolicy.assertScopedUploadKey.mockImplementation(() => undefined);
    uploadPolicy.getSourceFileScopeWhere.mockReturnValue({ uploaderId: "user-1" });
    uploadPolicy.getProblemAssetScopeWhere.mockReturnValue({});
    uploadPolicy.sanitizeBookSource.mockReturnValue(undefined);
    service = new FilesService(
      prisma as never,
      uploadPolicy as never,
      fileStorage as never,
      sourceFileIngestion as never,
      pipelineProgress as never,
    );
  });

  // ── 1. createMultipartUpload + completeMultipartUpload ──

  describe("createMultipartUpload", () => {
    it("returns key, uploadId, partSize, partCount", async () => {
      fileStorage.createMultipartUpload.mockResolvedValue({
        key: "uploads/user-1/exam/some-uuid.pdf",
        uploadId: "upload-123",
        partSize: 10 * 1024 * 1024,
        partCount: 3,
      });

      const result = await service.createMultipartUpload("user-1", {
        filename: "math-exam.pdf",
        size: 25 * 1024 * 1024,
        role: "exam",
      });

      expect(result.key).toBe("uploads/user-1/exam/some-uuid.pdf");
      expect(result.uploadId).toBe("upload-123");
      expect(result.partSize).toBe(10 * 1024 * 1024);
      expect(result.partCount).toBe(3);
      expect(fileStorage.createMultipartUpload).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ role: "exam" }),
      );
    });

    it("uses textbook folder for textbook_problem role", async () => {
      fileStorage.createMultipartUpload.mockResolvedValue({
        key: "uploads/user-1/textbook/uuid.pdf",
        uploadId: "upload-456",
        partSize: 10 * 1024 * 1024,
        partCount: 1,
      });

      const result = await service.createMultipartUpload("user-1", {
        filename: "book.pdf",
        size: 5 * 1024 * 1024,
        role: "textbook_problem",
      });

      expect(result.key).toBe("uploads/user-1/textbook/uuid.pdf");
      expect(fileStorage.createMultipartUpload).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ role: "textbook_problem" }),
      );
    });

    it("rejects non-PDF filename", async () => {
      await expect(
        service.createMultipartUpload("user-1", {
          filename: "photo.png",
          size: 1024,
          role: "exam",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects invalid role", async () => {
      await expect(
        service.createMultipartUpload("user-1", {
          filename: "file.pdf",
          size: 1024,
          role: "invalid" as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects zero size", async () => {
      await expect(
        service.createMultipartUpload("user-1", {
          filename: "file.pdf",
          size: 0,
          role: "exam",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects negative size", async () => {
      await expect(
        service.createMultipartUpload("user-1", {
          filename: "file.pdf",
          size: -100,
          role: "exam",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("completeMultipartUpload", () => {
    it("delegates to FileStorageService and returns result", async () => {
      fileStorage.completeMultipartUpload.mockResolvedValue({
        key: "uploads/user-1/exam/test-uuid.pdf",
        sizeBytes: 5000,
      });

      const result = await service.completeMultipartUpload("user-1", {
        key: "uploads/user-1/exam/test-uuid.pdf",
        uploadId: "upload-123",
        parts: [{ partNumber: 1, etag: "etag-1" }],
      });

      expect(fileStorage.completeMultipartUpload).toHaveBeenCalledWith(
        "user-1",
        {
          key: "uploads/user-1/exam/test-uuid.pdf",
          uploadId: "upload-123",
          parts: [{ partNumber: 1, etag: "etag-1" }],
        },
      );
      expect(result).toEqual({ key: "uploads/user-1/exam/test-uuid.pdf", sizeBytes: 5000 });
    });
  });

  // ── 2. registerUploadedExam / registerUploadedTextbook (delegated) ──

  describe("registerUploadedExam", () => {
    it("delegates to sourceFileIngestion.registerUploadedExam", async () => {
      sourceFileIngestion.registerUploadedExam.mockResolvedValue({
        id: "sf-exam-1",
        filename: "mock-exam.pdf",
        status: "pending",
        jobId: "job-exam-1",
      });

      const result = await service.registerUploadedExam("user-1", {
        problemKey: "uploads/user-1/exam/mock.pdf",
        problemFilename: "mock-exam.pdf",
        problemSize: 1000,
        answerKey: "uploads/user-1/exam-answer/mock-answer.pdf",
        answerSize: 600,
      });

      expect(result).toEqual({
        id: "sf-exam-1",
        filename: "mock-exam.pdf",
        status: "pending",
        jobId: "job-exam-1",
      });
      expect(sourceFileIngestion.registerUploadedExam).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({
          problemKey: "uploads/user-1/exam/mock.pdf",
          answerKey: "uploads/user-1/exam-answer/mock-answer.pdf",
        }),
      );
    });
  });

  describe("registerUploadedTextbook", () => {
    it("delegates to sourceFileIngestion.registerUploadedTextbook", async () => {
      sourceFileIngestion.registerUploadedTextbook.mockResolvedValue({
        id: "sf-1",
        filename: "textbook.pdf",
        status: "pending",
        jobId: "job-1",
      });

      const result = await service.registerUploadedTextbook("user-1", {
        problemKey: "uploads/user-1/textbook/prob.pdf",
        problemFilename: "textbook.pdf",
        problemSize: 1000,
        answerKey: "uploads/user-1/textbook-answer/ans.pdf",
        answerSize: 500,
        bookTitle: "Math Book",
        publisher: "Publisher A",
      });

      expect(result).toEqual({
        id: "sf-1",
        filename: "textbook.pdf",
        status: "pending",
        jobId: "job-1",
      });
      expect(sourceFileIngestion.registerUploadedTextbook).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({
          problemKey: "uploads/user-1/textbook/prob.pdf",
          answerKey: "uploads/user-1/textbook-answer/ans.pdf",
          bookTitle: "Math Book",
        }),
      );
    });
  });

  // ── 3. uploadPdf (delegated to SourceFileIngestionService) ──

  describe("uploadPdf delegation", () => {
    it("delegates to sourceFileIngestion.uploadPdf", async () => {
      const pdfBuffer = Buffer.alloc(1024);
      pdfBuffer.write("%PDF", 0, "utf8");
      sourceFileIngestion.uploadPdf.mockResolvedValue({
        id: "sf-1",
        filename: "exam.pdf",
        status: "pending",
        jobId: "job-1",
      });

      const file = {
        buffer: pdfBuffer,
        originalname: "exam.pdf",
        size: pdfBuffer.length,
      } as Express.Multer.File;
      const meta = { documentType: "exam", bookTitle: null, publisher: null };

      const result = await service.uploadPdf(file, "user-1", meta);

      expect(result).toEqual({
        id: "sf-1",
        filename: "exam.pdf",
        status: "pending",
        jobId: "job-1",
      });
      expect(sourceFileIngestion.uploadPdf).toHaveBeenCalledWith(file, "user-1", meta);
    });
  });

  // ── 4. getAssetUrl ──

  describe("getAssetUrl", () => {
    it("delegates to FileStorageService and returns signed URL", async () => {
      fileStorage.getAssetUrl.mockResolvedValue({
        url: "https://signed-url.example.com/test",
      });

      const result = await service.getAssetUrl(
        "problems/img.png",
        "user-1",
        "teacher",
      );

      expect(result).toEqual({
        url: "https://signed-url.example.com/test",
      });
      expect(fileStorage.getAssetUrl).toHaveBeenCalledWith(
        "problems/img.png",
        "user-1",
        "teacher",
      );
    });

    it("admin can access any asset via storage delegation", async () => {
      fileStorage.getAssetUrl.mockResolvedValue({
        url: "https://signed-url.example.com/test",
      });

      await service.getAssetUrl("problems/img.png", "admin-1", "admin");

      expect(fileStorage.getAssetUrl).toHaveBeenCalledWith(
        "problems/img.png",
        "admin-1",
        "admin",
      );
    });

    it("propagates NotFoundException from FileStorageService", async () => {
      fileStorage.getAssetUrl.mockRejectedValue(
        new NotFoundException("Asset not found"),
      );

      await expect(
        service.getAssetUrl("problems/missing.png", "user-1", "teacher"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("propagates BadRequestException for invalid keys from FileStorageService", async () => {
      fileStorage.getAssetUrl.mockRejectedValue(
        new BadRequestException("Invalid asset key"),
      );

      await expect(
        service.getAssetUrl("../etc/passwd", "user-1", "teacher"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── 5. deleteFile (delegated to SourceFileIngestionService) ──

  describe("deleteFile", () => {
    it("delegates to sourceFileIngestion.deleteFile", async () => {
      sourceFileIngestion.deleteFile.mockResolvedValue({ deleted: true });

      const result = await service.deleteFile("sf-1", "user-1", "teacher");

      expect(result).toEqual({ deleted: true });
      expect(sourceFileIngestion.deleteFile).toHaveBeenCalledWith("sf-1", "user-1", "teacher");
    });

    it("propagates NotFoundException from sourceFileIngestion", async () => {
      sourceFileIngestion.deleteFile.mockRejectedValue(
        new NotFoundException("File not found"),
      );

      await expect(
        service.deleteFile("no-such-id", "user-1", "teacher"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── 6. listFiles ──

  describe("listFiles", () => {
    it("returns formatted file list with ocrJob info", async () => {
      prisma.sourceFile.findMany.mockResolvedValue([
        {
          id: "sf-1",
          filename: "exam.pdf",
          createdAt: new Date("2026-01-01"),
          documentType: "exam",
          bookTitle: null,
          ocrJobs: [
            {
              id: "job-1",
              status: "completed",
              autoAnalyze: true,
              _count: { problems: 5 },
            },
          ],
        },
      ]);

      const result = await service.listFiles("user-1", "teacher");

      expect(result).toEqual([
        {
          id: "sf-1",
          filename: "exam.pdf",
          createdAt: new Date("2026-01-01"),
          ocrJobId: "job-1",
          ocrStatus: "completed",
          problemCount: 5,
          documentType: "exam",
          bookTitle: null,
          autoAnalyze: true,
        },
      ]);
    });
  });
});
