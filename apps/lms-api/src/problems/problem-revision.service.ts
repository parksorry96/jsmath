import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RevisionChangeType } from "@prisma/client";

const CONTENT_FIELDS = new Set([
  "stemLatex",
  "stemText",
  "answerText",
  "answerLatex",
  "solutionText",
  "solutionLatex",
]);

const REVIEW_FIELDS = new Set(["reviewStatus", "reviewedBy"]);

@Injectable()
export class ProblemRevisionService {
  constructor(private prisma: PrismaService) {}

  async saveRevisionAndUpdate(
    problemId: string,
    updateData: Record<string, unknown>,
    changedById: string,
    changedByRole: string,
  ) {
    const current = await this.prisma.problem.findUnique({
      where: { id: problemId },
    });
    if (!current) throw new NotFoundException("Problem not found");

    const changedFields = Object.keys(updateData).filter(
      (key) =>
        JSON.stringify((current as Record<string, unknown>)[key]) !==
        JSON.stringify(updateData[key]),
    );

    if (changedFields.length === 0) {
      return current;
    }

    const changeType = this.classifyChangeType(changedFields);

    const latest = await this.prisma.problemRevision.findFirst({
      where: { problemId },
      orderBy: { revisionNumber: "desc" },
      select: { revisionNumber: true },
    });
    const nextRevision = (latest?.revisionNumber ?? 0) + 1;

    const snapshot = JSON.parse(JSON.stringify(current));

    const [, updated] = await this.prisma.$transaction([
      this.prisma.problemRevision.create({
        data: {
          problemId,
          revisionNumber: nextRevision,
          snapshot,
          changeType,
          changedFields,
          changeSummary: `Changed: ${changedFields.join(", ")}`,
          changedById,
          changedByRole,
          changeSource: "manual",
        },
      }),
      this.prisma.problem.update({
        where: { id: problemId },
        data: updateData,
      }),
    ]);

    return updated;
  }

  async getRevisions(problemId: string, take = 50) {
    return this.prisma.problemRevision.findMany({
      where: { problemId },
      orderBy: { revisionNumber: "desc" },
      take: Math.min(take, 200),
    });
  }

  async getRevision(problemId: string, revisionId: string) {
    const revision = await this.prisma.problemRevision.findFirst({
      where: { id: revisionId, problemId },
    });
    if (!revision) throw new NotFoundException("Revision not found");
    return revision;
  }

  async restoreRevision(
    problemId: string,
    revisionId: string,
    userId: string,
    userRole: string,
  ) {
    const revision = await this.prisma.problemRevision.findFirst({
      where: { id: revisionId, problemId },
    });
    if (!revision) throw new NotFoundException("Revision not found");

    const snapshot = revision.snapshot as Record<string, unknown>;

    // Extract restorable fields from snapshot
    const restoreData: Record<string, unknown> = {};
    const restorableKeys = [
      "stemLatex",
      "stemText",
      "answerText",
      "answerLatex",
      "solutionText",
      "solutionLatex",
      "problemType",
      "gradeLevel",
      "subject",
      "unitMajor",
      "unitMinor",
      "difficulty",
      "reviewStatus",
    ];
    for (const key of restorableKeys) {
      if (key in snapshot) {
        restoreData[key] = snapshot[key];
      }
    }

    // Fetch current state for snapshot before restore
    const current = await this.prisma.problem.findUnique({
      where: { id: problemId },
    });
    if (!current) throw new NotFoundException("Problem not found");

    const latest = await this.prisma.problemRevision.findFirst({
      where: { problemId },
      orderBy: { revisionNumber: "desc" },
      select: { revisionNumber: true },
    });
    const nextRevision = (latest?.revisionNumber ?? 0) + 1;

    const [, updated] = await this.prisma.$transaction([
      this.prisma.problemRevision.create({
        data: {
          problemId,
          revisionNumber: nextRevision,
          snapshot: JSON.parse(JSON.stringify(current)),
          changeType: RevisionChangeType.content_edit,
          changedFields: Object.keys(restoreData),
          changeSummary: `Restored from revision #${revision.revisionNumber}`,
          changedById: userId,
          changedByRole: userRole,
          changeSource: "restore",
        },
      }),
      this.prisma.problem.update({
        where: { id: problemId },
        data: restoreData,
      }),
    ]);

    return updated;
  }

  private classifyChangeType(changedFields: string[]): RevisionChangeType {
    if (changedFields.some((f) => REVIEW_FIELDS.has(f))) {
      return RevisionChangeType.review_action;
    }
    if (changedFields.some((f) => CONTENT_FIELDS.has(f))) {
      return RevisionChangeType.content_edit;
    }
    return RevisionChangeType.metadata_edit;
  }
}
