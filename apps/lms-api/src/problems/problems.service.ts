import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ReviewStatus, OcrJobStatus } from "@prisma/client";
import { UpdateProblemDto } from "./dto/update-problem.dto";

export interface ProblemsQuery {
  ocrJobId?: string;
  reviewStatus?: ReviewStatus;
  gradeLevel?: string;
  subject?: string;
  unitMajor?: string;
  difficulty?: string;
  problemType?: string;
  analysisStatus?: string;
  q?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class ProblemsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: ProblemsQuery) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (query.ocrJobId) where.ocrJobId = query.ocrJobId;
    if (query.reviewStatus) where.reviewStatus = query.reviewStatus;
    if (query.gradeLevel) where.gradeLevel = query.gradeLevel;
    if (query.subject) where.subject = query.subject;
    if (query.unitMajor) where.unitMajor = query.unitMajor;
    if (query.problemType) where.problemType = query.problemType;
    if (query.analysisStatus) where.analysisStatus = query.analysisStatus;
    if (query.difficulty !== undefined) {
      const parsed = parseInt(query.difficulty, 10);
      if (!isNaN(parsed)) where.difficulty = parsed;
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
          ocrJobId: true,
          startPage: true,
          endPage: true,
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
        sourceFile: item.ocrJob?.sourceFile?.filename ?? null,
        ocrJob: undefined,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getStats() {
    const [totalJobs, completedJobs, failedJobs, totalProblems, pendingReview, approved, rejected] =
      await Promise.all([
        this.prisma.ocrJob.count(),
        this.prisma.ocrJob.count({ where: { status: OcrJobStatus.completed } }),
        this.prisma.ocrJob.count({ where: { status: OcrJobStatus.failed } }),
        this.prisma.problem.count(),
        this.prisma.problem.count({ where: { reviewStatus: ReviewStatus.pending_review } }),
        this.prisma.problem.count({ where: { reviewStatus: ReviewStatus.approved } }),
        this.prisma.problem.count({ where: { reviewStatus: ReviewStatus.rejected } }),
      ]);

    const ocrSuccessRate = totalJobs > 0 ? completedJobs / totalJobs : null;

    return {
      ocr: { totalJobs, completedJobs, failedJobs, successRate: ocrSuccessRate },
      problems: { total: totalProblems, pendingReview, approved, rejected },
    };
  }

  async update(id: string, dto: UpdateProblemDto) {
    const problem = await this.prisma.problem.findUnique({ where: { id } });
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

  async triggerAnalysis(ocrJobId: string, problemIds?: string[]) {
    if (!problemIds || problemIds.length === 0) {
      const problems = await this.prisma.problem.findMany({
        where: { ocrJobId },
        select: { id: true },
      });
      problemIds = problems.map((p) => p.id);
    }

    if (problemIds.length === 0) {
      throw new NotFoundException("No problems found for this OCR job");
    }

    await this.prisma.problem.updateMany({
      where: { id: { in: problemIds } },
      data: { analysisStatus: "analyzing" },
    });

    const redis = this.getRedisClient();
    await redis.publish(
      "analysis:request",
      JSON.stringify({ ocrJobId, problemIds }),
    );
    redis.disconnect();

    return {
      ocrJobId,
      problemCount: problemIds.length,
      status: "analyzing",
    };
  }

  async getAnalysis(problemId: string) {
    const problem = await this.prisma.problem.findUnique({
      where: { id: problemId },
      select: {
        id: true,
        stemLatex: true,
        stemText: true,
        subject: true,
        unitMajor: true,
        unitMinor: true,
        difficulty: true,
        difficultyRefined: true,
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
        reviewStatus: true,
      },
    });
    if (!problem) throw new NotFoundException("Problem not found");
    return problem;
  }

  async review(id: string, action: "approved" | "rejected", reviewerId: string) {
    const problem = await this.prisma.problem.findUnique({ where: { id } });
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

  private getRedisClient() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require("ioredis");
    return new Redis(process.env.REDIS_URL || "redis://localhost:6379");
  }
}
