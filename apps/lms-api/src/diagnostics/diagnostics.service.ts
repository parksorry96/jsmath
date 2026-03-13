import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AnswerDiagnosticDto } from "./dto/answer-diagnostic.dto";
import {
  AbilityEstimate,
  TopicAbility,
  difficultyToB,
  updateAbility,
  selectNextDifficulty,
  selectNextTopic,
  computeProfile,
} from "./irt-engine";

const MAX_RESPONSES = 25;
const SE_THRESHOLD = 0.3;

interface StoredAbility {
  global: AbilityEstimate;
  topics: TopicAbility[];
  currentProblemId: string | null;
}

@Injectable()
export class DiagnosticsService {
  constructor(private prisma: PrismaService) {}

  async startSession(studentId: string) {
    // Get all distinct topics from approved problems
    const topics = await this.getAvailableTopics();
    if (topics.length === 0) {
      throw new BadRequestException("No approved problems available for diagnostics");
    }

    // Select first problem: medium difficulty from least-tested topic
    const targetTopic = selectNextTopic([], topics);
    const problem = await this.findProblem(targetTopic, [2, 4], []);

    if (!problem) {
      throw new BadRequestException("No matching problem found to start diagnostic");
    }

    const initialAbility: StoredAbility = {
      global: { theta: 0, se: 1.5, responses: 0 },
      topics: [],
      currentProblemId: problem.id,
    };

    const session = await this.prisma.diagnosticSession.create({
      data: {
        studentId,
        currentAbility: initialAbility as any,
      },
    });

    return {
      session: {
        id: session.id,
        status: session.status,
        startedAt: session.startedAt,
      },
      problem: this.serializeProblem(problem),
      progress: { current: 0, total: MAX_RESPONSES },
    };
  }

  async submitAnswer(
    sessionId: string,
    studentId: string,
    dto: AnswerDiagnosticDto,
  ) {
    const session = await this.prisma.diagnosticSession.findUnique({
      where: { id: sessionId },
      include: {
        responses: {
          orderBy: { orderIndex: "desc" },
          take: 1,
        },
      },
    });

    if (!session) throw new NotFoundException("Session not found");
    if (session.studentId !== studentId) {
      throw new ForbiddenException("Not authorized to access this session");
    }
    if (session.status !== "in_progress") {
      throw new BadRequestException("Session is no longer in progress");
    }

    const ability = session.currentAbility as unknown as StoredAbility;
    const lastResponse = session.responses[0];
    const orderIndex = lastResponse ? lastResponse.orderIndex + 1 : 0;

    // Get the current problem from the stored state
    if (!ability.currentProblemId) {
      throw new BadRequestException("No current problem to answer");
    }

    const currentProblem = await this.prisma.problem.findUnique({
      where: { id: ability.currentProblemId },
      include: { choices: { orderBy: { position: "asc" } } },
    });
    if (!currentProblem) {
      throw new BadRequestException("Current problem not found");
    }

    // Auto-grade
    const isCorrect = this.gradeAnswer(
      currentProblem,
      dto.studentAnswer,
    );

    // IRT update
    const b = difficultyToB(currentProblem.difficulty ?? 3);
    const abilityBefore = ability.global.theta;
    ability.global = updateAbility(ability.global, b, isCorrect);
    const abilityAfter = ability.global.theta;

    // Update topic ability
    const topicKey = `${currentProblem.subject ?? ""}::${currentProblem.unitMajor ?? ""}`;
    let topicAbility = ability.topics.find(
      (t) => `${t.subject}::${t.unitMajor}` === topicKey,
    );

    if (!topicAbility) {
      topicAbility = {
        subject: currentProblem.subject ?? "",
        unitMajor: currentProblem.unitMajor ?? "",
        theta: 0,
        se: 1.5,
        responses: 0,
      };
      ability.topics.push(topicAbility);
    }
    const updatedTopic = updateAbility(
      { theta: topicAbility.theta, se: topicAbility.se, responses: topicAbility.responses },
      b,
      isCorrect,
    );
    topicAbility.theta = updatedTopic.theta;
    topicAbility.se = updatedTopic.se;
    topicAbility.responses = updatedTopic.responses;

    // Store response
    await this.prisma.diagnosticResponse.create({
      data: {
        sessionId,
        problemId: currentProblem.id,
        studentAnswer: dto.studentAnswer,
        isCorrect,
        responseTimeSec: dto.responseTimeSec,
        abilityBefore,
        abilityAfter,
        orderIndex,
      },
    });

    // Check termination
    const totalResponses = ability.global.responses;
    const allTopicsConverged =
      ability.topics.length > 0 &&
      ability.topics.every((t) => t.se < SE_THRESHOLD);
    const shouldComplete = totalResponses >= MAX_RESPONSES || allTopicsConverged;

    if (shouldComplete) {
      const profile = computeProfile(ability.topics);
      await this.prisma.diagnosticSession.update({
        where: { id: sessionId },
        data: {
          status: "completed",
          currentAbility: ability as any,
          result: profile as any,
          completedAt: new Date(),
        },
      });

      return {
        isComplete: true,
        result: profile,
        progress: { current: totalResponses, total: MAX_RESPONSES },
        lastAnswer: { isCorrect, problemId: currentProblem.id },
      };
    }

    // Select next problem
    const topics = await this.getAvailableTopics();
    const targetTopic = selectNextTopic(ability.topics, topics);
    const [minDiff, maxDiff] = selectNextDifficulty(ability.global.theta);

    // Get already-answered problem IDs
    const answeredProblems = await this.prisma.diagnosticResponse.findMany({
      where: { sessionId },
      select: { problemId: true },
    });
    const excludeIds = answeredProblems.map((r) => r.problemId);

    const nextProblem = await this.findProblem(
      targetTopic,
      [minDiff, maxDiff],
      excludeIds,
    );

    // Store next problem ID in session state
    ability.currentProblemId = nextProblem?.id ?? null;

    // Update session
    await this.prisma.diagnosticSession.update({
      where: { id: sessionId },
      data: {
        currentAbility: ability as any,
      },
    });

    return {
      isComplete: false,
      problem: nextProblem ? this.serializeProblem(nextProblem) : null,
      progress: { current: totalResponses, total: MAX_RESPONSES },
      lastAnswer: { isCorrect, problemId: currentProblem.id },
    };
  }

  async getResult(sessionId: string, userId: string, role: string) {
    const session = await this.prisma.diagnosticSession.findUnique({
      where: { id: sessionId },
      include: {
        responses: {
          orderBy: { orderIndex: "asc" },
        },
      },
    });

    if (!session) throw new NotFoundException("Session not found");

    // Students can see their own results; teachers/admins can see all
    if (role === "student" && session.studentId !== userId) {
      throw new ForbiddenException("Not authorized to view this result");
    }

    return {
      id: session.id,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      result: session.result,
      responses: session.responses,
      totalResponses: session.responses.length,
    };
  }

  async getHistory(studentId: string) {
    const sessions = await this.prisma.diagnosticSession.findMany({
      where: { studentId },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        result: true,
        _count: { select: { responses: true } },
      },
    });

    return sessions.map((s) => ({
      id: s.id,
      status: s.status,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
      result: s.result,
      responseCount: s._count.responses,
    }));
  }

  // --- Private helpers ---

  private async getAvailableTopics(): Promise<
    Array<{ subject: string; unitMajor: string }>
  > {
    const rows = await this.prisma.problem.groupBy({
      by: ["subject", "unitMajor"],
      where: {
        reviewStatus: { in: ["approved", "auto_approved"] },
        subject: { not: null },
        unitMajor: { not: null },
        difficulty: { not: null },
        // Only auto-gradable types
        problemType: { in: ["multiple_choice", "short_answer"] },
      },
    });

    return rows
      .filter((r) => r.subject && r.unitMajor)
      .map((r) => ({
        subject: r.subject!,
        unitMajor: r.unitMajor!,
      }));
  }

  private async findProblem(
    topic: { subject: string; unitMajor: string },
    difficultyRange: [number, number],
    excludeIds: string[],
  ) {
    // Try exact topic + difficulty first
    let problem = await this.prisma.problem.findFirst({
      where: {
        reviewStatus: { in: ["approved", "auto_approved"] },
        problemType: { in: ["multiple_choice", "short_answer"] },
        subject: topic.subject || undefined,
        unitMajor: topic.unitMajor || undefined,
        difficulty: { gte: difficultyRange[0], lte: difficultyRange[1] },
        id: excludeIds.length > 0 ? { notIn: excludeIds } : undefined,
        answerText: { not: null },
      },
      include: {
        choices: { orderBy: { position: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (problem) return problem;

    // Relax difficulty constraint
    problem = await this.prisma.problem.findFirst({
      where: {
        reviewStatus: { in: ["approved", "auto_approved"] },
        problemType: { in: ["multiple_choice", "short_answer"] },
        subject: topic.subject || undefined,
        unitMajor: topic.unitMajor || undefined,
        id: excludeIds.length > 0 ? { notIn: excludeIds } : undefined,
        answerText: { not: null },
      },
      include: {
        choices: { orderBy: { position: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (problem) return problem;

    // Relax topic constraint — any available problem
    return this.prisma.problem.findFirst({
      where: {
        reviewStatus: { in: ["approved", "auto_approved"] },
        problemType: { in: ["multiple_choice", "short_answer"] },
        id: excludeIds.length > 0 ? { notIn: excludeIds } : undefined,
        answerText: { not: null },
      },
      include: {
        choices: { orderBy: { position: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  private gradeAnswer(problem: any, studentAnswer: string): boolean {
    const expected = problem.answerText ?? "";

    if (problem.problemType === "multiple_choice") {
      // Compare choice label (e.g., "1", "2", "3")
      return studentAnswer === expected;
    }

    // Short answer: normalize and compare
    const normalize = (s: string) =>
      s.trim().toLowerCase().replace(/\s+/g, "");
    return normalize(studentAnswer) === normalize(expected);
  }

  private serializeProblem(problem: any) {
    return {
      id: problem.id,
      stemLatex: problem.stemLatex,
      stemText: problem.stemText,
      problemType: problem.problemType,
      difficulty: problem.difficulty,
      subject: problem.subject,
      unitMajor: problem.unitMajor,
      unitMinor: problem.unitMinor,
      choices: problem.choices?.map((c: any) => ({
        label: c.label,
        contentLatex: c.contentLatex,
        contentText: c.contentText,
      })),
    };
  }
}
