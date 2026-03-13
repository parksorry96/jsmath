import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
} from "@nestjs/common";
import { RemediationService } from "./remediation.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("remediation")
@UseGuards(JwtAuthGuard, RolesGuard)
export class RemediationController {
  constructor(private remediation: RemediationService) {}

  @Get("suggestions")
  @Roles("student")
  getSuggestions(@Request() req: AuthRequest) {
    return this.remediation.getSuggestionsForStudent(req.user.id);
  }

  @Post("generate")
  @Roles("student")
  generate(
    @Request() req: AuthRequest,
    @Body() body: { maxProblems?: number; sourceAssignmentId?: string },
  ) {
    return this.remediation.generateForStudent(req.user.id, {
      maxProblems: body.maxProblems,
      sourceAssignmentId: body.sourceAssignmentId,
    });
  }
}
