import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurriculumService } from "./curriculum.service";

@Controller("curriculum")
@UseGuards(JwtAuthGuard)
export class CurriculumController {
  constructor(private curriculumService: CurriculumService) {}

  @Get("tree")
  getTree(
    @Query("year", new ParseIntPipe({ optional: true })) year?: number,
  ) {
    return this.curriculumService.getTree(year ?? 2015);
  }

  @Get("subjects")
  getSubjects(
    @Query("year", new ParseIntPipe({ optional: true })) year?: number,
  ) {
    return this.curriculumService.getSubjects(year ?? 2015);
  }

  @Get(":parentId/children")
  getChildren(@Param("parentId") parentId: string) {
    return this.curriculumService.getChildren(parentId);
  }
}
