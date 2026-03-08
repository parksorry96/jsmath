import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
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

  @Post("classes/:classId/assignments")
  @Roles("admin", "teacher")
  create(
    @Param("classId") classId: string,
    @Body() dto: CreateAssignmentDto,
  ) {
    return this.assignments.create(classId, dto);
  }

  @Get("classes/assignments")
  @Roles("admin", "teacher")
  findAcrossClasses(@Query("hasPending") hasPending?: string) {
    return this.assignments.findAcrossClasses(hasPending === "true");
  }

  @Get("assignments/pending")
  @Roles("admin", "teacher")
  findPendingAssignments() {
    return this.assignments.findAcrossClasses(true);
  }

  @Get("classes/:classId/assignments")
  findAll(@Param("classId") classId: string, @Request() req: AuthRequest) {
    return this.assignments.findAll(classId, req.user.id, req.user.role);
  }

  @Get("assignments/my")
  @Roles("student")
  findMine(@Request() req: AuthRequest) {
    return this.assignments.findMine(req.user.id);
  }

  @Get("assignments/:id")
  findOne(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.assignments.findById(id, req.user.id, req.user.role);
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

  @Post("assignments/:id/return-all")
  @Roles("admin", "teacher")
  returnAll(@Param("id") id: string) {
    return this.assignments.returnAll(id);
  }

  @Post("assignments/:id/problems")
  @Roles("admin", "teacher")
  addProblems(
    @Param("id") id: string,
    @Body() body: { problemIds: string[] },
  ) {
    return this.assignments.addProblems(id, body.problemIds);
  }

  @Delete("assignments/:id/problems/:problemId")
  @Roles("admin", "teacher")
  removeProblem(
    @Param("id") id: string,
    @Param("problemId") problemId: string,
  ) {
    return this.assignments.removeProblem(id, problemId);
  }

  @Patch("assignments/:id/problems/reorder")
  @Roles("admin", "teacher")
  reorderProblems(
    @Param("id") id: string,
    @Body() body: { problemIds: string[] },
  ) {
    return this.assignments.reorderProblems(id, body.problemIds);
  }
}
