import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { ErrorType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ListWrongAnswersDto } from "./dto/list-wrong-answers.dto";

@Injectable()
export class WrongAnswersService {
  constructor(private prisma: PrismaService) {}

  async collectFromSubmission(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { answers: true },
    });
    if (!submission) throw new NotFoundException("Submission not found");

    const incorrectAnswers = submission.answers.filter(
      (a) => a.isCorrect === false,
    );
    if (incorrectAnswers.length === 0) return [];

    const results = await Promise.all(
      incorrectAnswers.map((answer) =>
        this.prisma.wrongAnswer.upsert({
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
            errorType: "careless_mistake",
          },
          update: {},
        }),
      ),
    );

    // Idempotently create a ReviewSchedule for each wrong answer.
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    await Promise.all(
      results.map((wa) =>
        this.prisma.reviewSchedule.upsert({
          where: { wrongAnswerId: wa.id },
          create: {
            studentId: wa.studentId,
            wrongAnswerId: wa.id,
            problemId: wa.problemId,
            nextReviewAt: tomorrow,
            interval: 1,
            easeFactor: 2.5,
            repetitions: 0,
          },
          update: {},
        }),
      ),
    );

    return results;
  }

  async classifyError(wrongAnswerId: string, errorType: ErrorType) {
    const record = await this.prisma.wrongAnswer.findUnique({
      where: { id: wrongAnswerId },
    });
    if (!record) throw new NotFoundException("Wrong answer not found");

    return this.prisma.wrongAnswer.update({
      where: { id: wrongAnswerId },
      data: { errorType },
    });
  }

  async getByStudent(studentId: string, filters: ListWrongAnswersDto) {
    const { errorType, resolved, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

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
        take: limit,
      }),
      this.prisma.wrongAnswer.count({ where }),
    ]);

    return { items, total, page, limit };
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
        ...(isCorrect ? { resolvedAt: new Date() } : {}),
      },
    });
  }
}
