import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { CurriculumService } from "./curriculum.service";

@Controller("curriculum")
@UseGuards(JwtAuthGuard)
export class CurriculumController {
  constructor(private curriculumService: CurriculumService) {}

  @Get("tree")
  getTree(@Query("year") year?: string) {
    const curriculumYear = year ? parseInt(year, 10) : 2015;
    return this.curriculumService.getTree(curriculumYear);
  }

  @Get("subjects")
  getSubjects(@Query("year") year?: string) {
    const curriculumYear = year ? parseInt(year, 10) : 2015;
    return this.curriculumService.getSubjects(curriculumYear);
  }

  @Get(":parentId/children")
  getChildren(@Param("parentId") parentId: string) {
    return this.curriculumService.getChildren(parentId);
  }
}
