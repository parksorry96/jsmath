import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { MasteryService } from "./mastery.service";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("mastery")
@UseGuards(JwtAuthGuard)
export class MasteryController {
  constructor(private mastery: MasteryService) {}

  @Get()
  getAll(@Request() req: AuthRequest) {
    return this.mastery.getByStudent(req.user.id);
  }

  @Get("dashboard")
  getDashboard(@Request() req: AuthRequest) {
    return this.mastery.getDashboard(req.user.id);
  }

  @Get("tree")
  getTree(
    @Request() req: AuthRequest,
    @Query("year", new ParseIntPipe({ optional: true })) year?: number,
  ) {
    return this.mastery.getTreeWithMastery(req.user.id, year);
  }

  @Get(":nodeId")
  getNode(
    @Param("nodeId") nodeId: string,
    @Request() req: AuthRequest,
  ) {
    return this.mastery.getByNode(req.user.id, nodeId);
  }
}
