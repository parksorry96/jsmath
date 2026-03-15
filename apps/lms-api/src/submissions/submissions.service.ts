import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma, SubmissionStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSubmissionDto } from "./dto/create-submission.dto";
import { GradeSubmissionDto } from "./dto/grade-submission.dto";
import { ClassMonitorGateway } from "../class-monitor/class-monitor.gateway";
import { ClassMonitorService } from "../class-monitor/class-monitor.service";
import {
  canAccessAssignment,
  canAccessStudentData,
  canAccessSubmission,
  getAccessibleClassIds,
  getLinkedStudentIds,
  isPrivilegedRole,
} from "../common/access-control";
import { WrongAnswersService } from "../wrong-answers/wrong-answers.service";
import { MasteryService } from "../mastery/mastery.service";
import { GamificationService } from "../gamification/gamification.service";
import { SmartScoreService } from "./smart-score.service";

@Injectable()
export class SubmissionsService {
  constructor(
    private prisma: PrismaService,
    private wrongAnswers: WrongAnswersService,
    private masteryService: MasteryService,
    private gamification: GamificationService,
    private smartScore: SmartScoreService,
    private classMonitorGateway: ClassMonitorGateway,
    private classMonitorService: ClassMonitorService,
  ) {}

  private async emitClassMonitorUpdate(assignmentId: string) {
    try {
      const assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { classId: true },
      });
      if (!assignment) return;
      const status = await this.classMonitorService.getStatus(
        assignment.classId,
        assignmentId,
      );
      this.classMonitorGateway.emitSubmission(assignmentId, status);
    } catch {
      // Non-critical: don't break submission flow
    }
  }

  private normalizeStatus(status?: string): SubmissionStatus | undefined {
    if (
      status === "submitted" ||
      status === "grading" ||
      status === "graded" ||
      status === "returned"
    ) {
      return status;
    }

    return undefined;
  }

  private serializeSubmission(submission: any) {
    return {
      ...submission,
      answers: submission.answers?.map((answer: { studentAnswer?: string | null } & Record<string, unknown>) => ({
        ...answer,
        answer: answer.studentAnswer,
      })),
    };
  }

  private isSubmissionUniquenessError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    );
  }

  async submit(studentId: string, dto: CreateSubmissionDto) {
    const allowed = await canAccessAssignment(
      this.prisma,
      studentId,
      "student",
      dto.assignmentId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to submit this assignment");
    }

    const assignment = await this.prisma.assignment.findUnique({
      where: { id: dto.assignmentId },
      include: {
        assignmentProblems: {
          orderBy: { orderIndex: "asc" },
          select: { problemId: true },
        },
      },
    });
    if (!assignment) throw new NotFoundException("Assignment not found");

    if (dto.type === "online" && assignment.assignmentProblems.length === 0) {
      throw new BadRequestException("Online submissions require assignment problems");
    }

    const providedAnswers = new Map<string, string>();
    if (dto.type === "online") {
      for (const answer of dto.answers ?? []) {
        if (providedAnswers.has(answer.problemId)) {
          throw new BadRequestException("Duplicate answers are not allowed");
        }
        providedAnswers.set(answer.problemId, answer.studentAnswer);
      }

      const assignmentProblemIds = new Set(
        assignment.assignmentProblems.map((problem) => problem.problemId),
      );
      const invalidProblemId = [...providedAnswers.keys()].find(
        (problemId) => !assignmentProblemIds.has(problemId),
      );
      if (invalidProblemId) {
        throw new BadRequestException("Submission contains answers for another assignment");
      }
    }

    const existingSubmission = await this.prisma.submission.findFirst({
      where: {
        assignmentId: dto.assignmentId,
        studentId,
      },
      orderBy: { submittedAt: "desc" },
      select: {
        id: true,
        type: true,
      },
    });

    if (existingSubmission && existingSubmission.type !== dto.type) {
      throw new BadRequestException("Submission type does not match the existing submission");
    }

    const answerOperations =
      dto.type === "online" && assignment.assignmentProblems.length > 0
        ? {
            create: assignment.assignmentProblems.map((problem) => ({
              problemId: problem.problemId,
              studentAnswer: providedAnswers.get(problem.problemId) ?? null,
            })),
          }
        : undefined;

    const submissionUpdateData = {
      type: dto.type,
      maxScore: assignment.maxScore,
      status: "submitted" as const,
      score: null,
      feedback: null,
      gradedAt: null,
      gradedBy: null,
      submittedAt: new Date(),
      answers:
        dto.type === "online"
          ? {
              deleteMany: {},
              ...answerOperations,
            }
          : undefined,
    };

    const submissionCreateData = {
      assignmentId: dto.assignmentId,
      studentId,
      type: dto.type,
      maxScore: assignment.maxScore,
      answers: answerOperations,
    };

    let submission;
    if (existingSubmission) {
      submission = await this.prisma.submission.update({
        where: { id: existingSubmission.id },
        data: submissionUpdateData,
        include: { answers: true },
      });
    } else {
      try {
        submission = await this.prisma.submission.create({
          data: submissionCreateData,
          include: { answers: true },
        });
      } catch (error) {
        if (!this.isSubmissionUniquenessError(error)) {
          throw error;
        }

        const concurrentSubmission = await this.prisma.submission.findFirst({
          where: {
            assignmentId: dto.assignmentId,
            studentId,
          },
          orderBy: { submittedAt: "desc" },
          select: {
            id: true,
            type: true,
          },
        });

        if (!concurrentSubmission) {
          throw error;
        }
        if (concurrentSubmission.type !== dto.type) {
          throw new BadRequestException(
            "Submission type does not match the existing submission",
          );
        }

        submission = await this.prisma.submission.update({
          where: { id: concurrentSubmission.id },
          data: submissionUpdateData,
          include: { answers: true },
        });
      }
    }

    if (dto.type === "online" && submission.answers.length > 0) {
      const graded = await this.autoGrade(submission.id);
      this.emitClassMonitorUpdate(dto.assignmentId).catch(() => {});
      return graded;
    }

    this.emitClassMonitorUpdate(dto.assignmentId).catch(() => {});
    return submission;
  }

  async autoGrade(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        answers: true,
        assignment: {
          select: { maxScore: true },
        },
      },
    });
    if (!submission) throw new NotFoundException("Submission not found");

    const problemIds = submission.answers.map((answer) => answer.problemId);
    const problems = problemIds.length
      ? await this.prisma.problem.findMany({
          where: { id: { in: problemIds } },
          select: {
            id: true,
            problemType: true,
            answerText: true,
          },
        })
      : [];
    const problemMap = new Map(problems.map((problem) => [problem.id, problem]));

    let correctCount = 0;
    let autoGradableCount = 0;
    let manualReviewRequired = false;
    const answerUpdates: Array<Promise<unknown>> = [];

    for (const answer of submission.answers) {
      const problem = problemMap.get(answer.problemId);
      if (!problem) {
        manualReviewRequired = true;
        continue;
      }

      const isAutoGradable =
        (problem.problemType === "multiple_choice" ||
          problem.problemType === "short_answer") &&
        Boolean(problem.answerText);
      if (!isAutoGradable) {
        manualReviewRequired = true;
        continue;
      }

      autoGradableCount++;

      let isCorrect = false;
      const expectedAnswer = problem.answerText ?? "";

      if (problem.problemType === "multiple_choice") {
        isCorrect = answer.studentAnswer === expectedAnswer;
      } else if (problem.problemType === "short_answer") {
        const normalize = (s: string) =>
          s.trim().toLowerCase().replace(/\s+/g, "");
        isCorrect =
          normalize(answer.studentAnswer ?? "") ===
          normalize(expectedAnswer);
      }
      // written_solution / essay: skip auto-grading

      if (isCorrect) correctCount++;

      answerUpdates.push(this.prisma.submissionAnswer.update({
        where: { id: answer.id },
        data: { isCorrect },
      }));
    }

    if (answerUpdates.length > 0) {
      await Promise.all(answerUpdates);
    }

    if (manualReviewRequired) {
      return this.prisma.submission.update({
        where: { id: submissionId },
        data: {
          score: null,
          status: "submitted",
          gradedAt: null,
        },
        include: { answers: true },
      });
    }

    const score =
      autoGradableCount > 0
        ? (correctCount / autoGradableCount) * (submission.assignment.maxScore ?? 100)
        : 0;

    const smartScoreBreakdown = await this.smartScore
      .calculate(submissionId)
      .catch(() => null);

    const updateData: Prisma.SubmissionUpdateInput = {
      score,
      status: "graded",
      gradedAt: new Date(),
      ...(smartScoreBreakdown
        ? {
            smartScore: smartScoreBreakdown.finalScore,
            smartScoreMeta: smartScoreBreakdown as unknown as Prisma.InputJsonObject,
          }
        : {}),
    };

    const graded = await this.prisma.submission.update({
      where: { id: submissionId },
      data: updateData,
      include: { answers: true },
    });

    await this.wrongAnswers.collectFromSubmission(submissionId).catch(() => {});

    for (const answer of graded.answers) {
      if (answer.isCorrect !== null && answer.isCorrect !== undefined) {
        await this.masteryService.updateOnAnswer(
          graded.studentId,
          answer.problemId,
          answer.isCorrect,
        ).catch(() => {});
      }
    }

    // Gamification: fire-and-forget
    this.gamification.awardXp(graded.studentId, 10, "auto_grade").catch(() => {});
    this.gamification.updateStreak(graded.studentId, "daily_solve").catch(() => {});
    this.gamification.checkAndAwardAchievements(graded.studentId).catch(() => {});

    return graded;
  }

  async findByAssignment(
    assignmentId: string,
    requesterId: string,
    requesterRole: string,
    status?: string,
  ) {
    const allowed = await canAccessAssignment(
      this.prisma,
      requesterId,
      requesterRole,
      assignmentId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this assignment");
    }

    const normalizedStatus = this.normalizeStatus(status);

    const items = await this.prisma.submission.findMany({
      where: {
        assignmentId,
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
        ...(!isPrivilegedRole(requesterRole) && requesterRole === "student"
          ? { studentId: requesterId }
          : {}),
        ...(!isPrivilegedRole(requesterRole) && requesterRole === "parent"
          ? {
              studentId: {
                in: await getLinkedStudentIds(this.prisma, requesterId),
              },
            }
          : {}),
      },
      include: {
        student: { select: { id: true, name: true, email: true } },
        assignment: { select: { id: true, title: true, classId: true } },
        answers: true,
        photos: true,
      },
      orderBy: { submittedAt: "desc" },
    });

    return items.map((item) => this.serializeSubmission(item));
  }

  async findByStudent(
    studentId: string,
    requesterId: string,
    requesterRole: string,
    classId?: string,
    status?: string,
    limit?: number,
  ) {
    const allowed = await canAccessStudentData(
      this.prisma,
      requesterId,
      requesterRole,
      studentId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this student");
    }

    const normalizedStatus = this.normalizeStatus(status);

    const items = await this.prisma.submission.findMany({
      where: {
        studentId,
        ...(classId ? { assignment: { classId } } : {}),
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
      },
      include: {
        assignment: {
          select: { id: true, title: true, classId: true, dueAt: true },
        },
        answers: true,
        photos: true,
      },
      orderBy: { submittedAt: "desc" },
      ...(limit ? { take: limit } : {}),
    });

    return items.map((item) => this.serializeSubmission(item));
  }

  async findVisibleToRequester(
    requesterId: string,
    requesterRole: string,
    classId?: string,
    status?: string,
    limit?: number,
  ) {
    if (requesterRole === "student") {
      return this.findByStudent(
        requesterId,
        requesterId,
        requesterRole,
        classId,
        status,
        limit,
      );
    }

    if (requesterRole === "parent") {
      const linkedStudents = await getLinkedStudentIds(this.prisma, requesterId);
      if (linkedStudents.length === 0) {
        return [];
      }

      const normalizedStatus = this.normalizeStatus(status);
      const items = await this.prisma.submission.findMany({
        where: {
          studentId: { in: linkedStudents },
          ...(classId ? { assignment: { classId } } : {}),
          ...(normalizedStatus ? { status: normalizedStatus } : {}),
        },
        include: {
          student: { select: { id: true, name: true, email: true } },
          assignment: {
            select: { id: true, title: true, classId: true, dueAt: true },
          },
          answers: true,
          photos: true,
        },
        orderBy: { submittedAt: "desc" },
        ...(limit ? { take: limit } : {}),
      });

      return items.map((item) => this.serializeSubmission(item));
    }

    const normalizedStatus = this.normalizeStatus(status);
    const accessibleClassIds = await getAccessibleClassIds(
      this.prisma,
      requesterId,
      requesterRole,
    );
    const assignmentWhere =
      accessibleClassIds === null
        ? (classId ? { classId } : undefined)
        : {
            classId: classId
              ? { equals: classId, in: accessibleClassIds }
              : { in: accessibleClassIds },
          };
    const items = await this.prisma.submission.findMany({
      where: {
        ...(assignmentWhere ? { assignment: assignmentWhere } : {}),
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
      },
      include: {
        student: { select: { id: true, name: true, email: true } },
        assignment: {
          select: { id: true, title: true, classId: true, dueAt: true },
        },
        answers: true,
        photos: true,
      },
      orderBy: { submittedAt: "desc" },
      ...(limit ? { take: limit } : {}),
    });

    return items.map((item) => this.serializeSubmission(item));
  }

  async getDetail(id: string, requesterId: string, requesterRole: string) {
    const allowed = await canAccessSubmission(
      this.prisma,
      requesterId,
      requesterRole,
      id,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this submission");
    }

    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: { answers: true, photos: true, assignment: true },
    });
    if (!submission) throw new NotFoundException("Submission not found");
    return this.serializeSubmission(submission);
  }

  async grade(
    id: string,
    dto: GradeSubmissionDto,
    graderId: string,
    requesterRole: string,
  ) {
    if (!isPrivilegedRole(requesterRole)) {
      throw new ForbiddenException("Not authorized to grade this submission");
    }
    const allowed = await canAccessSubmission(
      this.prisma,
      graderId,
      requesterRole,
      id,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to grade this submission");
    }

    const submission = await this.prisma.submission.findUnique({
      where: { id },
    });
    if (!submission) throw new NotFoundException("Submission not found");

    if (dto.answers?.length) {
      for (const ans of dto.answers) {
        await this.prisma.submissionAnswer.update({
          where: {
            submissionId_problemId: {
              submissionId: id,
              problemId: ans.problemId,
            },
          },
          data: {
            score: ans.score,
            feedback: ans.feedback,
            isCorrect: ans.isCorrect,
          },
        });
      }
    }

    const graded = await this.prisma.submission.update({
      where: { id },
      data: {
        score: dto.score,
        feedback: dto.feedback,
        status: "graded",
        gradedAt: new Date(),
        gradedBy: graderId,
      },
      include: { answers: true },
    });

    await this.wrongAnswers.collectFromSubmission(id).catch(() => {});

    for (const answer of graded.answers) {
      if (answer.isCorrect !== null && answer.isCorrect !== undefined) {
        await this.masteryService.updateOnAnswer(
          graded.studentId,
          answer.problemId,
          answer.isCorrect,
        ).catch(() => {});
      }
    }

    this.emitClassMonitorUpdate(submission.assignmentId).catch(() => {});

    return graded;
  }

  async returnSubmission(id: string, requesterId: string, requesterRole: string) {
    if (!isPrivilegedRole(requesterRole)) {
      throw new ForbiddenException("Not authorized to return this submission");
    }
    const allowed = await canAccessSubmission(
      this.prisma,
      requesterId,
      requesterRole,
      id,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to return this submission");
    }

    const submission = await this.prisma.submission.findUnique({
      where: { id },
    });
    if (!submission) throw new NotFoundException("Submission not found");

    return this.prisma.submission.update({
      where: { id },
      data: { status: "returned" },
    });
  }
}
