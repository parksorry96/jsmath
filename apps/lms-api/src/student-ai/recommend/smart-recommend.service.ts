import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { canAccessAssignment } from "../../common/access-control";

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

interface AssignmentSeed {
  classId: string;
  studentId: string;
  title: string;
  description: string;
  problemIds: string[];
  sourceAssignmentId?: string;
}

const DEFAULT_MAX_PROBLEMS = 5;
const MAX_REMEDIATION_PROBLEMS = 10;
const MIN_SIMILARITY = 0.6;
const REMEDIATION_AMBIGUOUS_ASSIGNMENT_MESSAGE =
  "studentId is required when generating remediation from a class-wide assignment with multiple graded submissions";

@Injectable()
export class SmartRecommendService {
  constructor(private prisma: PrismaService) {}

  async getSuggestionsForStudent(studentId: string) {
    const weakAreas = await this.getWeakAreas(studentId);
    return {
      weakAreas: weakAreas.map((area) => ({
        curriculumNodeId: area.curriculumNodeId,
        wrongAnswerCount: area.wrongAnswerCount,
        suggestedProblemCount: DEFAULT_MAX_PROBLEMS,
      })),
    };
  }

  async generateForStudent(
    studentId: string,
    options?: { maxProblems?: number; sourceAssignmentId?: string },
  ) {
    const maxProblems = this.normalizeMaxProblems(options?.maxProblems);
    const sourceAssignmentId = options?.sourceAssignmentId;

    let sourceAssignment:
      | { id: string; title: string; classId: string }
      | null = null;
    let sourceWrongProblemIds: string[] | null = null;

    if (sourceAssignmentId) {
      const allowed = await canAccessAssignment(
        this.prisma,
        studentId,
        "student",
        sourceAssignmentId,
      );
      if (!allowed) {
        throw new ForbiddenException("Not authorized to access this assignment");
      }

      sourceAssignment = await this.prisma.assignment.findUnique({
        where: { id: sourceAssignmentId },
        select: { id: true, title: true, classId: true },
      });
      if (!sourceAssignment) {
        throw new NotFoundException("Assignment not found");
      }

      const submission = await this.prisma.submission.findFirst({
        where: {
          assignmentId: sourceAssignmentId,
          studentId,
          status: { in: ["graded", "returned"] },
        },
        orderBy: [{ gradedAt: "desc" }, { submittedAt: "desc" }],
        select: {
          answers: {
            select: {
              problemId: true,
              isCorrect: true,
            },
          },
        },
      });

      if (!submission) {
        throw new BadRequestException("No graded submission found");
      }

      sourceWrongProblemIds = submission.answers
        .filter((answer) => answer.isCorrect === false)
        .map((answer) => answer.problemId);

      if (sourceWrongProblemIds.length === 0) {
        throw new BadRequestException("No wrong answers to remediate");
      }
    }

    const answeredProblemIds = await this.getAnsweredProblemIds(studentId);
    const selectedProblemIds = sourceWrongProblemIds
      ? await this.selectProblemsForProblemIds(
          sourceWrongProblemIds,
          answeredProblemIds,
          maxProblems,
        )
      : await (async () => {
          const weakAreas = await this.getWeakAreas(studentId);
          if (weakAreas.length === 0) {
            return [];
          }

          return this.selectProblemsForWeakAreas(
            weakAreas,
            answeredProblemIds,
            maxProblems,
          );
        })();

    if (selectedProblemIds.length === 0) {
      return null;
    }

    const classId =
      sourceAssignment?.classId ?? (await this.getLatestEnrolledClassId(studentId));
    if (!classId) {
      return null;
    }

    return this.createRemediationAssignment({
      classId,
      studentId,
      title: sourceAssignment
        ? `[보충] ${sourceAssignment.title}`
        : `Remediation Assignment — ${new Date().toLocaleDateString("ko-KR")}`,
      description: sourceAssignment
        ? `"${sourceAssignment.title}" 오답 기반 자동 생성 보충 과제`
        : "최근 오답 기반 자동 생성 보충 과제",
      sourceAssignmentId: sourceAssignment?.id,
      problemIds: selectedProblemIds,
    });
  }

  async generateForAssignment(
    assignmentId: string,
    requesterId: string,
    requesterRole: string,
    options?: { studentId?: string; maxProblems?: number },
  ) {
    const allowed = await canAccessAssignment(
      this.prisma,
      requesterId,
      requesterRole,
      assignmentId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this assignment");
    }

    const maxProblems = this.normalizeMaxProblems(options?.maxProblems);
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        title: true,
        classId: true,
        targetStudentId: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException("Assignment not found");
    }

    if (
      assignment.targetStudentId &&
      options?.studentId &&
      assignment.targetStudentId !== options.studentId
    ) {
      throw new BadRequestException(
        "studentId does not match this targeted assignment",
      );
    }

    const studentId =
      options?.studentId ??
      assignment.targetStudentId ??
      (await this.resolveSingleSubmissionStudentId(assignmentId));

    const submission = await this.prisma.submission.findFirst({
      where: {
        assignmentId,
        studentId,
        status: { in: ["graded", "returned"] },
      },
      orderBy: [{ gradedAt: "desc" }, { submittedAt: "desc" }],
      select: {
        id: true,
        studentId: true,
        answers: {
          select: {
            problemId: true,
            isCorrect: true,
          },
        },
      },
    });

    if (!submission) {
      throw new BadRequestException("No graded submission found");
    }

    const wrongProblemIds = submission.answers
      .filter((answer) => answer.isCorrect === false)
      .map((answer) => answer.problemId);

    if (wrongProblemIds.length === 0) {
      throw new BadRequestException("No wrong answers to remediate");
    }

    const answeredProblemIds = await this.getAnsweredProblemIds(submission.studentId);
    const selectedProblemIds = await this.selectProblemsForProblemIds(
      wrongProblemIds,
      answeredProblemIds,
      maxProblems,
    );

    if (selectedProblemIds.length === 0) {
      throw new BadRequestException(
        "No similar problems found for remediation. Run similarity analysis first.",
      );
    }

    return this.createRemediationAssignment({
      classId: assignment.classId,
      studentId: submission.studentId,
      title: `[보충] ${assignment.title}`,
      description: `"${assignment.title}" 오답 기반 자동 생성 보충 과제`,
      sourceAssignmentId: assignment.id,
      problemIds: selectedProblemIds,
    });
  }

  private normalizeMaxProblems(input?: number) {
    const requested =
      typeof input === "number" && Number.isFinite(input)
        ? Math.trunc(input)
        : DEFAULT_MAX_PROBLEMS;
    return Math.min(Math.max(requested, 1), MAX_REMEDIATION_PROBLEMS);
  }

  private async resolveSingleSubmissionStudentId(assignmentId: string) {
    const submissions = await this.prisma.submission.findMany({
      where: {
        assignmentId,
        status: { in: ["graded", "returned"] },
      },
      orderBy: [{ gradedAt: "desc" }, { submittedAt: "desc" }],
      take: 2,
      select: { studentId: true },
    });

    if (submissions.length === 0) {
      throw new BadRequestException("No graded submission found");
    }

    if (submissions.length > 1) {
      throw new BadRequestException(REMEDIATION_AMBIGUOUS_ASSIGNMENT_MESSAGE);
    }

    return submissions[0].studentId;
  }

  private async createRemediationAssignment(seed: AssignmentSeed) {
    const assignment = await this.prisma.assignment.create({
      data: {
        title: seed.title,
        description: seed.description,
        classId: seed.classId,
        type: "remediation",
        maxScore: seed.problemIds.length * 10,
        targetStudentId: seed.studentId,
        ...(seed.sourceAssignmentId
          ? { sourceAssignmentId: seed.sourceAssignmentId }
          : {}),
      },
    });

    await this.prisma.assignmentProblem.createMany({
      data: seed.problemIds.map((problemId, index) => ({
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

  private async getLatestEnrolledClassId(studentId: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { userId: studentId },
      orderBy: { createdAt: "desc" },
      select: { classId: true },
    });

    return enrollment?.classId ?? null;
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

    if (wrongAnswers.length === 0) {
      return [];
    }

    const problems = await this.prisma.problem.findMany({
      where: {
        id: { in: wrongAnswers.map((wrongAnswer) => wrongAnswer.problemId) },
      },
      select: {
        id: true,
        curriculumNodeId: true,
        stemText: true,
      },
    });

    const problemMap = new Map(problems.map((problem) => [problem.id, problem]));
    const grouped = new Map<
      string,
      { count: number; problemId: string; stemText: string }
    >();

    for (const wrongAnswer of wrongAnswers) {
      const problem = problemMap.get(wrongAnswer.problemId);
      if (!problem?.curriculumNodeId) {
        continue;
      }

      const existing = grouped.get(problem.curriculumNodeId);
      if (existing) {
        existing.count += 1;
      } else {
        grouped.set(problem.curriculumNodeId, {
          count: 1,
          problemId: problem.id,
          stemText: problem.stemText,
        });
      }
    }

    return Array.from(grouped.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([curriculumNodeId, data]) => ({
        curriculumNodeId,
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
    return answers.map((answer) => answer.problemId);
  }

  private async selectProblemsForWeakAreas(
    weakAreas: WeakArea[],
    answeredProblemIds: string[],
    maxProblems: number,
  ) {
    const selected = new Set<string>();
    const excludeIds = new Set(answeredProblemIds);

    for (const area of weakAreas) {
      if (selected.size >= maxProblems) {
        break;
      }

      const similarProblems = await this.findSimilarProblems(
        area.representativeProblemId,
        area.curriculumNodeId,
        [...excludeIds, ...selected],
        maxProblems - selected.size,
      );

      for (const problem of similarProblems) {
        if (selected.size >= maxProblems) {
          break;
        }
        selected.add(problem.id);
      }
    }

    return [...selected];
  }

  private async selectProblemsForProblemIds(
    problemIds: string[],
    answeredProblemIds: string[],
    maxProblems: number,
  ) {
    const wrongProblems = await this.prisma.problem.findMany({
      where: { id: { in: problemIds } },
      select: { id: true, curriculumNodeId: true },
    });

    const selected = new Set<string>();
    const excludeIds = new Set([...answeredProblemIds, ...problemIds]);

    for (const wrongProblem of wrongProblems) {
      if (selected.size >= maxProblems || !wrongProblem.curriculumNodeId) {
        continue;
      }

      const similarProblems = await this.findSimilarProblems(
        wrongProblem.id,
        wrongProblem.curriculumNodeId,
        [...excludeIds, ...selected],
        maxProblems - selected.size,
      );

      for (const problem of similarProblems) {
        if (selected.size >= maxProblems) {
          break;
        }
        selected.add(problem.id);
      }
    }

    return [...selected];
  }

  private async findSimilarProblems(
    representativeProblemId: string,
    curriculumNodeId: string,
    excludeIds: string[],
    limit: number,
  ): Promise<SimilarProblemRow[]> {
    if (limit <= 0) {
      return [];
    }

    const similarities = await this.prisma.problemSimilarity.findMany({
      where: {
        problemId: representativeProblemId,
        similarityScore: { gte: MIN_SIMILARITY },
        similarProblemId: {
          notIn: excludeIds,
        },
      },
      orderBy: { similarityScore: "desc" },
      take: limit * 5,
      select: {
        similarProblemId: true,
        similarityScore: true,
      },
    });

    if (similarities.length === 0) {
      return [];
    }

    const candidateProblemIds = similarities.map(
      (similarity) => similarity.similarProblemId,
    );
    const candidateProblems = await this.prisma.problem.findMany({
      where: {
        id: { in: candidateProblemIds },
        curriculumNodeId,
        reviewStatus: { in: ["approved", "auto_approved"] },
      },
      select: {
        id: true,
        stemText: true,
        stemLatex: true,
        difficulty: true,
        subject: true,
        unitMajor: true,
      },
    });

    const candidateMap = new Map(
      candidateProblems.map((problem) => [problem.id, problem]),
    );

    const ordered: SimilarProblemRow[] = [];
    for (const similarity of similarities) {
      const problem = candidateMap.get(similarity.similarProblemId);
      if (!problem) {
        continue;
      }

      ordered.push({
        ...problem,
        similarity: similarity.similarityScore,
      });

      if (ordered.length >= limit) {
        break;
      }
    }

    return ordered;
  }
}
