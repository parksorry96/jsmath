import { OcrPipelineEventHandlerService } from "./ocr-pipeline-event-handler.service";

describe("OcrPipelineEventHandlerService", () => {
  it("re-syncs exam metadata when analysis completes", async () => {
    const prisma = {
      problem: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const eventBus = {};
    const materializer = {
      materialize: jest.fn(),
      syncExamMetadata: jest.fn().mockResolvedValue(undefined),
    };

    const service = new OcrPipelineEventHandlerService(
      prisma as never,
      eventBus as never,
      materializer as never,
    );

    await service.handle(
      "analysis:completed",
      JSON.stringify({ problemIds: ["problem-1", "problem-2"] }),
    );

    expect(prisma.problem.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["problem-1", "problem-2"] },
        analysisStatus: { not: "completed" },
      },
      data: { analysisStatus: "completed", analyzedAt: expect.any(Date) },
    });
    expect(materializer.syncExamMetadata).toHaveBeenCalledWith([
      "problem-1",
      "problem-2",
    ]);
  });

  it("marks failed analysis ids when analysis fails", async () => {
    const prisma = {
      problem: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const eventBus = {};
    const materializer = {
      materialize: jest.fn(),
      syncExamMetadata: jest.fn(),
    };

    const service = new OcrPipelineEventHandlerService(
      prisma as never,
      eventBus as never,
      materializer as never,
    );

    await service.handle(
      "analysis:failed",
      JSON.stringify({ problemIds: ["problem-3", "problem-4"] }),
    );

    expect(prisma.problem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["problem-3", "problem-4"] } },
      data: { analysisStatus: "failed" },
    });
  });
});
