import { Controller, Get, Query, UseGuards, Request } from "@nestjs/common";
import { GamificationService } from "./gamification.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("gamification")
@UseGuards(JwtAuthGuard, RolesGuard)
export class GamificationController {
  constructor(private gamification: GamificationService) {}

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
  ) {
    return this.gamification.getLeaderboard(
      classId,
      limit ? parseInt(limit, 10) : undefined,
    );
  }

  @Get("achievements")
  @Roles("student")
  getAchievements(@Request() req: AuthRequest) {
    return this.gamification.getAllAchievements(req.user.id);
  }
}
