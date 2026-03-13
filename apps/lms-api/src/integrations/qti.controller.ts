import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { QtiExportService } from "./qti-export.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AuthRequest {
  user: { id: string; email: string; role: string };
}

@Controller("integrations/qti")
@UseGuards(JwtAuthGuard, RolesGuard)
export class QtiController {
  constructor(private qtiExport: QtiExportService) {}

  @Get("export/problem/:id")
  @Roles("admin", "teacher")
  @Header("Content-Type", "application/xml")
  exportProblem(@Param("id") id: string) {
    return this.qtiExport.exportProblem(id);
  }

  @Get("export/assignment/:id")
  @Roles("admin", "teacher")
  @Header("Content-Type", "application/xml")
  exportAssignment(@Param("id") id: string) {
    return this.qtiExport.exportAssignment(id);
  }

  @Post("import")
  @Roles("admin", "teacher")
  importQti(@Body() body: { xml: string }, @Request() req: AuthRequest) {
    return this.qtiExport.importQti(body.xml, req.user.id);
  }
}
