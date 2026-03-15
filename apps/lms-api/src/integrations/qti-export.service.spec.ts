import { QtiExportService } from "./qti-export.service";

describe("QtiExportService", () => {
  const prisma = {
    problem: {
      findFirst: jest.fn(),
    },
    assignment: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    class: {
      findMany: jest.fn(),
    },
  };

  let service: QtiExportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new QtiExportService(prisma as never);
  });

  it("scopes problem export to the requester's uploaded problems", async () => {
    prisma.problem.findFirst.mockResolvedValue({
      id: "problem-1",
      stemLatex: "",
      stemText: "문항",
      problemType: "short_answer",
      difficulty: null,
      subject: null,
      curriculumNodeId: null,
      answerText: "1",
      choices: [],
    });

    await service.exportProblem("problem-1", "teacher-1", "teacher");

    expect(prisma.problem.findFirst).toHaveBeenCalledWith({
      where: {
        id: "problem-1",
        ocrJob: {
          sourceFile: {
            uploaderId: "teacher-1",
          },
        },
      },
      include: {
        choices: { orderBy: { position: "asc" } },
      },
    });
  });
});
