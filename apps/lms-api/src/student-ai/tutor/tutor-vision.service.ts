import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class TutorVisionService {
  private client: OpenAI | null = null;

  constructor(
    private prisma: PrismaService,
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

  private buildSystemPrompt(problem: {
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
  }): string {
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

    return `You are a Socratic math tutor for Korean high school students.

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

    const systemPrompt = this.buildSystemPrompt(problem);

    // Generate initial greeting via OpenAI (non-streaming)
    const completion = await this.getClient().chat.completions.create({
      model: "gpt-5.4",
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content:
            "Student just opened this problem for tutoring. Greet them warmly in Korean and ask what part they find difficult. Keep it to 2-3 sentences.",
        },
      ],
    });

    const greeting =
      completion.choices[0]?.message?.content ??
      "안녕하세요! 이 문제에서 어떤 부분이 어려우신가요? 함께 풀어봅시다!";

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
        content: greeting,
      },
    });

    return {
      id: session.id,
      problemId: session.problemId,
      status: session.status,
      messages: [
        {
          role: "tutor",
          content: greeting,
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

  async *sendMessage(
    sessionId: string,
    studentId: string,
    content: string,
  ): AsyncGenerator<string> {
    const session = await this.prisma.tutorSession.findUnique({
      where: { id: sessionId },
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

    // Store student message
    await this.prisma.tutorMessage.create({
      data: {
        sessionId,
        role: "student",
        content,
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

    const systemPrompt = this.buildSystemPrompt(problem);
    const chatMessages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [{ role: "system", content: systemPrompt }];

    for (const msg of dbMessages) {
      chatMessages.push({
        role: msg.role === "student" ? "user" : "assistant",
        content: msg.content,
      });
    }

    // Stream from OpenAI
    const stream = await this.getClient().chat.completions.create({
      model: "gpt-5.4",
      temperature: 0.7,
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
    if (fullResponse) {
      await this.prisma.tutorMessage.create({
        data: {
          sessionId,
          role: "tutor",
          content: fullResponse,
        },
      });
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
