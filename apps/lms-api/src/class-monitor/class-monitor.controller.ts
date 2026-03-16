import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
  Request,
  ForbiddenException,
} from "@nestjs/common";
import { Response } from "express";
import { ClassMonitorService } from "./class-monitor.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { canAccessClass } from "../common/access-control";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("class-monitor")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "teacher")
export class ClassMonitorController {
  constructor(
    private monitor: ClassMonitorService,
    private prisma: PrismaService,
  ) {}

  @Get(":classId/assignments")
  async getAssignments(
    @Param("classId") classId: string,
    @Request() req: AuthRequest,
  ) {
    await this.assertAccess(req, classId);
    return this.monitor.getClassAssignments(classId);
  }

  @Get(":classId/status")
  async getStatus(
    @Param("classId") classId: string,
    @Query("assignmentId") assignmentId: string | undefined,
    @Request() req: AuthRequest,
  ) {
    await this.assertAccess(req, classId);
    return this.monitor.getStatus(classId, assignmentId);
  }

  /** @deprecated Use WebSocket gateway (/class-monitor namespace) instead */
  @Get(":classId/stream")
  async stream(
    @Param("classId") classId: string,
    @Query("assignmentId") assignmentId: string | undefined,
    @Request() req: AuthRequest,
    @Res() res: Response,
  ) {
    await this.assertAccess(req, classId);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Send initial state immediately
    const initial = await this.monitor.getStatus(classId, assignmentId);
    res.write(`event: status\ndata: ${JSON.stringify(initial)}\n\n`);

    // Poll every 5 seconds and push diffs
    const interval = setInterval(async () => {
      try {
        const status = await this.monitor.getStatus(classId, assignmentId);
        res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
      } catch {
        // Class may have been deleted or connection issue; silently skip
      }
    }, 5000);

    // Clean up on disconnect
    void req.user; // keep reference to avoid early GC
    res.on("close", () => {
      clearInterval(interval);
    });
  }

  private async assertAccess(req: AuthRequest, classId: string) {
    const allowed = await canAccessClass(
      this.prisma,
      req.user.id,
      req.user.role,
      classId,
    );
    if (!allowed) {
      throw new ForbiddenException();
    }
  }
}
