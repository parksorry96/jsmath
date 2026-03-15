import { BadRequestException } from "@nestjs/common";
import { RemediationService } from "./remediation.service";

jest.mock("../common/access-control", () => ({
  canAccessAssignment: jest.fn().mockResolvedValue(true),
}));

describe("RemediationService", () => {
  const prisma = {
    assignment: {
      findUnique: jest.fn(),
    },
    submission: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("requires studentId when a class-wide assignment has multiple graded submissions", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: "assignment-1",
      title: "중간 점검",
      classId: "class-1",
      targetStudentId: null,
    });
    prisma.submission.findMany.mockResolvedValue([
      { studentId: "student-1" },
      { studentId: "student-2" },
    ]);

    const service = new RemediationService(prisma as never);

    await expect(
      service.generateForAssignment(
        "assignment-1",
        "teacher-1",
        "teacher",
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.submission.findFirst).not.toHaveBeenCalled();
  });
});
