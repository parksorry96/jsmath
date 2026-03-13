import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { LtiService } from "./lti.service";
import { RegisterPlatformDto } from "./dto/register-platform.dto";
import { GradePassbackDto } from "./dto/grade-passback.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("integrations/lti")
export class LtiController {
  constructor(private lti: LtiService) {}

  /**
   * OIDC launch endpoint — called by the LMS after OIDC login initiation.
   * Accepts the signed id_token, validates it, and returns a session token.
   * This endpoint is intentionally unauthenticated (the platform calls it).
   */
  @Post("launch")
  async launch(@Body() body: { id_token: string }) {
    return this.lti.handleLaunch(body.id_token);
  }

  /** Public JWKS endpoint for platforms to verify our tokens. */
  @Get("jwks")
  getJwks() {
    return this.lti.getJwks();
  }

  /** Register a new LMS platform (admin only). */
  @Post("platforms")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  registerPlatform(@Body() dto: RegisterPlatformDto) {
    return this.lti.registerPlatform(dto);
  }

  /** List all registered platforms (admin only). */
  @Get("platforms")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  listPlatforms() {
    return this.lti.listPlatforms();
  }

  /** AGS grade passback for a specific platform (admin/teacher). */
  @Post("platforms/:id/grade-passback")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin", "teacher")
  gradePassback(
    @Param("id") id: string,
    @Body() dto: GradePassbackDto,
    @Request() _req: AuthRequest,
  ) {
    return this.lti.gradePassback({
      platformId: id,
      lineItemUrl: dto.lineItemUrl,
      userId: dto.userId,
      score: dto.score,
      maxScore: dto.maxScore,
    });
  }
}
