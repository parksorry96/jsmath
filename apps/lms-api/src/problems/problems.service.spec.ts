import { ProblemsService } from "./problems.service";

describe("ProblemsService", () => {
  const prisma = {
    $queryRawUnsafe: jest.fn(),
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
});
