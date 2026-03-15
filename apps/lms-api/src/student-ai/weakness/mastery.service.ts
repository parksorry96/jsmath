import { Injectable } from "@nestjs/common";
import { MasteryState } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

const MASTERY_THRESHOLD = 3;

@Injectable()
export class MasteryService {
  constructor(private prisma: PrismaService) {}

  async updateOnAnswer(
    studentId: string,
    problemId: string,
    isCorrect: boolean,
  ) {
    const problem = await this.prisma.problem.findUnique({
      where: { id: problemId },
      select: { curriculumNodeId: true },
    });

    if (!problem?.curriculumNodeId) {
      return;
    }

    const nodeId = problem.curriculumNodeId;

    const current = await this.prisma.studentMastery.findUnique({
      where: { studentId_curriculumNodeId: { studentId, curriculumNodeId: nodeId } },
    });

    const prevConsecutiveCorrect = current?.consecutiveCorrect ?? 0;
    const prevState: MasteryState = current?.state ?? "not_started";

    const newConsecutiveCorrect = isCorrect ? prevConsecutiveCorrect + 1 : 0;
    const newTotalAttempts = (current?.totalAttempts ?? 0) + 1;
    const newTotalCorrect = (current?.totalCorrect ?? 0) + (isCorrect ? 1 : 0);

    const newState = this.computeState(
      newTotalAttempts,
      newConsecutiveCorrect,
    );

    const masteredAt =
      newState === "mastered" && prevState !== "mastered"
        ? new Date()
        : (current?.masteredAt ?? null);

    await this.prisma.studentMastery.upsert({
      where: { studentId_curriculumNodeId: { studentId, curriculumNodeId: nodeId } },
      create: {
        studentId,
        curriculumNodeId: nodeId,
        state: newState,
        consecutiveCorrect: newConsecutiveCorrect,
        totalAttempts: newTotalAttempts,
        totalCorrect: newTotalCorrect,
        lastAttemptAt: new Date(),
        masteredAt,
      },
      update: {
        state: newState,
        consecutiveCorrect: newConsecutiveCorrect,
        totalAttempts: newTotalAttempts,
        totalCorrect: newTotalCorrect,
        lastAttemptAt: new Date(),
        masteredAt,
      },
    });
  }

  private computeState(
    totalAttempts: number,
    consecutiveCorrect: number,
  ): MasteryState {
    if (consecutiveCorrect >= MASTERY_THRESHOLD) {
      return "mastered";
    }

    if (totalAttempts >= 3) {
      return "practicing";
    }

    if (totalAttempts >= 1) {
      return "learning";
    }

    return "not_started";
  }

  async getByStudent(studentId: string) {
    return this.prisma.studentMastery.findMany({
      where: { studentId },
      orderBy: { updatedAt: "desc" },
    });
  }

  async getByNode(studentId: string, curriculumNodeId: string) {
    return this.prisma.studentMastery.findUnique({
      where: { studentId_curriculumNodeId: { studentId, curriculumNodeId } },
    });
  }

  async getDashboard(studentId: string) {
    const records = await this.prisma.studentMastery.findMany({
      where: { studentId },
      select: { state: true },
    });

    const totalTracked = records.length;
    const mastered = records.filter((r) => r.state === "mastered").length;
    const practicing = records.filter((r) => r.state === "practicing").length;
    const learning = records.filter((r) => r.state === "learning").length;

    // Total curriculum nodes for progress denominator
    const totalNodes = await this.prisma.curriculumNode.count();

    const progressPct =
      totalNodes > 0
        ? Math.round((mastered / totalNodes) * 100)
        : 0;
    const notStarted = totalNodes - totalTracked;

    return {
      totalNodes,
      totalTracked,
      mastered,
      practicing,
      learning,
      notStarted,
      progressPct,
      total: totalNodes,
      masteredCount: mastered,
      practicingCount: practicing,
      learningCount: learning,
      notStartedCount: notStarted,
      progressPercent: progressPct,
    };
  }

  async getTreeWithMastery(studentId: string, year?: number) {
    const curriculumYear = year ?? 2015;

    const [nodes, masteries] = await Promise.all([
      this.prisma.curriculumNode.findMany({
        where: { curriculumYear },
        orderBy: [{ level: "asc" }, { sortOrder: "asc" }],
      }),
      this.prisma.studentMastery.findMany({
        where: { studentId },
        select: {
          curriculumNodeId: true,
          state: true,
          consecutiveCorrect: true,
          totalAttempts: true,
          totalCorrect: true,
          lastAttemptAt: true,
          masteredAt: true,
        },
      }),
    ]);

    const masteryMap = new Map(
      masteries.map((m) => [m.curriculumNodeId, m]),
    );

    const map = new Map(
      nodes.map((n) => [
        n.id,
        {
          ...n,
          mastery: masteryMap.get(n.id) ?? null,
          children: [] as any[],
        },
      ]),
    );

    const roots: any[] = [];
    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}
