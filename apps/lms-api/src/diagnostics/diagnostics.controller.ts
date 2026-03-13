import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from "@nestjs/common";
import { DiagnosticsService } from "./diagnostics.service";
import { AnswerDiagnosticDto } from "./dto/answer-diagnostic.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("diagnostics")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DiagnosticsController {
  constructor(private diagnostics: DiagnosticsService) {}

  @Post("start")
  @Roles("student")
  start(@Request() req: AuthRequest) {
    return this.diagnostics.startSession(req.user.id);
  }

  @Post(":id/answer")
  @Roles("student")
  submitAnswer(
    @Param("id") id: string,
    @Body() dto: AnswerDiagnosticDto,
    @Request() req: AuthRequest,
  ) {
    return this.diagnostics.submitAnswer(id, req.user.id, dto);
  }

  @Get(":id/result")
  getResult(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.diagnostics.getResult(id, req.user.id, req.user.role);
  }

  @Get("history")
  getHistory(@Request() req: AuthRequest) {
    return this.diagnostics.getHistory(req.user.id);
  }
}
