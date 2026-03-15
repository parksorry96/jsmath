import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { FilesService } from "./files.service";
import { FilesController } from "./files.controller";
import { FilesSseController } from "./files-sse.controller";
import { UploadPolicyService } from "./upload-policy.service";
import { PdfBundleService } from "./pdf-bundle.service";
import { FileStorageService } from "./file-storage.service";
import { SourceFileIngestionService } from "./source-file-ingestion.service";
import { PipelineProgressService } from "./pipeline-progress.service";

@Module({
  imports: [CommonModule],
  controllers: [FilesController, FilesSseController],
  providers: [
    FilesService,
    UploadPolicyService,
    PdfBundleService,
    FileStorageService,
    SourceFileIngestionService,
    PipelineProgressService,
  ],
  exports: [PipelineProgressService, UploadPolicyService],
})
export class FilesModule {}
