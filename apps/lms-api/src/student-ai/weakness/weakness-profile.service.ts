import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import OpenAI from "openai";
import { PrismaService } from "../../prisma/prisma.service";
import { KnowledgeGraphService } from "./knowledge-graph.service";
import {
  extractTutorWeaknessSignal,
  TutorWeaknessSignal,
  tutorRootCauseKey,
} from "../tutor/tutor-weakness-signal";

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

interface UpdateProfileOptions {
  skipAiSummary?: boolean;
}

interface WrongAnswerAggregateRow {
  errorType: string;
  subject: string | null;
  unitMajor: string | null;
}

interface SubmissionAccuracyRow {
  isCorrect: boolean;
  subject: string | null;
  unitMajor: string | null;
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

  async updateProfile(studentId: string, options: UpdateProfileOptions = {}) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [wrongAnswers, submissionAnswers, tutorMessages] = await Promise.all([
      this.prisma.$queryRaw<WrongAnswerAggregateRow[]>`
        SELECT
          wa.error_type::text AS "errorType",
          p.subject AS subject,
          p.unit_major AS "unitMajor"
        FROM public.wrong_answers wa
        LEFT JOIN ocr.problems p ON p.id = wa.problem_id
        WHERE wa.student_id = ${studentId}
          AND wa.resolved_at IS NULL
          AND wa.created_at >= ${thirtyDaysAgo}
      `,
      this.prisma.$queryRaw<SubmissionAccuracyRow[]>`
        SELECT
          sa.is_correct AS "isCorrect",
          p.subject AS subject,
          p.unit_major AS "unitMajor"
        FROM public.submission_answers sa
        JOIN public.submissions s ON s.id = sa.submission_id
        LEFT JOIN ocr.problems p ON p.id = sa.problem_id
        WHERE s.student_id = ${studentId}
          AND s.created_at >= ${thirtyDaysAgo}
          AND sa.is_correct IS NOT NULL
      `,
      this.prisma.tutorMessage.findMany({
      where: {
        role: "student",
        createdAt: { gte: thirtyDaysAgo },
        session: {
          studentId,
        },
      },
      select: {
        metadata: true,
      },
      }),
    ]);
    const tutorSignals = tutorMessages
      .map((message) => extractTutorWeaknessSignal(message.metadata))
      .filter((signal): signal is TutorWeaknessSignal => signal !== null);

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
    const errorPatterns = this.mergeErrorPatterns(
      this.aggregateErrorPatterns(wrongAnswers),
      this.aggregateTutorErrorPatterns(tutorSignals),
    );

    const unitAccuracies = this.mergeTutorSignalsIntoUnitAccuracies(
      this.computeUnitAccuracy(submissionAnswers),
      tutorSignals,
    );

    rootCauses = [
      ...new Set([
        ...rootCauses,
        ...tutorSignals
          .map((signal) => tutorRootCauseKey(signal))
          .filter((key): key is string => key !== null),
      ]),
    ];

    const tutorUnitErrorCounts = this.groupTutorSignalErrorsByUnit(tutorSignals);
    const wrongAnswerCountsByUnit = new Map<string, Map<string, number>>();
    for (const wrongAnswer of wrongAnswers) {
      if (!wrongAnswer.subject || !wrongAnswer.unitMajor) continue;
      const key = `${wrongAnswer.subject}::${wrongAnswer.unitMajor}`;
      const counts = wrongAnswerCountsByUnit.get(key) ?? new Map<string, number>();
      counts.set(wrongAnswer.errorType, (counts.get(wrongAnswer.errorType) ?? 0) + 1);
      wrongAnswerCountsByUnit.set(key, counts);
    }

    // Populate topErrorType from wrong answers
    for (const unit of unitAccuracies) {
      const key = `${unit.subject}::${unit.unitMajor}`;
      const counts = new Map<string, number>(
        tutorUnitErrorCounts.get(key) ?? [],
      );
      const wrongCounts = wrongAnswerCountsByUnit.get(key);
      if (wrongCounts) {
        for (const [errorType, count] of wrongCounts.entries()) {
          counts.set(errorType, (counts.get(errorType) ?? 0) + count);
        }
      }
      unit.topErrorType =
        [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }

    // 5. Generate AI summary
    const profileData = {
      errorPatterns,
      unitAccuracies,
      rootCauses,
      tutorSignals: {
        count: tutorSignals.length,
        unitsAffected: [
          ...new Set(
            tutorSignals
              .map((signal) => tutorRootCauseKey(signal))
              .filter((key): key is string => key !== null),
          ),
        ],
      },
    };
    let aiSummary: string | null = null;
    let aiSummaryModel: string | null = null;
    if (!options.skipAiSummary) {
      try {
        aiSummary = await this.generateAiSummary(profileData);
        aiSummaryModel = this.config.get("AI_MODEL") ?? "gpt-5.4";
      } catch (err) {
        this.logger.error(`Failed to generate AI summary for ${studentId}`, err);
      }
    }

    const existingProfile = await this.prisma.studentWeaknessProfile.findUnique({
      where: { studentId },
      select: {
        aiSummary: true,
        aiSummaryModel: true,
      },
    });

    if (options.skipAiSummary) {
      aiSummary = existingProfile?.aiSummary ?? null;
      aiSummaryModel = existingProfile?.aiSummaryModel ?? null;
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

      await tx.studentWeaknessUnit.deleteMany({
        where: { profileId: upserted.id },
      });

      if (unitAccuracies.length > 0) {
        await tx.studentWeaknessUnit.createMany({
          data: unitAccuracies.map((unit) => ({
            profileId: upserted.id,
            subject: unit.subject,
            unitMajor: unit.unitMajor,
            accuracy: unit.accuracy,
            attemptCount: unit.attemptCount,
            topErrorType: unit.topErrorType,
          })),
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

  aggregateTutorErrorPatterns(signals: TutorWeaknessSignal[]): ErrorPatterns {
    const patterns: ErrorPatterns = {
      concept_gap: 0,
      calculation_error: 0,
      careless_mistake: 0,
      pattern_gap: 0,
    };

    for (const signal of signals) {
      if (!signal.errorType) continue;
      patterns[signal.errorType] += signal.confidence >= 0.7 ? 1 : 0.5;
    }

    return patterns;
  }

  mergeErrorPatterns(base: ErrorPatterns, extra: ErrorPatterns): ErrorPatterns {
    return {
      concept_gap: base.concept_gap + extra.concept_gap,
      calculation_error: base.calculation_error + extra.calculation_error,
      careless_mistake: base.careless_mistake + extra.careless_mistake,
      pattern_gap: base.pattern_gap + extra.pattern_gap,
    };
  }

  computeUnitAccuracy(
    answers: Array<{
      isCorrect: boolean | null;
      subject: string | null;
      unitMajor: string | null;
    }>,
  ): UnitAccuracy[] {
    const groups = new Map<
      string,
      { subject: string; unitMajor: string; correct: number; total: number }
    >();

    for (const ans of answers) {
      if (!ans.subject || !ans.unitMajor) continue;
      if (ans.isCorrect === null) continue;

      const key = `${ans.subject}::${ans.unitMajor}`;
      const group = groups.get(key) ?? {
        subject: ans.subject,
        unitMajor: ans.unitMajor,
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

  mergeTutorSignalsIntoUnitAccuracies(
    units: UnitAccuracy[],
    signals: TutorWeaknessSignal[],
  ): UnitAccuracy[] {
    const merged = new Map(
      units.map((unit) => [
        `${unit.subject}::${unit.unitMajor}`,
        { ...unit },
      ]),
    );

    for (const signal of signals) {
      if (!signal.subject || !signal.unitMajor) continue;

      const key = `${signal.subject}::${signal.unitMajor}`;
      const existing = merged.get(key) ?? {
        subject: signal.subject,
        unitMajor: signal.unitMajor,
        accuracy: 0.5,
        attemptCount: 0,
        topErrorType: signal.errorType,
      };

      const pseudoAttempts = signal.source === "worked_solution" ? 2 : 1;
      const syntheticAccuracy =
        signal.source === "worked_solution"
          ? Math.max(0.15, 0.42 - signal.confidence * 0.2)
          : Math.max(0.25, 0.58 - signal.confidence * 0.25);
      const currentCorrect = existing.accuracy * existing.attemptCount;
      const nextAttemptCount = existing.attemptCount + pseudoAttempts;
      const nextCorrect = currentCorrect + syntheticAccuracy * pseudoAttempts;

      merged.set(key, {
        ...existing,
        accuracy: nextAttemptCount > 0 ? nextCorrect / nextAttemptCount : 0,
        attemptCount: nextAttemptCount,
        topErrorType: existing.topErrorType ?? signal.errorType,
      });
    }

    return [...merged.values()].sort((a, b) =>
      `${a.subject}::${a.unitMajor}`.localeCompare(`${b.subject}::${b.unitMajor}`),
    );
  }

  groupTutorSignalErrorsByUnit(signals: TutorWeaknessSignal[]) {
    const groups = new Map<string, Map<string, number>>();

    for (const signal of signals) {
      if (!signal.subject || !signal.unitMajor || !signal.errorType) continue;

      const key = `${signal.subject}::${signal.unitMajor}`;
      const group = groups.get(key) ?? new Map<string, number>();
      group.set(
        signal.errorType,
        (group.get(signal.errorType) ?? 0) + (signal.confidence >= 0.7 ? 1 : 0.5),
      );
      groups.set(key, group);
    }

    return groups;
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
