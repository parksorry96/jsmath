import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { TutorService } from "./tutor.service";
import { CreateSessionDto } from "./dto/create-session.dto";
import { SendMessageDto } from "./dto/send-message.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("tutor/sessions")
@UseGuards(JwtAuthGuard, RolesGuard)
export class TutorController {
  constructor(private tutor: TutorService) {}

  @Post()
  @Roles("student")
  create(@Body() dto: CreateSessionDto, @Request() req: AuthRequest) {
    return this.tutor.createSession(req.user.id, dto.problemId);
  }

  @Post(":id/message")
  @Roles("student")
  async sendMessage(
    @Param("id") id: string,
    @Body() dto: SendMessageDto,
    @Request() req: AuthRequest,
    @Res() res: Response,
  ) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    try {
      const stream = this.tutor.sendMessage(id, req.user.id, dto.content);
      for await (const chunk of stream) {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }
      res.write("event: done\ndata: {}\n\n");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Internal server error";
      res.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
    }

    res.end();
  }

  @Get(":id")
  getSession(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.tutor.getSession(id, req.user.id);
  }

  @Post(":id/end")
  @Roles("student")
  endSession(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.tutor.endSession(id, req.user.id);
  }
}
