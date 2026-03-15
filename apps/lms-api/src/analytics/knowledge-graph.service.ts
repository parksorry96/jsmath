import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { seedPrerequisites } from "./seed/prerequisite-data";

// --- Types ---

interface GraphNode {
  id: string;
  subject: string;
  unit: string;
  accuracy: number | null; // null = untested
  totalAttempts: number;
  totalCorrect: number;
  isWeaknessRoot: boolean;
}

interface GraphEdge {
  from: string;
  to: string;
  strength: number;
}

interface Recommendation {
  nodeId: string;
  subject: string;
  unit: string;
  reason: string;
}

export interface KnowledgeGraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  weaknessRoots: string[];
  recommendations: Recommendation[];
}

// Helpers

function nodeKey(subject: string, unit: string): string {
  return `${subject}::${unit}`;
}

@Injectable()
export class KnowledgeGraphService {
  constructor(private prisma: PrismaService) {}

  async getStudentKnowledgeGraph(
    studentId: string,
  ): Promise<KnowledgeGraphResult> {
    // 1. Fetch all prerequisite edges and build adjacency lists
    const prerequisites = await this.prisma.curriculumPrerequisite.findMany();

    const forwardAdj = new Map<string, { target: string; strength: number }[]>();
    const reverseAdj = new Map<string, { target: string; strength: number }[]>();
    const allNodeKeys = new Set<string>();

    for (const edge of prerequisites) {
      const fromKey = nodeKey(edge.fromSubject, edge.fromUnit);
      const toKey = nodeKey(edge.toSubject, edge.toUnit);
      allNodeKeys.add(fromKey);
      allNodeKeys.add(toKey);

      if (!forwardAdj.has(fromKey)) forwardAdj.set(fromKey, []);
      forwardAdj.get(fromKey)!.push({ target: toKey, strength: edge.strength });

      if (!reverseAdj.has(toKey)) reverseAdj.set(toKey, []);
      reverseAdj.get(toKey)!.push({ target: fromKey, strength: edge.strength });
    }

    // 2. Fetch student mastery per (subject, unitMajor) from SubmissionAnswer + Problem
    const masteryMap = await this.computeMasteryMap(studentId);
    for (const key of masteryMap.keys()) {
      allNodeKeys.add(key);
    }

    // 3. Build node list
    const nodes: GraphNode[] = [];
    for (const key of [...allNodeKeys].sort()) {
      const [subject, unit] = key.split("::");
      const stats = masteryMap.get(key);
      nodes.push({
        id: key,
        subject,
        unit,
        accuracy: stats ? Math.round((stats.correct / stats.total) * 100) : null,
        totalAttempts: stats?.total ?? 0,
        totalCorrect: stats?.correct ?? 0,
        isWeaknessRoot: false,
      });
    }

    // 4. Build edge list
    const edges: GraphEdge[] = prerequisites.map((e) => ({
      from: nodeKey(e.fromSubject, e.fromUnit),
      to: nodeKey(e.toSubject, e.toUnit),
      strength: e.strength,
    }));

    // 5. Find weak topics (accuracy < 50%) and trace back to root causes
    const weakNodes = nodes.filter(
      (n) => n.accuracy !== null && n.accuracy < 50,
    );

    const weaknessRoots = new Set<string>();
    for (const weak of weakNodes) {
      const roots = this.traceWeaknessRoots(weak.id, reverseAdj, masteryMap);
      for (const root of roots) {
        weaknessRoots.add(root);
      }
    }

    // Mark weakness roots on nodes
    for (const node of nodes) {
      if (weaknessRoots.has(node.id)) {
        node.isWeaknessRoot = true;
      }
    }

    // 6. Build recommendations
    const recommendations: Recommendation[] = [];
    for (const rootId of weaknessRoots) {
      const [subject, unit] = rootId.split("::");
      const stats = masteryMap.get(rootId);
      const reason =
        stats === undefined
          ? "아직 풀어보지 않은 선수 단원입니다. 이 단원을 먼저 학습하세요."
          : `정답률 ${Math.round((stats.correct / stats.total) * 100)}%로 약점입니다. 이 단원이 후속 단원의 기초가 됩니다.`;

      recommendations.push({ nodeId: rootId, subject, unit, reason });
    }

    return {
      nodes,
      edges,
      weaknessRoots: [...weaknessRoots],
      recommendations,
    };
  }

  /**
   * Walk backwards from a weak node through the prerequisite DAG.
   * Collect nodes that are also weak (accuracy < 50%) or untested.
   * Stop at strong nodes (accuracy >= 50%).
   * Return the terminal weak/untested nodes (root causes).
   */
  traceWeaknessRoots(
    startNodeId: string,
    reverseAdj: Map<string, { target: string; strength: number }[]>,
    masteryMap: Map<string, { correct: number; total: number }>,
  ): string[] {
    const roots: string[] = [];
    const visited = new Set<string>();
    const queue = [startNodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const predecessors = reverseAdj.get(current) ?? [];
      const weakPredecessors: string[] = [];

      for (const pred of predecessors) {
        const stats = masteryMap.get(pred.target);
        const isWeakOrUntested =
          stats === undefined || (stats.correct / stats.total) * 100 < 50;

        if (isWeakOrUntested && !visited.has(pred.target)) {
          weakPredecessors.push(pred.target);
          queue.push(pred.target);
        }
      }

      // If no weak predecessors, this node is a root cause
      if (weakPredecessors.length === 0 && current !== startNodeId) {
        roots.push(current);
      }
      // If start node has no weak predecessors, it is its own root
      if (weakPredecessors.length === 0 && current === startNodeId) {
        roots.push(current);
      }
    }

    return roots;
  }

  async seedPrerequisites() {
    return seedPrerequisites(this.prisma);
  }

  private async computeMasteryMap(
    studentId: string,
  ): Promise<Map<string, { correct: number; total: number }>> {
    // Join SubmissionAnswer with Problem to get per-topic accuracy
    const answers = await this.prisma.submissionAnswer.findMany({
      where: {
        submission: { studentId },
        isCorrect: { not: null },
      },
      select: {
        isCorrect: true,
        problemId: true,
      },
    });

    if (answers.length === 0) return new Map();

    const problemIds = [...new Set(answers.map((a) => a.problemId))];
    const problems = await this.prisma.problem.findMany({
      where: { id: { in: problemIds } },
      select: { id: true, subject: true, unitMajor: true },
    });

    const problemMap = new Map(problems.map((p) => [p.id, p]));
    const masteryMap = new Map<string, { correct: number; total: number }>();

    for (const ans of answers) {
      const problem = problemMap.get(ans.problemId);
      if (!problem?.subject || !problem?.unitMajor) continue;

      const key = nodeKey(problem.subject, problem.unitMajor);
      const current = masteryMap.get(key) ?? { correct: 0, total: 0 };
      current.total++;
      if (ans.isCorrect) current.correct++;
      masteryMap.set(key, current);
    }

    return masteryMap;
  }
}
