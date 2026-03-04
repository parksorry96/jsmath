import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { AssignmentsService } from "./assignments.service";
import { CreateAssignmentDto } from "./dto/create-assignment.dto";
import { UpdateAssignmentDto } from "./dto/update-assignment.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssignmentsController {
  constructor(private assignments: AssignmentsService) {}

  @Post("courses/:courseId/assignments")
  @Roles("admin", "teacher")
  create(
    @Param("courseId") courseId: string,
    @Body() dto: CreateAssignmentDto,
  ) {
    return this.assignments.create(courseId, dto);
  }

  @Get("courses/:courseId/assignments")
  findAll(@Param("courseId") courseId: string) {
    return this.assignments.findAll(courseId);
  }

  @Patch("assignments/:id")
  @Roles("admin", "teacher")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateAssignmentDto,
    @Request() req: AuthRequest,
  ) {
    return this.assignments.update(id, dto, req.user.role);
  }

  @Delete("assignments/:id")
  @Roles("admin", "teacher")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.assignments.remove(id, req.user.role);
  }
}
