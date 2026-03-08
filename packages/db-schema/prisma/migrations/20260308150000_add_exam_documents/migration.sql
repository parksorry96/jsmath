-- CreateEnum
CREATE TYPE "public"."ExamDocumentType" AS ENUM ('exam', 'workbook');

-- CreateEnum
CREATE TYPE "public"."ExamDocumentStatus" AS ENUM ('draft', 'generating', 'completed', 'failed');

-- CreateTable
CREATE TABLE "public"."exam_documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "public"."ExamDocumentType" NOT NULL,
    "creator_id" TEXT NOT NULL,
    "header_config" JSONB,
    "layout_config" JSONB NOT NULL,
    "cover_config" JSONB,
    "pdf_s3_key" TEXT,
    "answer_pdf_s3_key" TEXT,
    "status" "public"."ExamDocumentStatus" NOT NULL DEFAULT 'draft',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."exam_document_problems" (
    "id" TEXT NOT NULL,
    "exam_document_id" TEXT NOT NULL,
    "problem_id" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,

    CONSTRAINT "exam_document_problems_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_documents_creator_id_idx" ON "public"."exam_documents"("creator_id");

-- CreateIndex
CREATE INDEX "exam_documents_status_idx" ON "public"."exam_documents"("status");

-- CreateIndex
CREATE INDEX "exam_document_problems_exam_document_id_idx" ON "public"."exam_document_problems"("exam_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_document_problems_exam_document_id_problem_id_key" ON "public"."exam_document_problems"("exam_document_id", "problem_id");

-- AddForeignKey
ALTER TABLE "public"."exam_documents" ADD CONSTRAINT "exam_documents_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."exam_document_problems" ADD CONSTRAINT "exam_document_problems_exam_document_id_fkey" FOREIGN KEY ("exam_document_id") REFERENCES "public"."exam_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
