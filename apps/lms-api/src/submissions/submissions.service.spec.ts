import { BadRequestException } from "@nestjs/common";
import { SubmissionsService } from "./submissions.service";
import {
  canAccessAssignment,
} from "../common/access-control";

jest.mock("../common/access-control", () => ({
  canAccessAssignment: jest.fn(),
  canAccessStudentData: jest.fn(),
  canAccessSubmission: jest.fn(),
  getAccessibleClassIds: jest.fn(),
  getLinkedStudentIds: jest.fn(),
  isPrivilegedRole: jest.fn((role: string) => role === "admin" || role === "teacher"),
}));

describe("SubmissionsService", () => {
  const prisma = {
    assignment: {
      findUnique: jest.fn(),
    },
    submission: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    problem: {
      findMany: jest.fn(),
    },
    submissionAnswer: {
      update: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (canAccessAssignment as jest.Mock).mockResolvedValue(true);
    prisma.submission.findFirst.mockResolvedValue(null);
  });

  it("rejects answers for problems that are not in the assignment", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: "assignment-1",
      maxScore: 100,
      assignmentProblems: [{ problemId: "problem-1" }],
    });

    const service = new SubmissionsService(prisma as never);

    await expect(
      service.submit("student-1", {
        assignmentId: "assignment-1",
        type: "online",
        answers: [{ problemId: "problem-x", studentAnswer: "1" }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.submission.create).not.toHaveBeenCalled();
  });

  it("creates answer rows for every assignment problem", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: "assignment-1",
      maxScore: 100,
      assignmentProblems: [{ problemId: "problem-1" }, { problemId: "problem-2" }],
    });
    prisma.submission.create.mockResolvedValue({
      id: "submission-1",
      answers: [{ id: "answer-1" }, { id: "answer-2" }],
    });

    const service = new SubmissionsService(prisma as never);
    jest.spyOn(service, "autoGrade").mockResolvedValue({ id: "submission-1" } as never);

    await service.submit("student-1", {
      assignmentId: "assignment-1",
      type: "online",
      answers: [{ problemId: "problem-1", studentAnswer: "42" }],
    });

    expect(prisma.submission.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assignmentId: "assignment-1",
        studentId: "student-1",
        type: "online",
        maxScore: 100,
        answers: {
          create: [
            { problemId: "problem-1", studentAnswer: "42" },
            { problemId: "problem-2", studentAnswer: null },
          ],
        },
      }),
      include: { answers: true },
    });
  });

  it("updates the existing submission instead of creating a duplicate", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: "assignment-1",
      maxScore: 100,
      assignmentProblems: [{ problemId: "problem-1" }, { problemId: "problem-2" }],
    });
    prisma.submission.findFirst.mockResolvedValue({
      id: "submission-existing",
      type: "online",
    });
    prisma.submission.update.mockResolvedValue({
      id: "submission-existing",
      answers: [{ id: "answer-1" }, { id: "answer-2" }],
    });

    const service = new SubmissionsService(prisma as never);
    jest.spyOn(service, "autoGrade").mockResolvedValue({ id: "submission-existing" } as never);

    await service.submit("student-1", {
      assignmentId: "assignment-1",
      type: "online",
      answers: [{ problemId: "problem-2", studentAnswer: "7" }],
    });

    expect(prisma.submission.create).not.toHaveBeenCalled();
    expect(prisma.submission.update).toHaveBeenCalledWith({
      where: { id: "submission-existing" },
      data: expect.objectContaining({
        status: "submitted",
        score: null,
        gradedAt: null,
        gradedBy: null,
        answers: {
          deleteMany: {},
          create: [
            { problemId: "problem-1", studentAnswer: null },
            { problemId: "problem-2", studentAnswer: "7" },
          ],
        },
      }),
      include: { answers: true },
    });
  });

  it("leaves mixed manual/objective submissions in submitted state", async () => {
    prisma.submission.findUnique.mockResolvedValue({
      id: "submission-1",
      answers: [
        { id: "answer-1", problemId: "problem-1", studentAnswer: "2" },
        { id: "answer-2", problemId: "problem-2", studentAnswer: "essay answer" },
      ],
      assignment: { maxScore: 100 },
    });
    prisma.problem.findMany.mockResolvedValue([
      { id: "problem-1", problemType: "short_answer", answerText: "2" },
      { id: "problem-2", problemType: "essay", answerText: null },
    ]);
    prisma.submissionAnswer.update.mockResolvedValue({ id: "answer-1", isCorrect: true });
    prisma.submission.update.mockResolvedValue({ id: "submission-1", status: "submitted" });

    const service = new SubmissionsService(prisma as never);

    await service.autoGrade("submission-1");

    expect(prisma.submissionAnswer.update).toHaveBeenCalledTimes(1);
    expect(prisma.submission.update).toHaveBeenCalledWith({
      where: { id: "submission-1" },
      data: {
        score: null,
        status: "submitted",
        gradedAt: null,
      },
      include: { answers: true },
    });
  });
});
