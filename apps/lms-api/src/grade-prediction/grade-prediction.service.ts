import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

interface CutoffInput {
  examYear: number;
  examMonth: number;
  subject: string;
  grade: number;
  minScore: number;
  maxScore: number;
  percentile?: number;
}

interface SubjectPrediction {
  subject: string;
  predictedScore: number;
  predictedGrade: number;
  percentile: number | null;
  confidence: number;
  totalAnswered: number;
  totalCorrect: number;
}

// Default 2024 CSAT Math cutoffs
const DEFAULT_CUTOFFS: CutoffInput[] = [
  { examYear: 2024, examMonth: 11, subject: "수학", grade: 1, minScore: 92, maxScore: 100, percentile: 96 },
  { examYear: 2024, examMonth: 11, subject: "수학", grade: 2, minScore: 85, maxScore: 91, percentile: 89 },
  { examYear: 2024, examMonth: 11, subject: "수학", grade: 3, minScore: 76, maxScore: 84, percentile: 77 },
  { examYear: 2024, examMonth: 11, subject: "수학", grade: 4, minScore: 64, maxScore: 75, percentile: 60 },
  { examYear: 2024, examMonth: 11, subject: "수학", grade: 5, minScore: 50, maxScore: 63, percentile: 40 },
  { examYear: 2024, examMonth: 11, subject: "수학", grade: 6, minScore: 36, maxScore: 49, percentile: 23 },
  { examYear: 2024, examMonth: 11, subject: "수학", grade: 7, minScore: 24, maxScore: 35, percentile: 11 },
  { examYear: 2024, examMonth: 11, subject: "수학", grade: 8, minScore: 12, maxScore: 23, percentile: 4 },
  { examYear: 2024, examMonth: 11, subject: "수학", grade: 9, minScore: 0, maxScore: 11, percentile: 0 },
];

@Injectable()
export class GradePredictionService {
  constructor(private prisma: PrismaService) {}

  async upsertCutoffs(data: CutoffInput[]) {
    const results = await Promise.all(
      data.map((row) =>
        this.prisma.gradeCutoff.upsert({
          where: {
            examYear_examMonth_subject_grade: {
              examYear: row.examYear,
              examMonth: row.examMonth,
              subject: row.subject,
              grade: row.grade,
            },
          },
          create: row,
          update: {
            minScore: row.minScore,
            maxScore: row.maxScore,
            percentile: row.percentile ?? null,
          },
        }),
      ),
    );
    return { upserted: results.length };
  }

  async getCutoffs(examYear?: number, examMonth?: number, subject?: string) {
    const where: Record<string, unknown> = {};
    if (examYear) where.examYear = examYear;
    if (examMonth) where.examMonth = examMonth;
    if (subject) where.subject = subject;

    const cutoffs = await this.prisma.gradeCutoff.findMany({
      where,
      orderBy: [
        { examYear: "desc" },
        { examMonth: "desc" },
        { subject: "asc" },
        { grade: "asc" },
      ],
    });

    // If no cutoffs exist, seed defaults and return them
    if (cutoffs.length === 0 && !examYear && !examMonth && !subject) {
      await this.upsertCutoffs(DEFAULT_CUTOFFS);
      return this.prisma.gradeCutoff.findMany({
        orderBy: [
          { examYear: "desc" },
          { examMonth: "desc" },
          { subject: "asc" },
          { grade: "asc" },
        ],
      });
    }

    return cutoffs;
  }

  async predictGrade(
    studentId: string,
    subject?: string,
  ): Promise<SubjectPrediction> {
    // Verify student exists
    const student = await this.prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true },
    });
    if (!student) throw new NotFoundException("Student not found");

    // Fetch recent graded submission answers with problem metadata
    const submissions = await this.prisma.submission.findMany({
      where: {
        studentId,
        status: { in: ["graded", "returned"] },
      },
      include: {
        answers: {
          where: { isCorrect: { not: null } },
        },
      },
      orderBy: { submittedAt: "desc" },
      take: 50,
    });

    const allAnswers = submissions.flatMap((s) => s.answers);

    if (allAnswers.length === 0) {
      return {
        subject: subject ?? "수학",
        predictedScore: 0,
        predictedGrade: 9,
        percentile: null,
        confidence: 0,
        totalAnswered: 0,
        totalCorrect: 0,
      };
    }

    // Fetch problem metadata for subject filtering
    const problemIds = [...new Set(allAnswers.map((a) => a.problemId))];
    const problems = await this.prisma.problem.findMany({
      where: { id: { in: problemIds } },
      select: { id: true, subject: true, difficulty: true },
    });
    const problemMap = new Map(problems.map((p) => [p.id, p]));

    // Filter by subject if provided
    const filteredAnswers = subject
      ? allAnswers.filter((a) => {
          const prob = problemMap.get(a.problemId);
          return prob?.subject === subject;
        })
      : allAnswers;

    if (filteredAnswers.length === 0) {
      return {
        subject: subject ?? "수학",
        predictedScore: 0,
        predictedGrade: 9,
        percentile: null,
        confidence: 0,
        totalAnswered: 0,
        totalCorrect: 0,
      };
    }

    const totalCorrect = filteredAnswers.filter((a) => a.isCorrect).length;
    const totalAnswered = filteredAnswers.length;
    const accuracy = totalCorrect / totalAnswered;

    // Weight by difficulty if available
    let weightedScore = accuracy;
    const answersWithDiff = filteredAnswers.filter((a) => {
      const p = problemMap.get(a.problemId);
      return p?.difficulty != null;
    });

    if (answersWithDiff.length > 0) {
      let weightedCorrect = 0;
      let totalWeight = 0;
      for (const ans of answersWithDiff) {
        const diff = problemMap.get(ans.problemId)?.difficulty ?? 3;
        const weight = diff / 5; // normalize 1-5 to 0.2-1.0
        totalWeight += weight;
        if (ans.isCorrect) weightedCorrect += weight;
      }
      if (totalWeight > 0) {
        weightedScore = weightedCorrect / totalWeight;
      }
    }

    // Scale to 0-100
    const predictedScore = Math.round(weightedScore * 100);

    // Confidence based on sample size (max out at 50 answers)
    const confidence = Math.min(1, totalAnswered / 50);

    // Map to grade using cutoff table
    const targetSubject = subject ?? "수학";
    const cutoffs = await this.prisma.gradeCutoff.findMany({
      where: { subject: targetSubject },
      orderBy: [{ examYear: "desc" }, { examMonth: "desc" }, { grade: "asc" }],
    });

    // Use the most recent cutoff set
    let predictedGrade = 9;
    let percentile: number | null = null;

    if (cutoffs.length > 0) {
      const latestYear = cutoffs[0].examYear;
      const latestMonth = cutoffs[0].examMonth;
      const latestCutoffs = cutoffs.filter(
        (c) => c.examYear === latestYear && c.examMonth === latestMonth,
      );

      for (const cutoff of latestCutoffs) {
        if (predictedScore >= cutoff.minScore && predictedScore <= cutoff.maxScore) {
          predictedGrade = cutoff.grade;
          percentile = cutoff.percentile;
          break;
        }
      }
    } else {
      // Fallback without cutoff data: simple mapping
      if (predictedScore >= 92) predictedGrade = 1;
      else if (predictedScore >= 85) predictedGrade = 2;
      else if (predictedScore >= 76) predictedGrade = 3;
      else if (predictedScore >= 64) predictedGrade = 4;
      else if (predictedScore >= 50) predictedGrade = 5;
      else if (predictedScore >= 36) predictedGrade = 6;
      else if (predictedScore >= 24) predictedGrade = 7;
      else if (predictedScore >= 12) predictedGrade = 8;
      else predictedGrade = 9;
    }

    return {
      subject: targetSubject,
      predictedScore,
      predictedGrade,
      percentile,
      confidence: Math.round(confidence * 100) / 100,
      totalAnswered,
      totalCorrect,
    };
  }

  async getStudentPredictions(studentId: string) {
    // Get distinct subjects from student's answered problems
    const submissions = await this.prisma.submission.findMany({
      where: {
        studentId,
        status: { in: ["graded", "returned"] },
      },
      include: {
        answers: {
          where: { isCorrect: { not: null } },
          select: { problemId: true },
        },
      },
    });

    const problemIds = [
      ...new Set(submissions.flatMap((s) => s.answers.map((a) => a.problemId))),
    ];

    if (problemIds.length === 0) {
      return { studentId, predictions: [] };
    }

    const problems = await this.prisma.problem.findMany({
      where: { id: { in: problemIds } },
      select: { subject: true },
    });

    const subjects = [...new Set(problems.map((p) => p.subject).filter(Boolean))] as string[];

    // If no subjects found, predict for default "수학"
    if (subjects.length === 0) {
      const prediction = await this.predictGrade(studentId);
      return { studentId, predictions: [prediction] };
    }

    const predictions = await Promise.all(
      subjects.map((s) => this.predictGrade(studentId, s)),
    );

    return {
      studentId,
      predictions: predictions.filter((p) => p.totalAnswered > 0),
    };
  }
}
