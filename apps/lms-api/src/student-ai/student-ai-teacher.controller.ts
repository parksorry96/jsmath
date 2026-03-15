import { Controller, Get, Post, Param, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { WeaknessProfileService } from "./weakness/weakness-profile.service";
import { KnowledgeGraphService } from "./weakness/knowledge-graph.service";

@Controller("student-ai/teacher")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("teacher", "admin")
export class StudentAiTeacherController {
  constructor(
    private weakness: WeaknessProfileService,
    private knowledgeGraph: KnowledgeGraphService,
  ) {}

  @Get("class/:id/weakness")
  getClassWeakness(@Param("id") classId: string) {
    return this.weakness.getClassHeatmap(classId);
  }

  @Get("student/:id/weakness")
  getStudentWeakness(@Param("id") studentId: string) {
    return this.weakness.getStudentWeakness(studentId);
  }

  @Post("seed-prerequisites")
  seedPrerequisites() {
    return this.knowledgeGraph.seedPrerequisites();
  }
}
