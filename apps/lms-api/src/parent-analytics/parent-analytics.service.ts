import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { runWithConcurrency } from "../common/concurrency";
import { PrismaService } from "../prisma/prisma.service";

const PARENT_REPORT_CONCURRENCY = 4;

interface WeaknessHeatmapEntry {
  unit: string;
  accuracy: number;
  correct: number;
  total: number;
  level: "red" | "yellow" | "green";
}

interface ScoreTrendEntry {
  date: string;
  score: number | null;
  maxScore: number;
  label: string;
}

export interface WeeklyReportData {
  id: string;
  parentId: string;
  studentId: string;
  weekStart: string;
  weekEnd: string;
  assignmentCompletionRate: number;
  avgScore: number | null;
  problemsSolved: number;
  correctRate: number | null;
  lessonsAttended: number;
  lessonsTotal: number;
  weaknessHeatmap: WeaknessHeatmapEntry[];
  scoreTrend: ScoreTrendEntry[];
}

export function parseLocalDateString(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new BadRequestException("weekStart must be in YYYY-MM-DD format");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new BadRequestException("weekStart is not a valid calendar date");
  }

  date.setHours(0, 0, 0, 0);
  return date;
}

function getWeekBounds(weekStart?: string): { start: Date; end: Date } {
  let start: Date;
  if (weekStart) {
    start = parseLocalDateString(weekStart);
  } else {
    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1; // Monday = 0
    start = new Date(now);
    start.setDate(now.getDate() - diff);
  }
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function accuracyLevel(accuracy: number): "red" | "yellow" | "green" {
  if (accuracy < 50) return "red";
  if (accuracy < 75) return "yellow";
  return "green";
}

@Injectable()
export class ParentAnalyticsService {
  private readonly logger = new Logger(ParentAnalyticsService.name);

  constructor(private prisma: PrismaService) {}

  async getWeeklyReport(
    parentId: string,
    studentId: string,
    weekStart?: string,
  ): Promise<WeeklyReportData> {
    const { start, end } = getWeekBounds(weekStart);

    // Try to find cached report
    const existing = await this.prisma.parentWeeklyReport.findUnique({
      where: {
        parentId_studentId_weekStart: {
          parentId,
          studentId,
          weekStart: start,
        },
      },
    });

    if (existing) {
      return this.formatReport(existing);
    }

    // Generate on demand
    return this.generateReport(parentId, studentId, start, end);
  }

  async generateReport(
    parentId: string,
    studentId: string,
    weekStart: Date,
    weekEnd: Date,
  ): Promise<WeeklyReportData> {
    // 1. Get student's class enrollments
    const enrollments = await this.prisma.enrollment.findMany({
      where: { userId: studentId, role: "student" },
      select: { classId: true },
    });
    const classIds = enrollments.map((e) => e.classId);

    // 2. Assignments due this week for the student's classes
    const assignments = await this.prisma.assignment.findMany({
      where: {
        classId: { in: classIds },
        OR: [
          { targetStudentId: null },
          { targetStudentId: studentId },
        ],
        createdAt: { lte: weekEnd },
        dueAt: { gte: weekStart, lte: weekEnd },
      },
      select: { id: true, maxScore: true, title: true },
    });
    const assignmentIds = assignments.map((a) => a.id);

    // 3. Submissions for those assignments
    const submissions = await this.prisma.submission.findMany({
      where: {
        studentId,
        assignmentId: { in: assignmentIds },
      },
      include: {
        answers: {
          select: { problemId: true, isCorrect: true },
        },
        assignment: {
          select: { title: true, maxScore: true },
        },
      },
    });

    // Assignment completion rate
    const assignmentCompletionRate =
      assignmentIds.length > 0
        ? Math.round((submissions.length / assignmentIds.length) * 100)
        : 0;

    // Average score
    const gradedSubmissions = submissions.filter(
      (s) => s.score !== null && (s.status === "graded" || s.status === "returned"),
    );
    const avgScore =
      gradedSubmissions.length > 0
        ? Math.round(
            (gradedSubmissions.reduce((sum, s) => sum + (s.score ?? 0), 0) /
              gradedSubmissions.length) *
              10,
          ) / 10
        : null;

    // Problems solved and correct rate
    const allAnswers = submissions.flatMap((s) => s.answers);
    const answeredCount = allAnswers.filter((a) => a.isCorrect !== null).length;
    const correctCount = allAnswers.filter((a) => a.isCorrect === true).length;
    const correctRate =
      answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : null;

    // 4. Weakness heatmap from problem unit data
    const problemIds = [...new Set(allAnswers.map((a) => a.problemId))];
    const problems =
      problemIds.length > 0
        ? await this.prisma.problem.findMany({
            where: { id: { in: problemIds } },
            select: { id: true, unitMajor: true },
          })
        : [];
    const problemMap = new Map(problems.map((p) => [p.id, p]));

    const unitStats: Record<string, { correct: number; total: number }> = {};
    for (const ans of allAnswers) {
      if (ans.isCorrect === null) continue;
      const problem = problemMap.get(ans.problemId);
      const unit = problem?.unitMajor || "미분류";
      if (!unitStats[unit]) unitStats[unit] = { correct: 0, total: 0 };
      unitStats[unit].total++;
      if (ans.isCorrect) unitStats[unit].correct++;
    }

    const weaknessHeatmap: WeaknessHeatmapEntry[] = Object.entries(unitStats)
      .map(([unit, { correct, total }]) => {
        const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
        return { unit, accuracy, correct, total, level: accuracyLevel(accuracy) };
      })
      .sort((a, b) => a.accuracy - b.accuracy);

    // 5. Score trend (last 4 weeks of graded submissions)
    const fourWeeksAgo = new Date(weekStart);
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

    const recentSubmissions = await this.prisma.submission.findMany({
      where: {
        studentId,
        assignment: { classId: { in: classIds } },
        status: { in: ["graded", "returned"] },
        submittedAt: { gte: fourWeeksAgo, lte: weekEnd },
      },
      select: {
        score: true,
        maxScore: true,
        submittedAt: true,
        assignment: { select: { title: true, maxScore: true } },
      },
      orderBy: { submittedAt: "asc" },
    });

    const scoreTrend: ScoreTrendEntry[] = recentSubmissions.map((s) => ({
      date: s.submittedAt.toISOString(),
      score: s.score,
      maxScore: s.maxScore ?? s.assignment.maxScore,
      label: s.assignment.title,
    }));

    // 6. Lessons attended this week
    const lessons = await this.prisma.lesson.findMany({
      where: {
        classId: { in: classIds },
        startAt: { gte: weekStart, lte: weekEnd },
      },
      select: { id: true },
    });

    const attendances =
      lessons.length > 0
        ? await this.prisma.attendance.findMany({
            where: {
              studentId,
              classId: { in: classIds },
              date: { gte: weekStart, lte: weekEnd },
              status: { in: ["present", "late"] },
            },
            select: { id: true },
          })
        : [];

    const lessonsTotal = lessons.length;
    const lessonsAttended = attendances.length;

    // 7. Upsert report
    const report = await this.prisma.parentWeeklyReport.upsert({
      where: {
        parentId_studentId_weekStart: {
          parentId,
          studentId,
          weekStart,
        },
      },
      create: {
        parentId,
        studentId,
        weekStart,
        weekEnd,
        assignmentCompletionRate,
        avgScore,
        problemsSolved: answeredCount,
        correctRate,
        lessonsAttended,
        lessonsTotal,
        weaknessHeatmap: JSON.parse(JSON.stringify(weaknessHeatmap)),
        scoreTrend: JSON.parse(JSON.stringify(scoreTrend)),
      },
      update: {
        assignmentCompletionRate,
        avgScore,
        problemsSolved: answeredCount,
        correctRate,
        lessonsAttended,
        lessonsTotal,
        weaknessHeatmap: JSON.parse(JSON.stringify(weaknessHeatmap)),
        scoreTrend: JSON.parse(JSON.stringify(scoreTrend)),
      },
    });

    return this.formatReport(report);
  }

  async generateAllReports(): Promise<number> {
    const links = await this.prisma.parentStudent.findMany({
      select: { parentId: true, studentId: true },
    });

    const { start, end } = getWeekBounds();
    let count = 0;

    await runWithConcurrency(links, PARENT_REPORT_CONCURRENCY, async (link) => {
      try {
        await this.generateReport(link.parentId, link.studentId, start, end);
        count++;
      } catch (err) {
        this.logger.error(
          `Failed to generate report for parent=${link.parentId} student=${link.studentId}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    });

    return count;
  }

  private formatReport(raw: {
    id: string;
    parentId: string;
    studentId: string;
    weekStart: Date;
    weekEnd: Date;
    assignmentCompletionRate: number;
    avgScore: number | null;
    problemsSolved: number;
    correctRate: number | null;
    lessonsAttended: number;
    lessonsTotal: number;
    weaknessHeatmap: unknown;
    scoreTrend: unknown;
  }): WeeklyReportData {
    return {
      id: raw.id,
      parentId: raw.parentId,
      studentId: raw.studentId,
      weekStart: raw.weekStart.toISOString(),
      weekEnd: raw.weekEnd.toISOString(),
      assignmentCompletionRate: raw.assignmentCompletionRate,
      avgScore: raw.avgScore,
      problemsSolved: raw.problemsSolved,
      correctRate: raw.correctRate,
      lessonsAttended: raw.lessonsAttended,
      lessonsTotal: raw.lessonsTotal,
      weaknessHeatmap: (raw.weaknessHeatmap ?? []) as WeaknessHeatmapEntry[],
      scoreTrend: (raw.scoreTrend ?? []) as ScoreTrendEntry[],
    };
  }
}
