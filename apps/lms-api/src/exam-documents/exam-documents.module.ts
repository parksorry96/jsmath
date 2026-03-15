import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ExamDocumentsController } from "./exam-documents.controller";
import { ExamDocumentsService } from "./exam-documents.service";
import { LatexCompilerService } from "./latex-compiler.service";
import { ExamDocumentsPdfProcessor } from "./exam-documents.processor";
import { ProblemsModule } from "../problems/problems.module";

@Module({
  imports: [
    BullModule.registerQueue({ name: "exam-document-pdf" }),
    ProblemsModule,
  ],
  controllers: [ExamDocumentsController],
  providers: [ExamDocumentsService, LatexCompilerService, ExamDocumentsPdfProcessor],
})
export class ExamDocumentsModule {}
