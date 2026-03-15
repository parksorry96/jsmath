import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
} from "@nestjs/common";
import { AnalyticsService } from "./analytics.service";
import { KnowledgeGraphService } from "./knowledge-graph.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { canAccessClass, canAccessStudentData } from "../common/access-control";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("analytics")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(
    private analytics: AnalyticsService,
    private knowledgeGraph: KnowledgeGraphService,
    private prisma: PrismaService,
  ) {}

  @Get("student/:studentId/daily-summary")
  async studentDailySummary(
    @Param("studentId") studentId: string,
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Request() req: AuthRequest,
  ) {
    const canAccess = await canAccessStudentData(
      this.prisma,
      req.user.id,
      req.user.role,
      studentId,
    );
    if (!canAccess) {
      throw new ForbiddenException();
    }

    return this.analytics.getStudentDailySummary(
      studentId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
  }

  @Get("student/:studentId")
  async studentReport(
    @Param("studentId") studentId: string,
    @Query("classId") classId: string | undefined,
    @Request() req: AuthRequest,
  ) {
    const user = req.user;

    const canAccessStudent = await canAccessStudentData(
      this.prisma,
      user.id,
      user.role,
      studentId,
    );
    if (!canAccessStudent) {
      throw new ForbiddenException();
    }

    if (classId) {
      const canAccessTargetClass = await canAccessClass(
        this.prisma,
        user.id,
        user.role,
        classId,
      );
      if (!canAccessTargetClass) {
        throw new ForbiddenException();
      }
    }

    return this.analytics.getStudentReport(studentId, classId);
  }

  @Get("class/:classId")
  @Roles("admin", "teacher")
  async classReport(
    @Param("classId") classId: string,
    @Request() req: AuthRequest,
  ) {
    const allowed = await canAccessClass(
      this.prisma,
      req.user.id,
      req.user.role,
      classId,
    );
    if (!allowed) {
      throw new ForbiddenException();
    }
    return this.analytics.getClassReport(classId);
  }

  @Get("student/:studentId/knowledge-graph")
  async studentKnowledgeGraph(
    @Param("studentId") studentId: string,
    @Request() req: AuthRequest,
  ) {
    const canAccess = await canAccessStudentData(
      this.prisma,
      req.user.id,
      req.user.role,
      studentId,
    );
    if (!canAccess) {
      throw new ForbiddenException();
    }

    return this.knowledgeGraph.getStudentKnowledgeGraph(studentId);
  }

  @Post("seed-prerequisites")
  @Roles("admin")
  async seedPrerequisites() {
    return this.knowledgeGraph.seedPrerequisites();
  }
}
