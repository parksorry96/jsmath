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
import { ClassesService } from "./classes.service";
import { CreateClassDto } from "./dto/create-class.dto";
import { UpdateClassDto } from "./dto/update-class.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("classes")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClassesController {
  constructor(private classes: ClassesService) {}

  @Post()
  @Roles("admin", "teacher")
  create(@Body() dto: CreateClassDto, @Request() req: AuthRequest) {
    return this.classes.create(dto, req.user.id, req.user.role);
  }

  @Get()
  findAll(
    @Query("organizationId") organizationId: string | undefined,
    @Request() req: AuthRequest,
  ) {
    return this.classes.findAll(organizationId, req.user.id, req.user.role);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.classes.findById(id, req.user.id, req.user.role);
  }

  @Patch(":id")
  @Roles("admin", "teacher")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateClassDto,
    @Request() req: AuthRequest,
  ) {
    return this.classes.update(id, dto, req.user.id, req.user.role);
  }

  @Delete(":id")
  @Roles("admin", "teacher")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.classes.softDelete(id, req.user.id, req.user.role);
  }
}
