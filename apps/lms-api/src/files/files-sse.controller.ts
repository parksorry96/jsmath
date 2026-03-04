import { Controller, Sse, Param, MessageEvent } from "@nestjs/common";
import { Observable, filter, map } from "rxjs";
import { FilesService } from "./files.service";

@Controller("files")
export class FilesSseController {
  constructor(private readonly filesService: FilesService) {}

  @Sse(":id/events")
  streamEvents(@Param("id") id: string): Observable<MessageEvent> {
    return this.filesService.getProgressStream().pipe(
      filter((event) => event.ocrJobId === id),
      map((event) => ({
        data: JSON.stringify(event),
        type: "progress",
      })),
    );
  }
}
