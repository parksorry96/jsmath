-- CreateEnum
CREATE TYPE "public"."ExamDocumentVisibility" AS ENUM ('private', 'public');

-- AlterTable: ExamDocument
ALTER TABLE "public"."exam_documents" ADD COLUMN "visibility" "public"."ExamDocumentVisibility" NOT NULL DEFAULT 'private';

-- AlterTable: Assignment
ALTER TABLE "public"."assignments" ADD COLUMN "exam_document_id" TEXT;
ALTER TABLE "public"."assignments" ADD COLUMN "attach_pdf" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "exam_documents_visibility_idx" ON "public"."exam_documents"("visibility");

-- AddForeignKey
ALTER TABLE "public"."assignments" ADD CONSTRAINT "assignments_exam_document_id_fkey" FOREIGN KEY ("exam_document_id") REFERENCES "public"."exam_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
