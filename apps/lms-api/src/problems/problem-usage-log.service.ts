import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ProblemUsageType } from "@prisma/client";

export interface LogUsageEntry {
  problemId: string;
  usageType: ProblemUsageType;
  referenceId: string;
  referenceType: string;
  classId?: string;
  usedByUserId: string;
}

@Injectable()
export class ProblemUsageLogService {
  constructor(private prisma: PrismaService) {}

  async logUsage(entries: LogUsageEntry[]) {
    if (entries.length === 0) return;

    await this.prisma.problemUsageLog.createMany({
      data: entries,
    });
  }

  async getExcludedProblemIds(
    classId: string,
    withinDays: number,
  ): Promise<string[]> {
    const since = new Date();
    since.setDate(since.getDate() - withinDays);

    const logs = await this.prisma.problemUsageLog.findMany({
      where: {
        classId,
        usedAt: { gte: since },
      },
      select: { problemId: true },
      distinct: ["problemId"],
    });

    return logs.map((log) => log.problemId);
  }

  async getUsageHistory(problemId: string, take = 50) {
    return this.prisma.problemUsageLog.findMany({
      where: { problemId },
      orderBy: { usedAt: "desc" },
      take: Math.min(take, 200),
    });
  }
}
