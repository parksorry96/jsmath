import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { PrismaService } from "../../prisma/prisma.service";
import { CanvasUploadService } from "../canvas/canvas-upload.service";
import { WeaknessProfileService } from "../weakness/weakness-profile.service";
import {
  TutorWeaknessSignal,
  TutorWeaknessErrorType,
} from "./tutor-weakness-signal";

@Injectable()
export class TutorVisionService {
  private readonly logger = new Logger(TutorVisionService.name);
  private client: OpenAI | null = null;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private canvasUpload: CanvasUploadService,
    private weaknessProfile: WeaknessProfileService,
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

  private mapSessionSummaries(
    sessions: Array<{
      id: string;
      problemId: string;
      status: string;
      createdAt: Date;
      updatedAt: Date;
      _count: { messages: number };
    }>,
    problemMap: Map<
      string,
      {
        stemText: string;
        stemLatex: string;
        subject: string | null;
        unitMajor: string | null;
      }
    >,
  ) {
    return sessions.map((session) => {
      const problem = problemMap.get(session.problemId);

      return {
        id: session.id,
        problemId: session.problemId,
        status: session.status,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        problem: problem
          ? {
              stemText: problem.stemText || problem.stemLatex || "",
              subject: problem.subject,
              unitMajor: problem.unitMajor,
            }
          : null,
        _count: {
          messages: session._count.messages,
        },
      };
    });
  }

  inferWeaknessSignal(
    problem: {
      id: string;
      curriculumNodeId: string | null;
      subject: string | null;
      unitMajor: string | null;
    },
    studentContent: string,
    tutorResponse: string,
    imageS3Key?: string,
  ): TutorWeaknessSignal | null {
    const normalizedStudent = studentContent.toLowerCase();
    const normalizedTutor = tutorResponse.toLowerCase();
    const combined = `${normalizedStudent}\n${normalizedTutor}`;

    const errorType = this.detectErrorType(combined);
    const expressesConfusion =
      /모르겠|헷갈|어려|막혔|이해가 안|왜 안|잘 안|도와줘|힌트/.test(studentContent);
    const exactClassification =
      /\bconcept_gap\b|\bpattern_gap\b|\bcalculation_error\b|\bcareless_mistake\b/.test(
        combined,
      );

    let confidence = imageS3Key ? 0.8 : 0.38;
    if (expressesConfusion) confidence += 0.08;
    if (errorType) confidence += 0.08;
    if (exactClassification) confidence += 0.06;
    confidence = Math.max(0.2, Math.min(0.95, confidence));

    const evidence = [studentContent.trim(), tutorResponse.trim()]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 500);

    if (!problem.subject && !problem.unitMajor && evidence.length === 0) {
      return null;
    }

    return {
      source: imageS3Key ? "worked_solution" : "tutor_message",
      problemId: problem.id,
      curriculumNodeId: problem.curriculumNodeId,
      subject: problem.subject,
      unitMajor: problem.unitMajor,
      errorType,
      confidence,
      evidence,
    };
  }

  private detectErrorType(content: string): TutorWeaknessErrorType | null {
    if (
      /\bconcept_gap\b|개념\s*(부족|오류|이해)|정의|공식|원리|개념부터/.test(
        content,
      )
    ) {
      return "concept_gap";
    }

    if (
      /\bpattern_gap\b|유형|패턴|접근\s*방법|전략|풀이\s*방향|논리/.test(content)
    ) {
      return "pattern_gap";
    }

    if (
      /\bcalculation_error\b|계산\s*실수|연산\s*실수|전개\s*실수|부호\s*계산|산술/.test(
        content,
      )
    ) {
      return "calculation_error";
    }

    if (
      /\bcareless_mistake\b|부주의|조건을?\s*놓|잘못\s*읽|단순\s*실수|기호를?\s*빼먹/.test(
        content,
      )
    ) {
      return "careless_mistake";
    }

    return null;
  }

  private buildSystemPrompt(
    problem: {
      stemLatex: string;
      stemText: string;
      answerText: string | null;
      answerLatex: string | null;
      solutionStrategy: string | null;
      solutionSteps: unknown;
      requiredConcepts: unknown;
      commonMistakes: unknown;
      subject: string | null;
      unitMajor: string | null;
    },
    hasImages: boolean,
  ): string {
    const answer = problem.answerText || problem.answerLatex || "unknown";
    const strategy = problem.solutionStrategy || "not available";
    const steps = problem.solutionSteps
      ? JSON.stringify(problem.solutionSteps)
      : "not available";
    const concepts = problem.requiredConcepts
      ? JSON.stringify(problem.requiredConcepts)
      : "not available";
    const mistakes = problem.commonMistakes
      ? JSON.stringify(problem.commonMistakes)
      : "not available";

    let prompt = `You are a Socratic math tutor for Korean high school students.

RULES (STRICT):
1. NEVER give the answer directly. Your goal is to guide the student to find the answer themselves.
2. Ask ONE question at a time.
3. If the student is stuck, give a small hint — NOT the solution.
4. Always respond in Korean (한국어).
5. Use $...$ for inline LaTeX and $$...$$ for block LaTeX.
6. Keep responses concise: 2-4 sentences.
7. Be encouraging and patient.
8. If the student solves the problem correctly, congratulate them warmly.

PROBLEM INFORMATION (hidden from student):
- Subject: ${problem.subject || "math"} / ${problem.unitMajor || "general"}
- Stem: ${problem.stemText}
- Correct Answer: ${answer}
- Solution Strategy: ${strategy}
- Solution Steps: ${steps}
- Required Concepts: ${concepts}
- Common Mistakes: ${mistakes}

Use this information to guide your questioning. Lead the student toward the correct reasoning path without revealing the answer.`;

    if (hasImages) {
      prompt += `

When the student sends a handwritten solution image:
- Analyze each step of the solution in order.
- Identify the specific line and type of error.
- Classify the error as one of: concept_gap, pattern_gap, calculation_error, careless_mistake.
- Point out what went wrong WITHOUT giving the correct answer.
- Guide the student to find the error themselves through questions.
- Respond in Korean.`;
    }

    return prompt;
  }

  validateSessionLimits(
    session: { messages: unknown[] },
    imageS3Key?: string,
  ) {
    const messageCount = session.messages.length;
    if (messageCount >= 30) {
      throw new BadRequestException("Maximum 30 messages per session reached");
    }
    if (imageS3Key) {
      const imageCount = session.messages.filter(
        (m) => m && typeof m === "object" && "metadata" in m && (m as any).metadata && (m as any).metadata.imageS3Key,
      ).length;
      if (imageCount >= 5) {
        throw new BadRequestException("Maximum 5 images per session reached");
      }
    }
  }

  private async buildMessagesWithImages(
    dbMessages: Array<{
      role: string;
      content: string;
      metadata: unknown;
    }>,
    currentImageData: { base64: string; mimeType: string } | null,
  ): Promise<ChatCompletionMessageParam[]> {
    const messages: ChatCompletionMessageParam[] = [];

    // Find indices of messages with images (excluding the last/current one)
    const imageIndices: number[] = [];
    for (let i = 0; i < dbMessages.length; i++) {
      const meta = dbMessages[i].metadata as any;
      if (meta?.imageS3Key) {
        imageIndices.push(i);
      }
    }

    // The last message is the current turn (already has currentImageData)
    const currentTurnIndex = dbMessages.length - 1;
    const previousImageIndices = imageIndices.filter(
      (idx) => idx !== currentTurnIndex,
    );

    // Last 1 previous image gets re-downloaded; older ones become text-only
    const recentPreviousIdx =
      previousImageIndices.length > 0
        ? previousImageIndices[previousImageIndices.length - 1]
        : -1;

    for (let i = 0; i < dbMessages.length; i++) {
      const msg = dbMessages[i];
      const role = msg.role === "student" ? "user" : "assistant";
      const meta = msg.metadata as any;

      if (role === "assistant") {
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }

      // Current turn with image
      if (i === currentTurnIndex && currentImageData) {
        messages.push({
          role: "user",
          content: [
            { type: "text" as const, text: msg.content },
            {
              type: "image_url" as const,
              image_url: {
                url: `data:${currentImageData.mimeType};base64,${currentImageData.base64}`,
              },
            },
          ],
        });
        continue;
      }

      // Last 1 previous image: re-download from S3
      if (i === recentPreviousIdx && meta?.imageS3Key) {
        try {
          const { base64, mimeType } = await this.canvasUpload.downloadAsBase64(
            meta.imageS3Key,
          );
          messages.push({
            role: "user",
            content: [
              { type: "text" as const, text: msg.content },
              {
                type: "image_url" as const,
                image_url: { url: `data:${mimeType};base64,${base64}` },
              },
            ],
          });
          continue;
        } catch (err) {
          this.logger.error(`Failed to download previous image (key=${meta.imageS3Key})`, err instanceof Error ? err.stack : err);
          // Fall through to text-only
        }
      }

      // Older images (2+): text-only with analysis summary
      if (meta?.imageS3Key && i !== currentTurnIndex) {
        const analysis = meta.imageAnalysis
          ? `\n[Previous solution analysis: ${meta.imageAnalysis}]`
          : "";
        messages.push({
          role: "user",
          content: msg.content + analysis,
        });
        continue;
      }

      // Regular text message
      messages.push({ role, content: msg.content });
    }

    return messages;
  }

  async createSession(studentId: string, problemId: string) {
    const problem = await this.prisma.problem.findFirst({
      where: {
        id: problemId,
        reviewStatus: { in: ["approved", "auto_approved"] },
      },
    });

    if (!problem) {
      throw new NotFoundException("Problem not found");
    }

    const model = this.config.get("AI_MODEL") ?? "gpt-5.4";
    const systemPrompt = this.buildSystemPrompt(problem, false);

    // Generate initial greeting via OpenAI (non-streaming)
    const completion = await this.getClient().chat.completions.create({
      model,
      temperature: 1,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            "Student just opened this problem for tutoring. Greet them warmly in Korean and ask what part they find difficult. Keep it to 2-3 sentences.",
        },
      ],
    });

    const greeting = completion.choices[0]?.message?.content;
    if (!greeting) {
      this.logger.warn(`GPT returned empty greeting for session, using fallback`);
    }
    const finalGreeting = greeting ?? "안녕하세요! 이 문제에서 어떤 부분이 어려우신가요? 함께 풀어봅시다!";

    const session = await this.prisma.tutorSession.create({
      data: {
        studentId,
        problemId,
      },
    });

    await this.prisma.tutorMessage.create({
      data: {
        sessionId: session.id,
        role: "tutor",
        content: finalGreeting,
      },
    });

    return {
      id: session.id,
      problemId: session.problemId,
      status: session.status,
      messages: [
        {
          role: "tutor",
          content: finalGreeting,
          createdAt: new Date().toISOString(),
        },
      ],
      problem: {
        id: problem.id,
        stemLatex: problem.stemLatex,
        stemText: problem.stemText,
        problemType: problem.problemType,
        difficulty: problem.difficulty,
        subject: problem.subject,
        unitMajor: problem.unitMajor,
      },
    };
  }

  async listSessions(studentId: string) {
    const sessions = await this.prisma.tutorSession.findMany({
      where: { studentId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: {
        id: true,
        problemId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

    if (sessions.length === 0) {
      return [];
    }

    const problemIds = [...new Set(sessions.map((session) => session.problemId))];
    const problems = await this.prisma.problem.findMany({
      where: { id: { in: problemIds } },
      select: {
        id: true,
        stemText: true,
        stemLatex: true,
        subject: true,
        unitMajor: true,
      },
    });

    const problemMap = new Map(
      problems.map((problem) => [problem.id, problem]),
    );

    return this.mapSessionSummaries(sessions, problemMap);
  }

  async *sendMessage(
    sessionId: string,
    studentId: string,
    content: string,
    imageS3Key?: string,
  ): AsyncGenerator<string> {
    const session = await this.prisma.tutorSession.findUnique({
      where: { id: sessionId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (!session) {
      throw new NotFoundException("Session not found");
    }
    if (session.studentId !== studentId) {
      throw new ForbiddenException("Not authorized to access this session");
    }
    if (session.status !== "active") {
      throw new BadRequestException("Session is no longer active");
    }

    this.validateSessionLimits(session, imageS3Key);

    // Download image if provided
    let imageData: { base64: string; mimeType: string } | null = null;
    if (imageS3Key) {
      const expectedPrefix = `canvas/${studentId}/`;
      if (!imageS3Key.startsWith(expectedPrefix) || imageS3Key.includes('..')) {
        throw new ForbiddenException('Invalid image key');
      }
      imageData = await this.canvasUpload.downloadAsBase64(imageS3Key);
    }

    // Store student message
    const studentMessage = await this.prisma.tutorMessage.create({
      data: {
        sessionId,
        role: "student",
        content,
        metadata: imageS3Key ? { imageS3Key } : undefined,
      },
    });

    // Build message history
    const problem = await this.prisma.problem.findUnique({
      where: { id: session.problemId },
    });
    if (!problem) {
      throw new NotFoundException("Problem not found");
    }

    const dbMessages = await this.prisma.tutorMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });

    const hasImages = dbMessages.some(
      (m) => m.metadata && (m.metadata as any).imageS3Key,
    );
    const systemPrompt = this.buildSystemPrompt(problem, hasImages);

    const chatMessages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
    ];

    const historyMessages = await this.buildMessagesWithImages(
      dbMessages.map((m) => ({
        role: m.role,
        content: m.content,
        metadata: m.metadata,
      })),
      imageData,
    );
    chatMessages.push(...historyMessages);

    // Stream from OpenAI
    const model = this.config.get("AI_MODEL") ?? "gpt-5.4";
    const stream = await this.getClient().chat.completions.create({
      model,
      temperature: 1,
      stream: true,
      messages: chatMessages,
    });

    let fullResponse = "";

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullResponse += delta;
        yield delta;
      }
    }

    // Store the full tutor response
    if (!fullResponse) {
      this.logger.warn(`GPT returned empty response for session ${sessionId}`);
    }
    if (fullResponse) {
      await this.prisma.tutorMessage.create({
        data: {
          sessionId,
          role: "tutor",
          content: fullResponse,
        },
      });

      const weaknessSignal = this.inferWeaknessSignal(
        {
          id: problem.id,
          curriculumNodeId: problem.curriculumNodeId,
          subject: problem.subject,
          unitMajor: problem.unitMajor,
        },
        content,
        fullResponse,
        imageS3Key,
      );

      const metadata: Record<string, unknown> = {};
      if (imageS3Key) {
        metadata.imageS3Key = imageS3Key;
        metadata.imageAnalysis = fullResponse.slice(0, 500);
      }
      if (weaknessSignal) {
        metadata.weaknessSignal = weaknessSignal;
      }

      if (Object.keys(metadata).length > 0) {
        await this.prisma.tutorMessage.update({
          where: { id: studentMessage.id },
          data: {
            metadata: metadata as Prisma.InputJsonValue,
          },
        });
      }

      if (weaknessSignal) {
        this.weaknessProfile
          .updateProfile(studentId, { skipAiSummary: true })
          .catch((err) => {
            this.logger.error(
              `Failed to refresh weakness profile for ${studentId}`,
              err instanceof Error ? err.stack : err,
            );
          });
      }
    }
  }

  async getSession(sessionId: string, userId: string) {
    const session = await this.prisma.tutorSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!session) {
      throw new NotFoundException("Session not found");
    }
    if (session.studentId !== userId) {
      throw new ForbiddenException("Not authorized to access this session");
    }

    const problem = await this.prisma.problem.findUnique({
      where: { id: session.problemId },
      select: {
        id: true,
        stemLatex: true,
        stemText: true,
        problemType: true,
        difficulty: true,
        subject: true,
        unitMajor: true,
      },
    });

    return {
      id: session.id,
      problemId: session.problemId,
      status: session.status,
      messages: session.messages.map((m) => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
      problem,
    };
  }

  async endSession(sessionId: string, studentId: string) {
    const session = await this.prisma.tutorSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException("Session not found");
    }
    if (session.studentId !== studentId) {
      throw new ForbiddenException("Not authorized to access this session");
    }

    return this.prisma.tutorSession.update({
      where: { id: sessionId },
      data: { status: "resolved" },
    });
  }
}
