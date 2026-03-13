import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { applySmTwo } from "./sm2";

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async createReviewSchedule(wrongAnswer: {
    id: string;
    studentId: string;
    problemId: string;
  }) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.prisma.reviewSchedule.create({
      data: {
        studentId: wrongAnswer.studentId,
        wrongAnswerId: wrongAnswer.id,
        problemId: wrongAnswer.problemId,
        nextReviewAt: tomorrow,
        interval: 1,
        easeFactor: 2.5,
        repetitions: 0,
      },
    });
  }

  async getDailyReview(studentId: string) {
    const now = new Date();
    return this.prisma.reviewSchedule.findMany({
      where: {
        studentId,
        nextReviewAt: { lte: now },
      },
      include: {
        wrongAnswer: {
          select: {
            id: true,
            errorType: true,
            note: true,
            retryCount: true,
            resolvedAt: true,
          },
        },
      },
      orderBy: { nextReviewAt: "asc" },
    });
  }

  async gradeReview(
    reviewId: string,
    studentId: string,
    quality: number,
  ) {
    if (quality < 0 || quality > 5) {
      throw new BadRequestException("quality must be between 0 and 5");
    }

    const record = await this.prisma.reviewSchedule.findUnique({
      where: { id: reviewId },
    });
    if (!record) throw new NotFoundException("Review schedule not found");
    if (record.studentId !== studentId) {
      throw new ForbiddenException("Not authorized");
    }

    const result = applySmTwo(
      {
        interval: record.interval,
        easeFactor: record.easeFactor,
        repetitions: record.repetitions,
      },
      quality,
    );

    return this.prisma.reviewSchedule.update({
      where: { id: reviewId },
      data: {
        interval: result.interval,
        easeFactor: result.easeFactor,
        repetitions: result.repetitions,
        nextReviewAt: result.nextReviewAt,
        lastReviewedAt: result.lastReviewedAt,
      },
    });
  }

  async getStats(studentId: string) {
    const now = new Date();

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const endOfWeek = new Date(now);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const [dueToday, completedToday, upcomingThisWeek] = await Promise.all([
      this.prisma.reviewSchedule.count({
        where: {
          studentId,
          nextReviewAt: { lte: now },
        },
      }),
      this.prisma.reviewSchedule.count({
        where: {
          studentId,
          lastReviewedAt: { gte: startOfToday, lte: endOfToday },
        },
      }),
      this.prisma.reviewSchedule.count({
        where: {
          studentId,
          nextReviewAt: { gt: now, lte: endOfWeek },
        },
      }),
    ]);

    return { dueToday, completedToday, upcomingThisWeek };
  }
}
