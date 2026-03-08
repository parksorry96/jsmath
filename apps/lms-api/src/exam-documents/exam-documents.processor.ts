import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { ExamDocumentsService } from "./exam-documents.service";

@Processor("exam-document-pdf")
export class ExamDocumentsPdfProcessor extends WorkerHost {
  private readonly logger = new Logger(ExamDocumentsPdfProcessor.name);

  constructor(private examDocumentsService: ExamDocumentsService) {
    super();
  }

  async process(job: Job<{ documentId: string; generateAnswerSheet: boolean }>) {
    this.logger.log(`Processing PDF generation for document ${job.data.documentId}`);
    await this.examDocumentsService.generatePdf(
      job.data.documentId,
      job.data.generateAnswerSheet,
    );
    this.logger.log(`PDF generation completed for document ${job.data.documentId}`);
  }
}
