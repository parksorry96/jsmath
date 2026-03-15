import { KnowledgeGraphService } from "./knowledge-graph.service";

describe("KnowledgeGraphService", () => {
  const prisma = {
    curriculumPrerequisite: {
      findMany: jest.fn(),
    },
    submissionAnswer: {
      findMany: jest.fn(),
    },
    problem: {
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("includes attempted topics even when no prerequisite edge exists for them", async () => {
    prisma.curriculumPrerequisite.findMany.mockResolvedValue([]);
    prisma.submissionAnswer.findMany.mockResolvedValue([
      { problemId: "problem-1", isCorrect: true },
    ]);
    prisma.problem.findMany.mockResolvedValue([
      { id: "problem-1", subject: "수학", unitMajor: "수열" },
    ]);

    const service = new KnowledgeGraphService(prisma as never);
    const result = await service.getStudentKnowledgeGraph("student-1");

    expect(result.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "수학::수열",
          subject: "수학",
          unit: "수열",
          accuracy: 100,
          totalAttempts: 1,
          totalCorrect: 1,
        }),
      ]),
    );
  });
});
