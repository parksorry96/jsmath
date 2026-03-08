import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ParentLinksService } from "./parent-links.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("parent-links")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ParentLinksController {
  constructor(private parentLinks: ParentLinksService) {}

  @Post("invite")
  @Roles("admin", "teacher")
  generateInvite(@Body("studentId") studentId: string) {
    return this.parentLinks.generateInviteCode(studentId);
  }

  @Post("link")
  @Roles("parent")
  linkChild(@Body("inviteCode") inviteCode: string, @Request() req: AuthRequest) {
    return this.parentLinks.linkParent(req.user.id, inviteCode);
  }

  @Get("children")
  @Roles("parent")
  getChildren(@Request() req: AuthRequest) {
    return this.parentLinks.getChildren(req.user.id);
  }

  @Delete(":id")
  @Roles("parent")
  @HttpCode(HttpStatus.NO_CONTENT)
  unlink(@Param("id") id: string, @Request() req: AuthRequest) {
    return this.parentLinks.unlink(id, req.user.id);
  }
}
