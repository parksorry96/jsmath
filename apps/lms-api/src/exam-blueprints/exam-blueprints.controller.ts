import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ExamBlueprintsService } from "./exam-blueprints.service";
import { BlueprintComposerService } from "./blueprint-composer.service";
import { CreateBlueprintDto } from "./dto/create-blueprint.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("exam-blueprints")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "teacher")
export class ExamBlueprintsController {
  constructor(
    private blueprints: ExamBlueprintsService,
    private composer: BlueprintComposerService,
  ) {}

  @Post()
  create(@Body() dto: CreateBlueprintDto, @Request() req: AuthRequest) {
    return this.blueprints.create(dto, req.user.id);
  }

  @Get()
  findAll(@Request() req: AuthRequest) {
    return this.blueprints.findAll(req.user.id, req.user.role);
  }

  @Get(":id")
  findById(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.blueprints.findById(id, req.user.id);
  }

  @Put(":id")
  update(
    @Param("id") id: string,
    @Body() dto: Partial<CreateBlueprintDto>,
    @Request() req: AuthRequest,
  ) {
    return this.blueprints.update(id, dto, req.user.id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.blueprints.remove(id, req.user.id);
  }

  @Post(":id/preview")
  preview(
    @Param("id") id: string,
    @Body() body: { classId?: string },
    @Request() req: AuthRequest,
  ) {
    return this.composer.preview(id, req.user.id, body.classId);
  }

  @Post(":id/compose")
  compose(
    @Param("id") id: string,
    @Body() body: { classId?: string },
    @Request() req: AuthRequest,
  ) {
    return this.composer.compose(id, req.user.id, body.classId);
  }
}
