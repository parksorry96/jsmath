import { ProblemsService } from "./problems.service";

describe("ProblemsService", () => {
  const prisma = {
    $queryRawUnsafe: jest.fn(),
    $transaction: jest.fn(),
    problem: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    ocrJob: {
      findUnique: jest.fn(),
    },
    assignmentProblem: {
      findMany: jest.fn(),
    },
    examQuestionMeta: {
      updateMany: jest.fn(),
    },
  };

  const eventBus = {
    publishDurable: jest.fn(),
  };

  const twinProblemService = {
    generate: jest.fn(),
    generateVariants: jest.fn(),
  };

  const embeddingService = {
    embed: jest.fn(),
  };

  const problemRevisionService = {
    saveRevisionAndUpdate: jest.fn(),
  };

  let service: ProblemsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) => callback(prisma as any));
    service = new ProblemsService(
      prisma as never,
      eventBus as never,
      twinProblemService as never,
      embeddingService as never,
      problemRevisionService as never,
    );
  });

  it("scopes semantic search to the requester's uploaded problems", async () => {
    embeddingService.embed.mockResolvedValue([0.1, 0.2, 0.3]);
    prisma.$queryRawUnsafe.mockResolvedValue([]);

    await service.semanticSearch("삼차함수", {
      requesterId: "teacher-1",
      requesterRole: "teacher",
      subject: "math",
    });

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toContain(
      "JOIN ocr.source_files sf ON sf.id = oj.source_file_id",
    );
    expect(prisma.$queryRawUnsafe.mock.calls[0][1]).toBe("teacher-1");
  });

  it("applies elective subject context to include common CSAT questions and resolve matching exam meta", async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ total: BigInt(0) }])
      .mockResolvedValueOnce([]);

    await service.findAll({
      requesterId: "teacher-1",
      requesterRole: "teacher",
      electiveSubject: "확률과 통계",
      sortBy: "newest",
      page: 1,
      limit: 20,
    });

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);
    const [countSql, ...countParams] = prisma.$queryRawUnsafe.mock.calls[0];
    const [dataSql, ...dataParams] = prisma.$queryRawUnsafe.mock.calls[1];

    expect(countSql).toContain("COALESCE((p.exam_source->>'isCommon')::boolean, p.is_common, false) = true");
    expect(dataSql).toContain("regexp_replace(eqm2.subject, '\\s+', '', 'g') = $2");
    expect(dataSql).toContain("eqm2.exam_year = CASE WHEN (p.exam_source->>'year') ~ '^\\d+$' THEN (p.exam_source->>'year')::int ELSE NULL END");
    expect(countParams).toContain("teacher-1");
    expect(countParams).toContain("확률과통계");
    expect(dataParams).toContain("teacher-1");
    expect(dataParams).toContain("확률과통계");
  });

  it("clears linked exam metadata when a problem is retired", async () => {
    prisma.problem.findUnique.mockResolvedValue({
      id: "problem-1",
      ocrJobId: "job-1",
      retiredAt: null,
    });
    prisma.ocrJob.findUnique.mockResolvedValue({
      sourceFile: { uploaderId: "teacher-1" },
    });
    prisma.assignmentProblem.findMany.mockResolvedValue([]);
    prisma.problem.update.mockResolvedValue({});
    prisma.examQuestionMeta.updateMany.mockResolvedValue({ count: 2 });

    await service.retireProblem("problem-1", "teacher-1", "teacher");

    expect(prisma.problem.update).toHaveBeenCalledWith({
      where: { id: "problem-1" },
      data: expect.objectContaining({
        reviewStatus: "retired",
        retiredBy: "teacher-1",
        retiredAt: expect.any(Date),
      }),
    });
    expect(prisma.examQuestionMeta.updateMany).toHaveBeenCalledWith({
      where: { problemId: "problem-1" },
      data: { problemId: null },
    });
  });

  it("falls back to classification2015 when flat subject fields are blank", async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ total: BigInt(1) }])
      .mockResolvedValueOnce([
        {
          id: "problem-29",
          stem_latex: "문제",
          stem_text: "문제",
          problem_number: "29",
          display_number: "29.",
          problem_type: "short_answer",
          review_status: "pending_review",
          grade_level: null,
          subject: null,
          unit_major: null,
          unit_minor: null,
          difficulty: null,
          classification_confidence: null,
          classification_2015: {
            subject: "미적분",
            unitMajor: "적분법",
            unitMinor: "정적분의 활용",
            confidence: 0.91,
          },
          classification_2022: null,
          solution_confidence: null,
          review_confidence: null,
          solution_tags: null,
          analysis_status: "completed",
          ocr_job_id: "job-1",
          start_page: 1,
          end_page: 1,
          book_source: null,
          exam_source: null,
          answer_match_status: null,
          created_at: new Date(),
          bbox: null,
          source_filename: "mock.pdf",
          meta_exam_year: null,
        },
      ]);

    const result = await service.findAll({
      requesterId: "teacher-1",
      requesterRole: "teacher",
      sortBy: "newest",
      page: 1,
      limit: 20,
    });

    expect(result.data[0]).toMatchObject({
      subject: "미적분",
      unitMajor: "적분법",
      unitMinor: "정적분의 활용",
      classificationConfidence: 0.91,
    });
  });
});
