import { Body, Controller, Post, Request, UseGuards } from "@nestjs/common";
import { createHash } from "crypto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { LearningEventsService } from "./learning-events.service";
import { BatchEventsDto } from "./dto/batch-events.dto";
import { getRequesterOrganizationId } from "../common/access-control";
import { PrismaService } from "../prisma/prisma.service";

interface AuthRequest {
  user: { id: string; email: string; role: string };
  ip: string;
}

@Controller("learning-events")
@UseGuards(JwtAuthGuard, RolesGuard)
export class LearningEventsController {
  constructor(
    private learningEvents: LearningEventsService,
    private prisma: PrismaService,
  ) {}

  @Post("batch")
  @Roles("student")
  async ingestBatch(@Body() dto: BatchEventsDto, @Request() req: AuthRequest) {
    const ipHash = createHash("sha256")
      .update(req.ip || "unknown")
      .digest("hex");

    const organizationId = await getRequesterOrganizationId(
      this.prisma,
      req.user.id,
    );

    return this.learningEvents.processBatch(
      req.user.id,
      organizationId,
      dto.events,
      ipHash,
    );
  }
}
