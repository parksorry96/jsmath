import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ReviewStatus } from "@prisma/client";

const THRESHOLDS = {
  minAttempts: 30,
  pValueMin: 0.10,
  pValueMax: 0.95,
  discriminationMin: 0.20,
} as const;

@Injectable()
export class ProblemQualityService {
  private readonly logger = new Logger(ProblemQualityService.name);

  constructor(private prisma: PrismaService) {}

  async evaluateAndFlag(problemId: string) {
    const stats = await this.prisma.problemStatistics.findUnique({
      where: { problemId },
    });
    if (!stats || !stats.isSufficientN) return null;

    const flags: string[] = [];

    if (stats.pValue !== null && stats.pValue < THRESHOLDS.pValueMin) {
      flags.push("p_value_too_low");
    }
    if (stats.pValue !== null && stats.pValue > THRESHOLDS.pValueMax) {
      flags.push("p_value_too_high");
    }
    if (
      stats.discriminationIndex !== null &&
      stats.discriminationIndex < THRESHOLDS.discriminationMin
    ) {
      flags.push("low_discrimination");
    }

    if (flags.length === 0) {
      await this.prisma.problem.update({
        where: { id: problemId },
        data: { reviewStatus: ReviewStatus.calibrated },
      });
      return { problemId, status: "calibrated", flags: [] };
    }

    await this.prisma.problem.update({
      where: { id: problemId },
      data: {
        reviewStatus: ReviewStatus.flagged,
        flagReason: flags.join(","),
      },
    });
    return { problemId, status: "flagged", flags };
  }

  async evaluateBatch() {
    const eligible = await this.prisma.$queryRaw<{ problem_id: string }[]>`
      SELECT ps.problem_id
      FROM ocr.problem_statistics ps
      JOIN ocr.problems p ON p.id = ps.problem_id
      WHERE ps.is_sufficient_n = true
        AND p.review_status IN ('approved', 'auto_approved', 'calibrated')
    `;

    this.logger.log(`Evaluating quality gates for ${eligible.length} problems`);

    let calibrated = 0;
    let flagged = 0;

    for (const { problem_id } of eligible) {
      const result = await this.evaluateAndFlag(problem_id);
      if (result?.status === "calibrated") calibrated++;
      if (result?.status === "flagged") flagged++;
    }

    return { evaluated: eligible.length, calibrated, flagged };
  }

  async retireProblem(problemId: string, userId: string) {
    const problem = await this.prisma.problem.findUnique({
      where: { id: problemId },
      select: { id: true },
    });
    if (!problem) throw new NotFoundException("Problem not found");

    await this.prisma.problem.update({
      where: { id: problemId },
      data: {
        reviewStatus: ReviewStatus.retired,
        retiredAt: new Date(),
        retiredBy: userId,
      },
    });

    return { problemId, status: "retired" };
  }

  async findFlagged(page = 1, limit = 20) {
    limit = Math.min(Math.max(1, limit), 100);
    page = Math.max(1, page);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.problem.findMany({
        where: { reviewStatus: ReviewStatus.flagged },
        skip,
        take: limit,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          stemText: true,
          displayNumber: true,
          problemType: true,
          subject: true,
          gradeLevel: true,
          difficulty: true,
          flagReason: true,
          reviewStatus: true,
          updatedAt: true,
        },
      }),
      this.prisma.problem.count({
        where: { reviewStatus: ReviewStatus.flagged },
      }),
    ]);

    // Attach statistics via separate query
    const problemIds = items.map((i) => i.id);
    const statsRows = problemIds.length > 0
      ? await this.prisma.problemStatistics.findMany({
          where: { problemId: { in: problemIds } },
          select: {
            problemId: true,
            attemptCount: true,
            correctCount: true,
            pValue: true,
            discriminationIndex: true,
            isSufficientN: true,
            lastComputedAt: true,
          },
        })
      : [];

    const statsMap = new Map(statsRows.map((s) => [s.problemId, s]));

    const data = items.map((item) => ({
      ...item,
      statistics: statsMap.get(item.id) ?? null,
    }));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
