import { ForbiddenException } from "@nestjs/common";
import { ExamDocumentsService } from "./exam-documents.service";

describe("ExamDocumentsService", () => {
  const prisma = {
    problem: {
      findMany: jest.fn(),
    },
    examDocument: {
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const config = {
    get: jest.fn((key: string, fallback?: string) => fallback),
    getOrThrow: jest.fn(() => "bucket"),
  };

  const latexCompiler = {
    compile: jest.fn(),
  };

  const queue = {
    add: jest.fn(),
  };

  const usageLogService = {
    logUsage: jest.fn(),
  };

  let service: ExamDocumentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExamDocumentsService(
      prisma as never,
      config as never,
      latexCompiler as never,
      queue as never,
      usageLogService as never,
    );
  });

  it("rejects document creation when any problem is outside the requester's scope", async () => {
    prisma.problem.findMany.mockResolvedValue([{ id: "problem-1" }]);

    await expect(
      service.create(
        {
          title: "중간고사",
          type: "exam",
          layoutConfig: {},
          problemIds: ["problem-1", "problem-2"],
        },
        "teacher-1",
        "teacher",
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.examDocument.create).not.toHaveBeenCalled();
  });
});
