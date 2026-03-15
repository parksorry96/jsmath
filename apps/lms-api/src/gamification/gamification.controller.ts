import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { GamificationService } from "./gamification.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { canAccessClass } from "../common/access-control";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("gamification")
@UseGuards(JwtAuthGuard, RolesGuard)
export class GamificationController {
  constructor(
    private gamification: GamificationService,
    private prisma: PrismaService,
  ) {}

  @Get("profile")
  @Roles("student")
  getProfile(@Request() req: AuthRequest) {
    return this.gamification.getStudentProfile(req.user.id);
  }

  @Get("leaderboard")
  @Roles("student", "teacher", "admin")
  getLeaderboard(
    @Query("classId") classId?: string,
    @Query("limit") limit?: string,
    @Request() req?: AuthRequest,
  ) {
    if (!req) {
      throw new ForbiddenException();
    }

    if (classId) {
      return this.getScopedLeaderboard(req, classId, limit);
    }

    return this.gamification.getLeaderboard(
      req.user.id,
      req.user.role,
      classId,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get("achievements")
  @Roles("student")
  getAchievements(@Request() req: AuthRequest) {
    return this.gamification.getAllAchievements(req.user.id);
  }

  private async getScopedLeaderboard(
    req: AuthRequest,
    classId: string,
    limit?: string,
  ) {
    const allowed = await canAccessClass(
      this.prisma,
      req.user.id,
      req.user.role,
      classId,
    );
    if (!allowed) {
      throw new ForbiddenException("Not authorized to access this class");
    }

    return this.gamification.getLeaderboard(
      req.user.id,
      req.user.role,
      classId,
      limit ? parseInt(limit, 10) : undefined,
    );
  }
}
