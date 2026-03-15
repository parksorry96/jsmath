import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import OpenAI from "openai";
import { PrismaService } from "../../prisma/prisma.service";
import { KnowledgeGraphService } from "./knowledge-graph.service";

interface ErrorPatterns {
  concept_gap: number;
  calculation_error: number;
  careless_mistake: number;
  pattern_gap: number;
}

interface UnitAccuracy {
  subject: string;
  unitMajor: string;
  accuracy: number;
  attemptCount: number;
  topErrorType: string | null;
}

@Injectable()
export class WeaknessProfileService {
  private readonly logger = new Logger(WeaknessProfileService.name);
  private client: OpenAI | null = null;

  constructor(
    private prisma: PrismaService,
    private knowledgeGraph: KnowledgeGraphService,
    private config: ConfigService,
  ) {}

  private getClient(): OpenAI {
    if (!this.client) {
      const apiKey =
        this.config.get("AI_API_KEY") ??
        this.config.get("OPENAI_API_KEY");
      if (!apiKey) {
        throw new Error("AI_API_KEY is not configured");
      }
      const baseURL =
        this.config.get("AI_API_BASE_URL") ?? "https://api.openai.com/v1";
      this.client = new OpenAI({ apiKey, baseURL });
    }
    return this.client;
  }

  async updateProfile(studentId: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 1. Query unresolved WrongAnswer records (last 30 days)
    const wrongAnswers = await this.prisma.wrongAnswer.findMany({
      where: {
        studentId,
        resolvedAt: null,
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    // Fetch associated problems for wrong answers
    const wrongProblemIds = [
      ...new Set(wrongAnswers.map((wa) => wa.problemId)),
    ];
    const wrongProblems =
      wrongProblemIds.length > 0
        ? await this.prisma.problem.findMany({
            where: { id: { in: wrongProblemIds } },
            select: { id: true, subject: true, unitMajor: true },
          })
        : [];
    const wrongProblemMap = new Map(wrongProblems.map((p) => [p.id, p]));

    // 2. Query SubmissionAnswer with Problem info for accuracy
    const submissionAnswers = await this.prisma.submissionAnswer.findMany({
      where: {
        submission: { studentId },
        isCorrect: { not: null },
      },
      select: {
        problemId: true,
        isCorrect: true,
      },
    });

    const answerProblemIds = [
      ...new Set(submissionAnswers.map((a) => a.problemId)),
    ];
    const answerProblems =
      answerProblemIds.length > 0
        ? await this.prisma.problem.findMany({
            where: { id: { in: answerProblemIds } },
            select: { id: true, subject: true, unitMajor: true },
          })
        : [];
    const answerProblemMap = new Map(answerProblems.map((p) => [p.id, p]));

    // 3. Get knowledge graph root causes
    let rootCauses: string[] = [];
    try {
      const graph =
        await this.knowledgeGraph.getStudentKnowledgeGraph(studentId);
      rootCauses = graph.weaknessRoots;
    } catch (err) {
      this.logger.error(`Failed to get knowledge graph for ${studentId}`, err);
    }

    // 4. Aggregate
    const wrongAnswersWithProblem = wrongAnswers.map((wa) => ({
      ...wa,
      problem: wrongProblemMap.get(wa.problemId) ?? null,
    }));

    const errorPatterns = this.aggregateErrorPatterns(wrongAnswersWithProblem);

    const answersWithProblem = submissionAnswers.map((a) => ({
      ...a,
      problem: answerProblemMap.get(a.problemId) ?? null,
    }));
    const unitAccuracies = this.computeUnitAccuracy(answersWithProblem);

    // Populate topErrorType from wrong answers
    for (const unit of unitAccuracies) {
      const unitWrongAnswers = wrongAnswersWithProblem.filter(
        (wa) => wa.problem?.subject === unit.subject && wa.problem?.unitMajor === unit.unitMajor,
      );
      if (unitWrongAnswers.length > 0) {
        const counts: Record<string, number> = {};
        for (const wa of unitWrongAnswers) {
          const et = wa.errorType;
          counts[et] = (counts[et] || 0) + 1;
        }
        unit.topErrorType = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      }
    }

    // 5. Generate AI summary
    const profileData = { errorPatterns, unitAccuracies, rootCauses };
    let aiSummary: string | null = null;
    let aiSummaryModel: string | null = null;
    try {
      aiSummary = await this.generateAiSummary(profileData);
      aiSummaryModel = this.config.get("AI_MODEL") ?? "gpt-5.4";
    } catch (err) {
      this.logger.error(`Failed to generate AI summary for ${studentId}`, err);
    }

    // 6. Upsert StudentWeaknessProfile + Units in a transaction
    const errorPatternsJson = errorPatterns as unknown as Prisma.InputJsonValue;
    const rootCausesJson = rootCauses as unknown as Prisma.InputJsonValue;

    const profile = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.studentWeaknessProfile.upsert({
        where: { studentId },
        create: {
          studentId,
          errorPatterns: errorPatternsJson,
          rootCauses: rootCausesJson,
          aiSummary,
          aiSummaryModel,
        },
        update: {
          errorPatterns: errorPatternsJson,
          rootCauses: rootCausesJson,
          aiSummary,
          aiSummaryModel,
        },
      });

      // 7. Upsert StudentWeaknessUnit records
      for (const unit of unitAccuracies) {
        await tx.studentWeaknessUnit.upsert({
          where: {
            profileId_subject_unitMajor: {
              profileId: upserted.id,
              subject: unit.subject,
              unitMajor: unit.unitMajor,
            },
          },
          create: {
            profileId: upserted.id,
            subject: unit.subject,
            unitMajor: unit.unitMajor,
            accuracy: unit.accuracy,
            attemptCount: unit.attemptCount,
            topErrorType: unit.topErrorType,
          },
          update: {
            accuracy: unit.accuracy,
            attemptCount: unit.attemptCount,
            topErrorType: unit.topErrorType,
          },
        });
      }

      return upserted;
    });

    return profile;
  }

  aggregateErrorPatterns(
    wrongAnswers: Array<{ errorType: string }>,
  ): ErrorPatterns {
    const patterns: ErrorPatterns = {
      concept_gap: 0,
      calculation_error: 0,
      careless_mistake: 0,
      pattern_gap: 0,
    };

    for (const wa of wrongAnswers) {
      const canonical = this.mapErrorType(wa.errorType);
      if (canonical in patterns) {
        patterns[canonical as keyof ErrorPatterns]++;
      }
    }

    return patterns;
  }

  computeUnitAccuracy(
    answers: Array<{
      isCorrect: boolean | null;
      problem: { subject: string | null; unitMajor: string | null } | null;
    }>,
  ): UnitAccuracy[] {
    const groups = new Map<
      string,
      { subject: string; unitMajor: string; correct: number; total: number }
    >();

    for (const ans of answers) {
      if (!ans.problem?.subject || !ans.problem?.unitMajor) continue;
      if (ans.isCorrect === null) continue;

      const key = `${ans.problem.subject}::${ans.problem.unitMajor}`;
      const group = groups.get(key) ?? {
        subject: ans.problem.subject,
        unitMajor: ans.problem.unitMajor,
        correct: 0,
        total: 0,
      };
      group.total++;
      if (ans.isCorrect) group.correct++;
      groups.set(key, group);
    }

    return [...groups.values()].map((g) => ({
      subject: g.subject,
      unitMajor: g.unitMajor,
      accuracy: g.total > 0 ? g.correct / g.total : 0,
      attemptCount: g.total,
      topErrorType: null,
    }));
  }

  mapErrorType(fineGrained: string): string {
    switch (fineGrained) {
      case "sign_error":
      case "transcription_error":
        return "careless_mistake";
      case "formula_error":
      case "concept_error":
        return "concept_gap";
      case "logic_error":
        return "pattern_gap";
      case "calculation_error":
        return "calculation_error";
      default:
        return fineGrained;
    }
  }

  async generateAiSummary(profileData: {
    errorPatterns: ErrorPatterns;
    unitAccuracies: UnitAccuracy[];
    rootCauses: string[];
  }): Promise<string | null> {
    const systemPrompt =
      "You are a math education analyst. Given the student's weakness data, provide a concise Korean-language summary (3-5 sentences) identifying: primary weak areas, error patterns, and recommended focus areas.";

    const client = this.getClient();
    const model = this.config.get("AI_MODEL") ?? "gpt-5.4";

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(profileData) },
      ],
      temperature: 0.5,
    });

    return completion.choices[0]?.message?.content ?? null;
  }

  async getProfile(studentId: string) {
    return this.prisma.studentWeaknessProfile.findUnique({
      where: { studentId },
      include: { units: true },
    });
  }

  async getClassHeatmap(classId: string) {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classId, role: "student" },
      select: { userId: true },
    });

    const studentIds = enrollments.map((e) => e.userId);
    if (studentIds.length === 0) return [];

    const profiles = await this.prisma.studentWeaknessProfile.findMany({
      where: { studentId: { in: studentIds } },
      select: { id: true },
    });

    const profileIds = profiles.map((p) => p.id);
    if (profileIds.length === 0) return [];

    const units = await this.prisma.studentWeaknessUnit.findMany({
      where: { profileId: { in: profileIds } },
    });

    // Group by (subject, unitMajor) and average accuracy
    const groups = new Map<
      string,
      { subject: string; unitMajor: string; totalAccuracy: number; count: number }
    >();

    for (const unit of units) {
      const key = `${unit.subject}::${unit.unitMajor}`;
      const group = groups.get(key) ?? {
        subject: unit.subject,
        unitMajor: unit.unitMajor,
        totalAccuracy: 0,
        count: 0,
      };
      group.totalAccuracy += unit.accuracy;
      group.count++;
      groups.set(key, group);
    }

    return [...groups.values()].map((g) => ({
      subject: g.subject,
      unitMajor: g.unitMajor,
      avgAccuracy: g.count > 0 ? g.totalAccuracy / g.count : 0,
      studentCount: g.count,
    }));
  }

  async getStudentWeakness(studentId: string) {
    return this.prisma.studentWeaknessProfile.findUnique({
      where: { studentId },
      include: { units: true },
    });
  }
}
