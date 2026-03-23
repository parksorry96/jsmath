import { OcrProblemMaterializerService } from "./ocr-problem-materializer.service";

describe("OcrProblemMaterializerService", () => {
  const uploadPolicy = {
    sanitizeBookSource: jest.fn().mockReturnValue(undefined),
  };

  let prisma: {
    sourceFile: { findUnique: jest.Mock };
    problem: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    problemAsset: { create: jest.Mock };
    examQuestionMeta: { findMany: jest.Mock; updateMany: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      sourceFile: {
        findUnique: jest.fn(),
      },
      problem: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      problemAsset: {
        create: jest.fn(),
      },
      examQuestionMeta: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    jest.clearAllMocks();
    uploadPolicy.sanitizeBookSource.mockReturnValue(undefined);
  });

  it("skips duplicate OCR problems across different jobs when content matches", async () => {
    prisma.sourceFile.findUnique.mockResolvedValue({ filename: "duplicate.pdf" });
    prisma.problem.findMany.mockResolvedValue([
      {
        id: "existing-problem",
        problemType: "multiple_choice",
        problemNumber: "24",
        displayNumber: "24.",
        startPage: 1,
        endPage: 1,
        stemLatex: "f(x)=x^2일 때",
        stemText: "f(x)=x^2일 때",
        bbox: null,
        choices: [
          { position: 1, label: "①", contentLatex: "1", contentText: "1" },
          { position: 2, label: "②", contentLatex: "2", contentText: "2" },
          { position: 3, label: "③", contentLatex: "3", contentText: "3" },
          { position: 4, label: "④", contentLatex: "4", contentText: "4" },
          { position: 5, label: "⑤", contentLatex: "5", contentText: "5" },
        ],
        assets: [],
      },
    ]);
    prisma.examQuestionMeta.findMany.mockResolvedValue([]);

    const service = new OcrProblemMaterializerService(
      prisma as never,
      uploadPolicy as never,
    );

    const result = await service.materialize("job-2", "source-1", [
      {
        problemNumber: "24",
        displayNumber: "24.",
        problemType: "multiple_choice",
        startPage: 3,
        endPage: 3,
        stemLatex: "f(x)=x^2일 때",
        stemText: "f(x)=x^2일 때",
        choices: [
          { position: 1, label: "①", contentLatex: "1", contentText: "1" },
          { position: 2, label: "②", contentLatex: "2", contentText: "2" },
          { position: 3, label: "③", contentLatex: "3", contentText: "3" },
          { position: 4, label: "④", contentLatex: "4", contentText: "4" },
          { position: 5, label: "⑤", contentLatex: "5", contentText: "5" },
        ],
      },
    ]);

    expect(result).toEqual({
      createdIds: [],
      skippedCount: 1,
      failedCount: 0,
    });
    expect(prisma.problem.create).not.toHaveBeenCalled();
  });

  it("links matched exam metadata when a new OCR problem is created", async () => {
    prisma.sourceFile.findUnique.mockResolvedValue({ filename: "2025-11-수능-미적분.pdf" });
    prisma.problem.findMany.mockResolvedValue([]);
    prisma.problem.create.mockResolvedValue({
      id: "problem-new",
      problemType: "multiple_choice",
    });
    prisma.examQuestionMeta.findMany.mockResolvedValue([
      {
        id: "meta-1",
        problemId: null,
        subject: "미적분",
      },
    ]);
    prisma.examQuestionMeta.updateMany.mockResolvedValue({ count: 1 });

    const service = new OcrProblemMaterializerService(
      prisma as never,
      uploadPolicy as never,
    );

    const result = await service.materialize("job-1", "source-1", [
      {
        problemNumber: "24",
        displayNumber: "24.",
        problemType: "multiple_choice",
        startPage: 1,
        endPage: 1,
        stemLatex: "g(x)를 구하시오.",
        stemText: "g(x)를 구하시오.",
        subject: "미적분",
        examSource: {
          year: 2025,
          month: 11,
          type: "수능",
          number: 24,
        },
        choices: [
          { position: 1, label: "①", contentLatex: "1", contentText: "1" },
          { position: 2, label: "②", contentLatex: "2", contentText: "2" },
          { position: 3, label: "③", contentLatex: "3", contentText: "3" },
          { position: 4, label: "④", contentLatex: "4", contentText: "4" },
          { position: 5, label: "⑤", contentLatex: "5", contentText: "5" },
        ],
      },
    ]);

    expect(result.createdIds).toEqual(["problem-new"]);
    expect(prisma.examQuestionMeta.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["meta-1"] } },
      data: { problemId: "problem-new" },
    });
  });

  it("normalizes academic-year suneung filenames to the prior calendar year", async () => {
    const service = new OcrProblemMaterializerService(
      prisma as never,
      uploadPolicy as never,
    );

    const lookup = (service as any).resolveExamMetaLookup(
      {
        problemNumber: "24",
        displayNumber: "24.",
        examSource: {
          type: "수능",
          subject: "미적분",
          number: 24,
        },
      },
      "2026학년도_수능_수학_문제_미적분.pdf",
    );

    expect(lookup).toEqual({
      examYear: 2025,
      examMonth: 11,
      examType: "suneung",
      questionNumber: 24,
      subjectCandidates: ["미적분"],
      matchAllSubjects: false,
    });
  });

  it("links common-section metadata to a single subject when the subject is known", async () => {
    prisma.problem.findMany.mockResolvedValue([
      {
        id: "problem-1",
        problemNumber: "5",
        displayNumber: "5.",
        subject: "수학I",
        isCommon: true,
        examSource: {
          year: 2025,
          month: 11,
          type: "수능",
          number: 5,
        },
        ocrJob: {
          sourceFile: {
            filename: "2025-11-수능-미적분.pdf",
          },
        },
      },
    ]);
    prisma.examQuestionMeta.findMany.mockResolvedValue([
      { id: "meta-a", problemId: null, subject: "미적분" },
    ]);
    prisma.examQuestionMeta.updateMany.mockResolvedValue({ count: 1 });

    const service = new OcrProblemMaterializerService(
      prisma as never,
      uploadPolicy as never,
    );

    await service.syncExamMetadata(["problem-1"]);

    expect(prisma.examQuestionMeta.findMany).toHaveBeenCalledWith({
      where: {
        examYear: 2025,
        examMonth: 11,
        examType: "suneung",
        questionNumber: 5,
        subject: { in: ["미적분"] },
      },
      select: {
        id: true,
        problemId: true,
        subject: true,
      },
    });
    expect(prisma.examQuestionMeta.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["meta-a"] } },
      data: { problemId: "problem-1" },
    });
  });

  it("links common-section metadata across all subjects when no elective hint exists", async () => {
    prisma.problem.findMany.mockResolvedValue([
      {
        id: "problem-2",
        problemNumber: "8",
        displayNumber: "8.",
        subject: "수학I",
        isCommon: true,
        examSource: {
          year: 2025,
          month: 11,
          type: "수능",
          number: 8,
        },
        ocrJob: {
          sourceFile: {
            filename: "2026학년도_수능_수학_문제.pdf",
          },
        },
      },
    ]);
    prisma.examQuestionMeta.findMany.mockResolvedValue([
      { id: "meta-a", problemId: null, subject: "미적분" },
      { id: "meta-b", problemId: null, subject: "기하" },
      { id: "meta-c", problemId: null, subject: "확률과통계" },
    ]);
    prisma.examQuestionMeta.updateMany.mockResolvedValue({ count: 3 });

    const service = new OcrProblemMaterializerService(
      prisma as never,
      uploadPolicy as never,
    );

    await service.syncExamMetadata(["problem-2"]);

    expect(prisma.examQuestionMeta.findMany).toHaveBeenCalledWith({
      where: {
        examYear: 2025,
        examMonth: 11,
        examType: "suneung",
        questionNumber: 8,
      },
      select: {
        id: true,
        problemId: true,
        subject: true,
      },
    });
    expect(prisma.examQuestionMeta.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["meta-a", "meta-b", "meta-c"] } },
      data: { problemId: "problem-2" },
    });
  });
});
