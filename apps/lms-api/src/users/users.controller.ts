import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
} from "@nestjs/common";
import { UsersService } from "./users.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Get("me")
  getMe(@Request() req: { user: { id: string } }) {
    return this.users.findById(req.user.id);
  }

  @Get()
  @Roles("admin")
  findAll() {
    return this.users.findAll();
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: { name?: string }) {
    return this.users.update(id, body);
  }
}
