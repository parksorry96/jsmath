import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ProblemStatisticsService {
  private readonly logger = new Logger(ProblemStatisticsService.name);

  constructor(private prisma: PrismaService) {}

  async recomputeForProblem(problemId: string) {
    // Fetch all submission answers for this problem where isCorrect is known
    const answers = await this.prisma.submissionAnswer.findMany({
      where: { problemId, isCorrect: { not: null } },
      select: {
        isCorrect: true,
        studentAnswer: true,
        submission: { select: { studentId: true } },
      },
    });

    const attemptCount = answers.length;
    if (attemptCount === 0) return;

    const correctCount = answers.filter((a) => a.isCorrect).length;
    const pValue = correctCount / attemptCount;
    const isSufficientN = attemptCount >= 30;

    // Discrimination index: top 27% vs bottom 27% by total score
    let discriminationIndex: number | null = null;
    if (isSufficientN) {
      discriminationIndex = await this.computeDiscriminationIndex(
        problemId,
        answers,
      );
    }

    await this.prisma.problemStatistics.upsert({
      where: { problemId },
      create: {
        problemId,
        attemptCount,
        correctCount,
        pValue,
        discriminationIndex,
        isSufficientN,
        lastComputedAt: new Date(),
      },
      update: {
        attemptCount,
        correctCount,
        pValue,
        discriminationIndex,
        isSufficientN,
        lastComputedAt: new Date(),
      },
    });

    // Compute choice statistics for multiple_choice problems
    await this.computeChoiceStatistics(problemId);
  }

  private async computeDiscriminationIndex(
    problemId: string,
    answers: { isCorrect: boolean | null; submission: { studentId: string } }[],
  ): Promise<number | null> {
    // Get unique student IDs who answered this problem
    const studentIds = [...new Set(answers.map((a) => a.submission.studentId))];
    if (studentIds.length < 4) return null;

    // Calculate each student's total correct rate across all submissions
    const scores = await this.prisma.$queryRaw<
      { student_id: string; correct_rate: number }[]
    >`
      SELECT s.student_id,
             AVG(CASE WHEN sa.is_correct THEN 1.0 ELSE 0.0 END) AS correct_rate
      FROM submission_answers sa
      JOIN submissions s ON s.id = sa.submission_id
      WHERE s.student_id = ANY(${studentIds})
        AND sa.is_correct IS NOT NULL
      GROUP BY s.student_id
      ORDER BY correct_rate DESC
    `;

    if (scores.length < 4) return null;

    const n27 = Math.max(1, Math.floor(scores.length * 0.27));
    const topGroup = scores.slice(0, n27).map((s) => s.student_id);
    const bottomGroup = scores.slice(-n27).map((s) => s.student_id);

    // Correct rate for this problem in each group
    const topCorrect = answers.filter(
      (a) => topGroup.includes(a.submission.studentId) && a.isCorrect,
    ).length;
    const topTotal = answers.filter((a) =>
      topGroup.includes(a.submission.studentId),
    ).length;
    const bottomCorrect = answers.filter(
      (a) => bottomGroup.includes(a.submission.studentId) && a.isCorrect,
    ).length;
    const bottomTotal = answers.filter((a) =>
      bottomGroup.includes(a.submission.studentId),
    ).length;

    if (topTotal === 0 || bottomTotal === 0) return null;

    return topCorrect / topTotal - bottomCorrect / bottomTotal;
  }

  private async computeChoiceStatistics(problemId: string) {
    // Only compute for multiple_choice problems
    const problem = await this.prisma.problem.findUnique({
      where: { id: problemId },
      select: { problemType: true },
    });
    if (!problem || problem.problemType !== "multiple_choice") return;

    const answers = await this.prisma.submissionAnswer.findMany({
      where: { problemId, studentAnswer: { not: null } },
      select: { studentAnswer: true },
    });

    if (answers.length === 0) return;

    // Count selections per choice position (1-indexed)
    const counts = new Map<number, number>();
    for (const a of answers) {
      const pos = parseInt(a.studentAnswer!, 10);
      if (!isNaN(pos)) {
        counts.set(pos, (counts.get(pos) || 0) + 1);
      }
    }

    const now = new Date();
    const totalAnswers = answers.length;

    for (const [position, selectCount] of counts) {
      await this.prisma.choiceStatistics.upsert({
        where: {
          problemId_choicePosition: { problemId, choicePosition: position },
        },
        create: {
          problemId,
          choicePosition: position,
          selectCount,
          selectRate: selectCount / totalAnswers,
          lastComputedAt: now,
        },
        update: {
          selectCount,
          selectRate: selectCount / totalAnswers,
          lastComputedAt: now,
        },
      });
    }
  }

  async recomputeBatch() {
    // Find problems with submissions newer than their last computed stats
    const staleProblems = await this.prisma.$queryRaw<{ problem_id: string }[]>`
      SELECT DISTINCT sa.problem_id
      FROM submission_answers sa
      WHERE sa.is_correct IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM ocr.problem_statistics ps
          WHERE ps.problem_id = sa.problem_id
            AND ps.last_computed_at >= sa.created_at
        )
    `;

    this.logger.log(`Recomputing statistics for ${staleProblems.length} problems`);

    let computed = 0;
    for (const { problem_id } of staleProblems) {
      await this.recomputeForProblem(problem_id);
      computed++;
    }

    return { computed };
  }

  async getStatistics(problemId: string) {
    const [stats, choiceStats] = await Promise.all([
      this.prisma.problemStatistics.findUnique({
        where: { problemId },
      }),
      this.prisma.choiceStatistics.findMany({
        where: { problemId },
        orderBy: { choicePosition: "asc" },
      }),
    ]);

    return { statistics: stats, choiceStatistics: choiceStats };
  }
}
