import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from "@nestjs/common";
import { OrganizationsService } from "./organizations.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

@Controller("organizations")
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationsController {
  constructor(private orgs: OrganizationsService) {}

  @Post()
  @Roles("admin")
  create(@Body() body: { name: string }) {
    return this.orgs.create(body.name);
  }

  @Get()
  findAll() {
    return this.orgs.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.orgs.findById(id);
  }
}
