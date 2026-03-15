import {
  Controller,
  Sse,
  Param,
  MessageEvent,
  UseGuards,
  Request,
} from "@nestjs/common";
import { Observable, filter, map } from "rxjs";
import { FilesService } from "./files.service";
import { PipelineProgressService } from "./pipeline-progress.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

@Controller("files")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin", "teacher")
export class FilesSseController {
  constructor(
    private readonly filesService: FilesService,
    private readonly progress: PipelineProgressService,
  ) {}

  @Sse(":id/events")
  async streamEvents(
    @Param("id") id: string,
    @Request() req: { user: { id: string; role: string } },
  ): Promise<Observable<MessageEvent>> {
    await this.filesService.assertCanAccessOcrJob(id, req.user.id, req.user.role);

    return this.progress.getProgressStream().pipe(
      filter((event) => event.ocrJobId === id),
      map((event) => ({
        data: JSON.stringify(event),
        type: "progress",
      })),
    );
  }
}
