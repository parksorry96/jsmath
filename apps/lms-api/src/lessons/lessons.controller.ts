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
import { LessonsService } from "./lessons.service";
import { CreateLessonDto } from "./dto/create-lesson.dto";
import { UpdateLessonDto } from "./dto/update-lesson.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("lessons")
@UseGuards(JwtAuthGuard, RolesGuard)
export class LessonsController {
  constructor(private lessons: LessonsService) {}

  @Post()
  @Roles("admin", "teacher")
  create(@Body() dto: CreateLessonDto, @Request() req: AuthRequest) {
    return this.lessons.create(dto, req.user.id, req.user.role);
  }

  @Get("calendar")
  getCalendar(
    @Query("start") start: string,
    @Query("end") end: string,
    @Request() req: AuthRequest,
    @Query("classId") classId?: string,
  ) {
    return this.lessons.findByDateRange(
      start,
      end,
      classId,
      req.user.id,
      req.user.role,
    );
  }

  @Patch(":id")
  @Roles("admin", "teacher")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateLessonDto,
    @Request() req: AuthRequest,
  ) {
    return this.lessons.update(id, dto, req.user.id, req.user.role);
  }

  @Patch(":id/cancel")
  @Roles("admin", "teacher")
  cancel(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.lessons.cancel(id, req.user.id, req.user.role);
  }

  @Patch(":id/complete")
  @Roles("admin", "teacher")
  complete(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.lessons.complete(id, req.user.id, req.user.role);
  }

  @Delete("series/:recurrenceParentId")
  @Roles("admin", "teacher")
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSeries(
    @Param("recurrenceParentId") recurrenceParentId: string,
    @Request() req: AuthRequest,
  ) {
    return this.lessons.deleteSeries(
      recurrenceParentId,
      req.user.id,
      req.user.role,
    );
  }
}
