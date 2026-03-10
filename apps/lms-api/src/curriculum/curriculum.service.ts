import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CurriculumService {
  constructor(private prisma: PrismaService) {}

  async getTree(curriculumYear: number) {
    const nodes = await this.prisma.curriculumNode.findMany({
      where: { curriculumYear },
      orderBy: [{ level: "asc" }, { sortOrder: "asc" }],
    });

    // Build tree from flat list
    const map = new Map(
      nodes.map((n) => [n.id, { ...n, children: [] as any[] }]),
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

  async getSubjects(curriculumYear: number) {
    return this.prisma.curriculumNode.findMany({
      where: { curriculumYear, level: 1 },
      orderBy: { sortOrder: "asc" },
    });
  }

  async getChildren(parentId: string) {
    return this.prisma.curriculumNode.findMany({
      where: { parentId },
      orderBy: { sortOrder: "asc" },
    });
  }
}
