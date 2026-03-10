import {
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { ReviewStatus, OcrJobStatus } from "@prisma/client";
import { UpdateProblemDto } from "./dto/update-problem.dto";
import { Redis } from "ioredis";
import { normalizeFilename } from "../common/filename";
import { TwinProblemService } from "./twin-problem.service";
import { EmbeddingService } from "./embedding.service";

export interface ProblemsQuery {
  requesterId: string;
  requesterRole: string;
  ocrJobId?: string;
  reviewStatus?: ReviewStatus;
  gradeLevel?: string;
  subject?: string;
  unitMajor?: string;
  difficulty?: string;
  problemType?: string;
  analysisStatus?: string;
  bookTitle?: string;
  q?: string;
  solutionTag?: string;
  examYear?: string;
  examMonth?: string;
  examType?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class ProblemsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProblemsService.name);
  private redisPublisher: Redis;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private twinProblemService: TwinProblemService,
    private embeddingService: EmbeddingService,
  ) {}

  onModuleInit() {
    const redisUrl = this.config.getOrThrow<string>("REDIS_URL");
    this.redisPublisher = new Redis(redisUrl);
  }

  async onModuleDestroy() {
    await this.redisPublisher.quit();
  }

  private getProblemScopeWhere(requesterId: string, requesterRole: string) {
    if (requesterRole === "admin") {
      return {};
    }

    return {
      ocrJob: {
        sourceFile: {
          uploaderId: requesterId,
        },
      },
    };
  }

  private getOcrJobScopeWhere(requesterId: string, requesterRole: string) {
    if (requesterRole === "admin") {
      return {};
    }

    return {
      sourceFile: {
        uploaderId: requesterId,
      },
    };
  }

  async getFilterOptions(requesterId: string, requesterRole: string) {
    const where = this.getProblemScopeWhere(requesterId, requesterRole);

    const [subjects, gradeLevels, textbooks, difficulties, problemTypes, examYearsRaw, examTypesRaw, solutionTagsRaw] = await Promise.all([
      this.prisma.problem.findMany({
        where: { ...where, subject: { not: null } },
        select: { subject: true },
        distinct: ["subject"],
        orderBy: { subject: "asc" },
      }),
      this.prisma.problem.findMany({
        where: { ...where, gradeLevel: { not: null } },
        select: { gradeLevel: true },
        distinct: ["gradeLevel"],
        orderBy: { gradeLevel: "asc" },
      }),
      this.prisma.problem.findMany({
        where: { ...where, sourceFileId: { not: null } },
        select: {
          sourceFileId: true,
          ocrJob: {
            select: {
              sourceFile: { select: { filename: true, bookTitle: true } },
            },
          },
        },
        distinct: ["sourceFileId"],
      }),
      this.prisma.problem.findMany({
        where: { ...where, difficulty: { not: null } },
        select: { difficulty: true },
        distinct: ["difficulty"],
        orderBy: { difficulty: "asc" },
      }),
      this.prisma.problem.findMany({
        where,
        select: { problemType: true },
        distinct: ["problemType"],
      }),
      this.prisma.$queryRaw<{ year: number }[]>`
        SELECT DISTINCT (exam_source->>'year')::int as year
        FROM ocr.problems
        WHERE exam_source IS NOT NULL AND exam_source->>'year' IS NOT NULL
        ORDER BY year DESC
      `,
      this.prisma.$queryRaw<{ type: string }[]>`
        SELECT DISTINCT exam_source->>'type' as type
        FROM ocr.problems
        WHERE exam_source IS NOT NULL AND exam_source->>'type' IS NOT NULL
        ORDER BY type
      `,
      this.prisma.$queryRaw<{ tag: string }[]>`
        SELECT DISTINCT jsonb_array_elements_text(solution_tags) as tag
        FROM ocr.problems
        WHERE solution_tags IS NOT NULL
        ORDER BY tag
      `,
    ]);

    return {
      subjects: subjects.map((s) => s.subject).filter(Boolean),
      gradeLevels: gradeLevels.map((g) => g.gradeLevel).filter(Boolean),
      textbooks: textbooks
        .map((t) => ({
          filename: normalizeFilename(t.ocrJob?.sourceFile?.filename) ?? null,
          bookTitle: t.ocrJob?.sourceFile?.bookTitle ?? null,
        }))
        .filter((t) => t.filename),
      difficulties: difficulties.map((d) => d.difficulty).filter((d): d is number => d !== null),
      problemTypes: problemTypes.map((p) => p.problemType),
      examYears: examYearsRaw.map((r) => r.year),
      examTypes: examTypesRaw.map((r) => r.type),
      solutionTags: solutionTagsRaw.map((r) => r.tag),
    };
  }

  async findAll(query: ProblemsQuery) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      ...this.getProblemScopeWhere(query.requesterId, query.requesterRole),
    };

    if (query.ocrJobId) where.ocrJobId = query.ocrJobId;
    if (query.reviewStatus) where.reviewStatus = query.reviewStatus;
    if (query.gradeLevel) where.gradeLevel = query.gradeLevel;
    if (query.subject) where.subject = query.subject;
    if (query.unitMajor) where.unitMajor = query.unitMajor;
    if (query.problemType) where.problemType = query.problemType;
    if (query.analysisStatus) where.analysisStatus = query.analysisStatus;
    if (query.bookTitle) {
      where.bookSource = { path: ["title"], string_contains: query.bookTitle };
    }
    if (query.solutionTag) {
      where.solutionTags = { array_contains: [query.solutionTag] };
    }
    if (query.difficulty !== undefined) {
      const parsed = parseInt(query.difficulty, 10);
      if (!isNaN(parsed)) where.difficulty = parsed;
    }

    // Exam source JSON filters — use AND for multiple path conditions on same field
    const examSourceFilters: Record<string, unknown>[] = [];
    if (query.examYear) {
      examSourceFilters.push({
        examSource: { path: ["year"], equals: parseInt(query.examYear, 10) },
      });
    }
    if (query.examMonth) {
      examSourceFilters.push({
        examSource: { path: ["month"], equals: parseInt(query.examMonth, 10) },
      });
    }
    if (query.examType) {
      examSourceFilters.push({
        examSource: { path: ["type"], string_contains: query.examType },
      });
    }
    if (examSourceFilters.length > 0) {
      where.AND = examSourceFilters;
    }

    // Basic ILIKE search on stemText — tsvector upgrade in Phase 3
    if (query.q) {
      where.stemText = { contains: query.q, mode: "insensitive" };
    }

    const [items, total] = await Promise.all([
      this.prisma.problem.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          stemLatex: true,
          stemText: true,
          problemNumber: true,
          displayNumber: true,
          problemType: true,
          reviewStatus: true,
          gradeLevel: true,
          subject: true,
          unitMajor: true,
          unitMinor: true,
          difficulty: true,
          classificationConfidence: true,
          solutionConfidence: true,
          reviewConfidence: true,
          solutionTags: true,
          analysisStatus: true,
          ocrJobId: true,
          startPage: true,
          endPage: true,
          bookSource: true,
          examSource: true,
          answerMatchStatus: true,
          solutionLatex: true,
          createdAt: true,
          choices: {
            select: {
              label: true,
              contentLatex: true,
              contentText: true,
              position: true,
            },
            orderBy: { position: "asc" },
          },
          assets: {
            select: {
              id: true,
              kind: true,
              subKind: true,
              s3Key: true,
              format: true,
              widthPx: true,
              heightPx: true,
            },
          },
          ocrJob: {
            select: {
              sourceFile: {
                select: { filename: true },
              },
            },
          },
        },
      }),
      this.prisma.problem.count({ where }),
    ]);

    return {
      data: items.map((item) => ({
        ...item,
        sourceFile: normalizeFilename(item.ocrJob?.sourceFile?.filename) ?? null,
        ocrJob: undefined,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async semanticSearch(query: string, filters: ProblemsQuery, limit = 20) {
    const embedding = await this.embeddingService.embed(query);
    const vectorStr = `[${embedding.join(",")}]`;

    const conditions = [
      `embedding IS NOT NULL`,
      `review_status IN ('approved', 'auto_approved')`,
    ];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.subject) {
      conditions.push(`subject = $${paramIndex++}`);
      params.push(filters.subject);
    }
    if (filters.gradeLevel) {
      conditions.push(`grade_level = $${paramIndex++}`);
      params.push(filters.gradeLevel);
    }
    if (filters.difficulty) {
      conditions.push(`difficulty = $${paramIndex++}`);
      params.push(parseInt(filters.difficulty, 10));
    }

    const whereClause = conditions.join(" AND ");
    const sql = `
      SELECT id, stem_text AS "stemText", stem_latex AS "stemLatex",
             subject, unit_major AS "unitMajor", difficulty,
             problem_type AS "problemType", grade_level AS "gradeLevel",
             display_number AS "displayNumber", problem_number AS "problemNumber",
             review_status AS "reviewStatus",
             1 - (embedding <=> '${vectorStr}'::vector) AS similarity
      FROM ocr.problems
      WHERE ${whereClause}
      ORDER BY embedding <=> '${vectorStr}'::vector
      LIMIT ${limit}
    `;

    const rows = await this.prisma.$queryRawUnsafe(sql, ...params);
    return {
      data: rows,
      total: (rows as unknown[]).length,
      page: 1,
      limit,
      totalPages: 1,
    };
  }

  async getStats(requesterId: string, requesterRole: string) {
    const ocrJobWhere = this.getOcrJobScopeWhere(requesterId, requesterRole);
    const problemWhere = this.getProblemScopeWhere(requesterId, requesterRole);
    const [totalJobs, completedJobs, failedJobs, totalProblems, pendingReview, approved, rejected] =
      await Promise.all([
        this.prisma.ocrJob.count({ where: ocrJobWhere }),
        this.prisma.ocrJob.count({
          where: { ...ocrJobWhere, status: OcrJobStatus.completed },
        }),
        this.prisma.ocrJob.count({
          where: { ...ocrJobWhere, status: OcrJobStatus.failed },
        }),
        this.prisma.problem.count({ where: problemWhere }),
        this.prisma.problem.count({
          where: {
            ...problemWhere,
            reviewStatus: ReviewStatus.pending_review,
          },
        }),
        this.prisma.problem.count({
          where: {
            ...problemWhere,
            reviewStatus: ReviewStatus.approved,
          },
        }),
        this.prisma.problem.count({
          where: {
            ...problemWhere,
            reviewStatus: ReviewStatus.rejected,
          },
        }),
      ]);

    const ocrSuccessRate = totalJobs > 0 ? completedJobs / totalJobs : null;

    return {
      ocr: { totalJobs, completedJobs, failedJobs, successRate: ocrSuccessRate },
      problems: { total: totalProblems, pendingReview, approved, rejected },
    };
  }

  async update(
    id: string,
    dto: UpdateProblemDto,
    requesterId: string,
    requesterRole: string,
  ) {
    const problem = await this.prisma.problem.findFirst({
      where: {
        id,
        ...this.getProblemScopeWhere(requesterId, requesterRole),
      },
    });
    if (!problem) throw new NotFoundException("Problem not found");

    // Build update payload from defined fields only
    const updateData: Record<string, unknown> = {};
    if (dto.stemLatex !== undefined) updateData.stemLatex = dto.stemLatex;
    if (dto.stemText !== undefined) updateData.stemText = dto.stemText;
    if (dto.problemType !== undefined) updateData.problemType = dto.problemType;
    if (dto.gradeLevel !== undefined) updateData.gradeLevel = dto.gradeLevel;
    if (dto.subject !== undefined) updateData.subject = dto.subject;
    if (dto.unitMajor !== undefined) updateData.unitMajor = dto.unitMajor;
    if (dto.unitMinor !== undefined) updateData.unitMinor = dto.unitMinor;
    if (dto.difficulty !== undefined) updateData.difficulty = dto.difficulty;

    return this.prisma.problem.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        stemLatex: true,
        stemText: true,
        problemType: true,
        gradeLevel: true,
        subject: true,
        unitMajor: true,
        unitMinor: true,
        difficulty: true,
      },
    });
  }

  async triggerAnalysis(
    ocrJobId: string,
    requesterId: string,
    requesterRole: string,
    problemIds?: string[],
  ) {
    const accessibleJob = await this.prisma.ocrJob.findFirst({
      where: {
        id: ocrJobId,
        ...this.getOcrJobScopeWhere(requesterId, requesterRole),
      },
      select: { id: true },
    });
    if (!accessibleJob) {
      throw new NotFoundException("OCR job not found");
    }

    if (!problemIds || problemIds.length === 0) {
      const problems = await this.prisma.problem.findMany({
        where: {
          ocrJobId,
          ...this.getProblemScopeWhere(requesterId, requesterRole),
        },
        select: { id: true },
      });
      problemIds = problems.map((p) => p.id);
    } else {
      const accessibleProblems = await this.prisma.problem.findMany({
        where: {
          id: { in: problemIds },
          ocrJobId,
          ...this.getProblemScopeWhere(requesterId, requesterRole),
        },
        select: { id: true },
      });
      if (accessibleProblems.length !== problemIds.length) {
        throw new NotFoundException("Problem not found");
      }
    }

    if (problemIds.length === 0) {
      throw new NotFoundException("No problems found for this OCR job");
    }

    await this.prisma.problem.updateMany({
      where: { id: { in: problemIds } },
      data: { analysisStatus: "analyzing" },
    });

    await this.redisPublisher.publish(
      "analysis:request",
      JSON.stringify({ ocrJobId, problemIds }),
    );

    return {
      ocrJobId,
      problemCount: problemIds.length,
      status: "analyzing",
    };
  }

  async getAnalysis(problemId: string, requesterId: string, requesterRole: string) {
    const problem = await this.prisma.problem.findFirst({
      where: {
        id: problemId,
        ...this.getProblemScopeWhere(requesterId, requesterRole),
      },
      select: {
        id: true,
        stemLatex: true,
        stemText: true,
        subject: true,
        unitMajor: true,
        unitMinor: true,
        difficulty: true,
        difficultyRefined: true,
        solutionTags: true,
        solutionStrategy: true,
        requiredConcepts: true,
        solutionSteps: true,
        estimatedTimeSec: true,
        commonMistakes: true,
        isCommon: true,
        pointValue: true,
        questionFormat: true,
        positionType: true,
        examSource: true,
        analysisStatus: true,
        analyzedAt: true,
        classificationConfidence: true,
        solutionConfidence: true,
        reviewConfidence: true,
        reviewStatus: true,
        answerText: true,
      },
    });
    if (!problem) throw new NotFoundException("Problem not found");
    return problem;
  }

  async generateTwinProblem(
    problemId: string,
    requesterId: string,
    requesterRole: string,
  ) {
    const problem = await this.prisma.problem.findFirst({
      where: {
        id: problemId,
        ...this.getProblemScopeWhere(requesterId, requesterRole),
      },
      select: {
        id: true,
        displayNumber: true,
        problemNumber: true,
        problemType: true,
        gradeLevel: true,
        subject: true,
        unitMajor: true,
        unitMinor: true,
        difficulty: true,
        stemText: true,
        stemLatex: true,
        answerText: true,
        answerLatex: true,
        solutionText: true,
        solutionLatex: true,
        bookSource: true,
        choices: {
          select: {
            label: true,
            position: true,
            contentText: true,
            contentLatex: true,
          },
          orderBy: { position: "asc" },
        },
      },
    });

    if (!problem) {
      throw new NotFoundException("Problem not found");
    }

    return this.twinProblemService.generate(problem);
  }

  async review(
    id: string,
    action: "approved" | "rejected",
    reviewerId: string,
    requesterRole: string,
  ) {
    const problem = await this.prisma.problem.findFirst({
      where: {
        id,
        ...this.getProblemScopeWhere(reviewerId, requesterRole),
      },
    });
    if (!problem) throw new NotFoundException("Problem not found");

    return this.prisma.problem.update({
      where: { id },
      data: {
        reviewStatus: action as ReviewStatus,
        reviewedBy: reviewerId,
      },
      select: {
        id: true,
        reviewStatus: true,
        reviewedBy: true,
      },
    });
  }
}
