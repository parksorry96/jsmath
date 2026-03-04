import { Module } from "@nestjs/common";
import { FilesService } from "./files.service";
import { FilesController } from "./files.controller";
import { FilesSseController } from "./files-sse.controller";

@Module({
  controllers: [FilesController, FilesSseController],
  providers: [FilesService],
})
export class FilesModule {}
