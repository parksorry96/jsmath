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
import { CoursesService } from "./courses.service";
import { CreateCourseDto } from "./dto/create-course.dto";
import { UpdateCourseDto } from "./dto/update-course.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("courses")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CoursesController {
  constructor(private courses: CoursesService) {}

  @Post()
  @Roles("admin", "teacher")
  create(@Body() dto: CreateCourseDto) {
    return this.courses.create(dto);
  }

  @Get()
  findAll(@Query("organizationId") organizationId?: string) {
    return this.courses.findAll(organizationId);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.courses.findById(id);
  }

  @Patch(":id")
  @Roles("admin", "teacher")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateCourseDto,
    @Request() req: AuthRequest,
  ) {
    return this.courses.update(id, dto, req.user.id, req.user.role);
  }

  @Delete(":id")
  @Roles("admin", "teacher")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.courses.softDelete(id, req.user.role);
  }
}
