import { NotFoundException } from "@nestjs/common";
import { TutorService } from "./tutor.service";

describe("TutorService", () => {
  const prisma = {
    problem: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("hides unapproved problems from students when creating sessions", async () => {
    prisma.problem.findFirst.mockResolvedValue(null);

    const service = new TutorService(prisma as never, {} as never);

    await expect(
      service.createSession("student-1", "problem-1"),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.problem.findFirst).toHaveBeenCalledWith({
      where: {
        id: "problem-1",
        reviewStatus: { in: ["approved", "auto_approved"] },
      },
    });
  });
});
