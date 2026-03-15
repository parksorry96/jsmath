import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { ErrorType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ListWrongAnswersDto } from "../dto/list-wrong-answers.dto";
import { canAccessStudentData, isPrivilegedRole } from "../../common/access-control";

type ProblemSummary = {
  id: string;
  stemLatex: string;
  stemText: string;
  problemType: string;
  difficulty: number | null;
  subject: string | null;
  unitMajor: string | null;
  unitMinor: string | null;
  displayNumber: string | null;
  answerText: string | null;
  answerLatex: string | null;
  solutionText: string | null;
  solutionSteps: unknown;
  alternativeSolutions: unknown;
  choices: Array<{
    label: string;
    contentLatex: string;
    contentText: string;
    position: number;
  }>;
};

@Injectable()
export class WrongAnswersService {
  constructor(private prisma: PrismaService) {}

  async collectFromSubmission(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { answers: true },
    });
    if (!submission) {
      return [];
    }

    const incorrectAnswers = submission.answers.filter(
      (answer) => answer.isCorrect === false,
    );
    const incorrectProblemIds = new Set(
      incorrectAnswers.map((answer) => answer.problemId),
    );

    await this.prisma.wrongAnswer.updateMany({
      where: {
        submissionId,
        problemId: { notIn: [...incorrectProblemIds] },
        resolvedAt: null,
      },
      data: {
        resolvedAt: new Date(),
        lastRetryCorrect: true,
      },
    });

    if (incorrectAnswers.length === 0) {
      return [];
    }

    const problems = await this.prisma.problem.findMany({
      where: { id: { in: [...incorrectProblemIds] } },
      select: {
        id: true,
        problemType: true,
        difficulty: true,
        commonMistakes: true,
      },
    });
    const problemMap = new Map(problems.map((problem) => [problem.id, problem]));

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const results = await Promise.all(
      incorrectAnswers.map(async (answer) => {
        const errorType = this.inferErrorType(problemMap.get(answer.problemId));

        const wrongAnswer = await this.prisma.wrongAnswer.upsert({
          where: {
            studentId_problemId_submissionId: {
              studentId: submission.studentId,
              problemId: answer.problemId,
              submissionId,
            },
          },
          create: {
            studentId: submission.studentId,
            problemId: answer.problemId,
            submissionId,
            errorType,
          },
          update: {
            errorType,
            resolvedAt: null,
            lastRetryCorrect: null,
          },
        });

        await this.prisma.reviewSchedule.upsert({
          where: { wrongAnswerId: wrongAnswer.id },
          create: {
            studentId: wrongAnswer.studentId,
            wrongAnswerId: wrongAnswer.id,
            problemId: wrongAnswer.problemId,
            nextReviewAt: tomorrow,
            interval: 1,
            easeFactor: 2.5,
            repetitions: 0,
          },
          update: {
            nextReviewAt: tomorrow,
            interval: 1,
            easeFactor: 2.5,
            repetitions: 0,
            lastReviewedAt: null,
          },
        });

        return wrongAnswer;
      }),
    );

    return results;
  }

  private inferErrorType(problem: {
    problemType: string;
    difficulty: number | null;
    commonMistakes: unknown;
  } | undefined): ErrorType {
    if (!problem) {
      return "pattern_gap";
    }

    if (problem.difficulty !== null && problem.difficulty <= 2) {
      return "careless_mistake";
    }

    if (
      problem.problemType === "written_solution" ||
      problem.problemType === "essay"
    ) {
      return "concept_gap";
    }

    if (problem.problemType === "short_answer") {
      return "calculation_error";
    }

    return "pattern_gap";
  }

  private async buildProblemMap(problemIds: string[]) {
    if (problemIds.length === 0) {
      return new Map<string, ProblemSummary>();
    }

    const problems = await this.prisma.problem.findMany({
      where: { id: { in: problemIds } },
      select: {
        id: true,
        stemLatex: true,
        stemText: true,
        problemType: true,
        difficulty: true,
        subject: true,
        unitMajor: true,
        unitMinor: true,
        displayNumber: true,
        answerText: true,
        answerLatex: true,
        solutionText: true,
        solutionSteps: true,
        alternativeSolutions: true,
        choices: {
          select: {
            label: true,
            contentLatex: true,
            contentText: true,
            position: true,
          },
          orderBy: { position: "asc" },
        },
      },
    });

    return new Map(problems.map((problem) => [problem.id, problem]));
  }

  private async enrichWrongAnswers(
    items: Array<{
      id: string;
      studentId: string;
      problemId: string;
      submissionId: string;
      errorType: ErrorType;
      note: string | null;
      retryCount: number;
      lastRetryCorrect: boolean | null;
      resolvedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }>,
  ) {
    if (items.length === 0) {
      return [];
    }

    const problemIds = [...new Set(items.map((item) => item.problemId))];
    const submissionIds = [...new Set(items.map((item) => item.submissionId))];

    const [problemMap, answers] = await Promise.all([
      this.buildProblemMap(problemIds),
      this.prisma.submissionAnswer.findMany({
        where: {
          submissionId: { in: submissionIds },
          problemId: { in: problemIds },
        },
        select: {
          submissionId: true,
          problemId: true,
          studentAnswer: true,
        },
      }),
    ]);

    const answerMap = new Map(
      answers.map((answer) => [
        `${answer.submissionId}:${answer.problemId}`,
        answer.studentAnswer,
      ]),
    );

    return items.map((item) => {
      const problem = problemMap.get(item.problemId) ?? null;
      const studentAnswer =
        answerMap.get(`${item.submissionId}:${item.problemId}`) ?? null;

      return {
        ...item,
        resolved: item.resolvedAt !== null,
        studentAnswer,
        problemContent: problem?.stemText || problem?.stemLatex || "",
        solution:
          problem?.solutionText ||
          problem?.answerText ||
          problem?.answerLatex ||
          "",
        problem,
      };
    });
  }

  async classifyError(
    wrongAnswerId: string,
    errorType: ErrorType,
    requesterId: string,
    requesterRole: string,
  ) {
    if (!isPrivilegedRole(requesterRole)) {
      throw new ForbiddenException("Not authorized");
    }

    const record = await this.prisma.wrongAnswer.findUnique({
      where: { id: wrongAnswerId },
    });
    if (!record) throw new NotFoundException("Wrong answer not found");

    const allowed = await canAccessStudentData(
      this.prisma,
      requesterId,
      requesterRole,
      record.studentId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized");
    }

    return this.prisma.wrongAnswer.update({
      where: { id: wrongAnswerId },
      data: { errorType },
    });
  }

  async getByStudent(studentId: string, filters: ListWrongAnswersDto) {
    const { errorType, resolved, page = 1, limit = 20 } = filters;
    const normalizedLimit = Math.min(limit, 100);
    const skip = (page - 1) * normalizedLimit;

    const where = {
      studentId,
      ...(errorType ? { errorType } : {}),
      ...(resolved === true ? { resolvedAt: { not: null } } : {}),
      ...(resolved === false ? { resolvedAt: null } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.wrongAnswer.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: normalizedLimit,
      }),
      this.prisma.wrongAnswer.count({ where }),
    ]);

    const enriched = await this.enrichWrongAnswers(items);
    const totalPages = Math.max(1, Math.ceil(total / normalizedLimit));

    return {
      items: enriched,
      data: enriched,
      total,
      page,
      limit: normalizedLimit,
      totalPages,
    };
  }

  async getStats(studentId: string) {
    const all = await this.prisma.wrongAnswer.findMany({
      where: { studentId },
      select: {
        errorType: true,
        resolvedAt: true,
        createdAt: true,
      },
    });

    const byErrorType: Record<string, number> = {
      concept_gap: 0,
      pattern_gap: 0,
      calculation_error: 0,
      careless_mistake: 0,
    };
    let resolved = 0;
    let unresolved = 0;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    let recentCount = 0;

    for (const record of all) {
      byErrorType[record.errorType] = (byErrorType[record.errorType] ?? 0) + 1;
      if (record.resolvedAt) {
        resolved++;
      } else {
        unresolved++;
      }
      if (record.createdAt >= thirtyDaysAgo) {
        recentCount++;
      }
    }

    return {
      total: all.length,
      byErrorType,
      resolved,
      unresolved,
      recentCount,
      conceptGap: byErrorType.concept_gap,
      patternGap: byErrorType.pattern_gap,
      calculationError: byErrorType.calculation_error,
      carelessMistake: byErrorType.careless_mistake,
    };
  }

  async markResolved(id: string, studentId: string) {
    const record = await this.prisma.wrongAnswer.findUnique({
      where: { id },
    });
    if (!record) throw new NotFoundException("Wrong answer not found");
    if (record.studentId !== studentId) {
      throw new ForbiddenException("Not authorized");
    }

    return this.prisma.wrongAnswer.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });
  }

  async retryWrongAnswer(id: string, studentId: string, isCorrect: boolean) {
    const record = await this.prisma.wrongAnswer.findUnique({
      where: { id },
    });
    if (!record) throw new NotFoundException("Wrong answer not found");
    if (record.studentId !== studentId) {
      throw new ForbiddenException("Not authorized");
    }

    return this.prisma.wrongAnswer.update({
      where: { id },
      data: {
        retryCount: { increment: 1 },
        lastRetryCorrect: isCorrect,
        resolvedAt: isCorrect ? new Date() : null,
      },
    });
  }
}
