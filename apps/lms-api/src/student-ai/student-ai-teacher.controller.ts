import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Param,
  Request,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { canAccessClass, canAccessStudentData } from "../common/access-control";
import { WeaknessProfileService } from "./weakness/weakness-profile.service";
import { KnowledgeGraphService } from "./weakness/knowledge-graph.service";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("student-ai/teacher")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("teacher", "admin")
export class StudentAiTeacherController {
  constructor(
    private prisma: PrismaService,
    private weakness: WeaknessProfileService,
    private knowledgeGraph: KnowledgeGraphService,
  ) {}

  @Get("class/:id/weakness")
  async getClassWeakness(
    @Param("id") classId: string,
    @Request() req: AuthRequest,
  ) {
    const allowed = await canAccessClass(
      this.prisma,
      req.user.id,
      req.user.role,
      classId,
    );
    if (!allowed)
      throw new ForbiddenException("Not authorized to access this class");
    return this.weakness.getClassHeatmap(classId);
  }

  @Get("student/:id/weakness")
  async getStudentWeakness(
    @Param("id") studentId: string,
    @Request() req: AuthRequest,
  ) {
    const allowed = await canAccessStudentData(
      this.prisma,
      req.user.id,
      req.user.role,
      studentId,
    );
    if (!allowed)
      throw new ForbiddenException(
        "Not authorized to access this student's data",
      );
    return this.weakness.getStudentWeakness(studentId);
  }

  @Post("seed-prerequisites")
  seedPrerequisites() {
    return this.knowledgeGraph.seedPrerequisites();
  }
}
