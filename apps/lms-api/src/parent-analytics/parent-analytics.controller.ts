import {
  Controller,
  Get,
  Param,
  Query,
  Request,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import { ParentAnalyticsService } from "./parent-analytics.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { canAccessStudentData } from "../common/access-control";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("analytics/parent")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ParentAnalyticsController {
  constructor(
    private parentAnalytics: ParentAnalyticsService,
    private prisma: PrismaService,
  ) {}

  @Get("weekly-report/:childId")
  @Roles("parent")
  async getWeeklyReport(
    @Param("childId") childId: string,
    @Query("weekStart") weekStart: string | undefined,
    @Request() req: AuthRequest,
  ) {
    const allowed = await canAccessStudentData(
      this.prisma,
      req.user.id,
      req.user.role,
      childId,
    );
    if (!allowed) {
      throw new ForbiddenException();
    }

    return this.parentAnalytics.getWeeklyReport(req.user.id, childId, weekStart);
  }
}
