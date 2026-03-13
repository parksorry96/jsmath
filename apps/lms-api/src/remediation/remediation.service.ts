import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EmbeddingService } from "../problems/embedding.service";

interface SimilarProblemRow {
  id: string;
  stemText: string;
  stemLatex: string;
  difficulty: number | null;
  subject: string | null;
  unitMajor: string | null;
  similarity: number;
}

interface WeakArea {
  curriculumNodeId: string;
  wrongAnswerCount: number;
  representativeProblemId: string;
  representativeStemText: string;
}

@Injectable()
export class RemediationService {
  private readonly logger = new Logger(RemediationService.name);

  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
  ) {}

  async getSuggestionsForStudent(studentId: string) {
    const weakAreas = await this.getWeakAreas(studentId);
    return {
      weakAreas: weakAreas.map((area) => ({
        curriculumNodeId: area.curriculumNodeId,
        wrongAnswerCount: area.wrongAnswerCount,
        suggestedProblemCount: 5,
      })),
    };
  }

  async generateForStudent(
    studentId: string,
    options?: { maxProblems?: number; sourceAssignmentId?: string },
  ) {
    const maxProblems = options?.maxProblems ?? 5;
    const sourceAssignmentId = options?.sourceAssignmentId;

    const weakAreas = await this.getWeakAreas(studentId);
    if (weakAreas.length === 0) {
      return null;
    }

    const answeredProblemIds = await this.getAnsweredProblemIds(studentId);

    const selectedProblemIds: string[] = [];
    for (const area of weakAreas) {
      const similar = await this.findSimilarProblems(
        area.representativeProblemId,
        area.curriculumNodeId,
        answeredProblemIds,
        maxProblems,
      );
      for (const p of similar) {
        if (!selectedProblemIds.includes(p.id)) {
          selectedProblemIds.push(p.id);
        }
      }
    }

    if (selectedProblemIds.length === 0) {
      return null;
    }

    // Remediation assignments are not tied to a class in the current schema,
    // so we reuse the student's most recent class enrollment for classId.
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { userId: studentId },
      orderBy: { createdAt: "desc" },
      select: { classId: true },
    });

    if (!enrollment) {
      return null;
    }

    const assignment = await this.prisma.assignment.create({
      data: {
        title: `Remediation Assignment — ${new Date().toLocaleDateString("ko-KR")}`,
        classId: enrollment.classId,
        type: "remediation",
        maxScore: selectedProblemIds.length * 10,
        ...(sourceAssignmentId ? { sourceAssignmentId } : {}),
      },
    });

    await this.prisma.assignmentProblem.createMany({
      data: selectedProblemIds.map((problemId, index) => ({
        assignmentId: assignment.id,
        problemId,
        orderIndex: index,
      })),
      skipDuplicates: true,
    });

    return this.prisma.assignment.findUnique({
      where: { id: assignment.id },
      include: {
        assignmentProblems: {
          orderBy: { orderIndex: "asc" },
          select: { id: true, orderIndex: true, problemId: true },
        },
      },
    });
  }

  private async getWeakAreas(studentId: string): Promise<WeakArea[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const wrongAnswers = await this.prisma.wrongAnswer.findMany({
      where: {
        studentId,
        resolvedAt: null,
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { problemId: true },
    });

    if (wrongAnswers.length === 0) return [];

    const problemIds = wrongAnswers.map((w) => w.problemId);

    const problems = await this.prisma.$queryRawUnsafe<
      { id: string; curriculum_node_id: string | null; stem_text: string }[]
    >(
      `SELECT id, curriculum_node_id, stem_text FROM ocr.problems WHERE id = ANY($1::text[])`,
      problemIds,
    );

    // Group by curriculumNodeId
    const grouped = new Map<
      string,
      { count: number; problemId: string; stemText: string }
    >();

    for (const problem of problems) {
      const nodeId = problem.curriculum_node_id ?? "unknown";
      const existing = grouped.get(nodeId);
      if (existing) {
        existing.count++;
      } else {
        grouped.set(nodeId, {
          count: 1,
          problemId: problem.id,
          stemText: problem.stem_text,
        });
      }
    }

    return Array.from(grouped.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .filter(([nodeId]) => nodeId !== "unknown")
      .map(([nodeId, data]) => ({
        curriculumNodeId: nodeId,
        wrongAnswerCount: data.count,
        representativeProblemId: data.problemId,
        representativeStemText: data.stemText,
      }));
  }

  private async getAnsweredProblemIds(studentId: string): Promise<string[]> {
    const answers = await this.prisma.submissionAnswer.findMany({
      where: { submission: { studentId } },
      select: { problemId: true },
      distinct: ["problemId"],
    });
    return answers.map((a) => a.problemId);
  }

  private async findSimilarProblems(
    representativeProblemId: string,
    curriculumNodeId: string,
    excludeIds: string[],
    limit: number,
  ): Promise<SimilarProblemRow[]> {
    // Fetch the representative problem's embedding
    const rows = await this.prisma.$queryRawUnsafe<
      { embedding: string | null; stem_text: string }[]
    >(
      `SELECT embedding::text, stem_text FROM ocr.problems WHERE id = $1`,
      representativeProblemId,
    );

    if (rows.length === 0) return [];

    let vectorStr: string;

    if (rows[0].embedding) {
      vectorStr = rows[0].embedding;
    } else {
      // Fall back to generating embedding from stem text
      try {
        const embedding = await this.embeddingService.embed(rows[0].stem_text);
        vectorStr = `[${embedding.join(",")}]`;
      } catch (err) {
        this.logger.warn(
          `Failed to generate embedding for problem ${representativeProblemId}: ${err}`,
        );
        return [];
      }
    }

    const excludeClause =
      excludeIds.length > 0
        ? `AND p.id <> ALL(ARRAY[${excludeIds.map((id) => `'${id}'`).join(",")}]::text[])`
        : "";

    const sql = `
      SELECT p.id,
             p.stem_text AS "stemText",
             p.stem_latex AS "stemLatex",
             p.difficulty,
             p.subject,
             p.unit_major AS "unitMajor",
             1 - (p.embedding <=> '${vectorStr}'::vector) AS similarity
      FROM ocr.problems p
      WHERE p.curriculum_node_id = $1::uuid
        AND p.embedding IS NOT NULL
        AND p.review_status IN ('approved', 'auto_approved')
        AND p.id <> $2
        ${excludeClause}
      ORDER BY p.embedding <=> '${vectorStr}'::vector
      LIMIT ${limit}
    `;

    return this.prisma.$queryRawUnsafe<SimilarProblemRow[]>(
      sql,
      curriculumNodeId,
      representativeProblemId,
    );
  }
}
