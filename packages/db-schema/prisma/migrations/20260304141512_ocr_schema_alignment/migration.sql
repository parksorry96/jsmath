/*
  Warnings:

  - You are about to drop the `ocr_jobs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `problem_assets` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `problem_choices` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `problem_similarities` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `problems` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `source_files` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ocr";

-- CreateEnum
CREATE TYPE "ocr"."OcrJobStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'manual_review');

-- CreateEnum
CREATE TYPE "ocr"."ProblemType" AS ENUM ('multiple_choice', 'short_answer', 'written_solution', 'essay');

-- CreateEnum
CREATE TYPE "ocr"."ReviewStatus" AS ENUM ('auto_approved', 'pending_review', 'approved', 'rejected');

-- DropForeignKey
ALTER TABLE "ocr_jobs" DROP CONSTRAINT "ocr_jobs_source_file_id_fkey";

-- DropForeignKey
ALTER TABLE "problem_assets" DROP CONSTRAINT "problem_assets_problem_id_fkey";

-- DropForeignKey
ALTER TABLE "problem_choices" DROP CONSTRAINT "problem_choices_problem_id_fkey";

-- DropForeignKey
ALTER TABLE "problems" DROP CONSTRAINT "problems_ocr_job_id_fkey";

-- DropForeignKey
ALTER TABLE "problems" DROP CONSTRAINT "problems_parent_id_fkey";

-- DropTable
DROP TABLE "ocr_jobs";

-- DropTable
DROP TABLE "problem_assets";

-- DropTable
DROP TABLE "problem_choices";

-- DropTable
DROP TABLE "problem_similarities";

-- DropTable
DROP TABLE "problems";

-- DropTable
DROP TABLE "source_files";

-- DropEnum
DROP TYPE "OcrJobStatus";

-- DropEnum
DROP TYPE "ProblemType";

-- DropEnum
DROP TYPE "ReviewStatus";

-- CreateTable
CREATE TABLE "ocr"."source_files" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr"."ocr_jobs" (
    "id" TEXT NOT NULL,
    "source_file_id" TEXT NOT NULL,
    "status" "ocr"."OcrJobStatus" NOT NULL DEFAULT 'pending',
    "problem_count" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ocr_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr"."problems" (
    "id" TEXT NOT NULL,
    "ocr_job_id" TEXT NOT NULL,
    "textbook_id" TEXT,
    "source_file_id" TEXT,
    "start_page" INTEGER NOT NULL,
    "end_page" INTEGER NOT NULL,
    "problem_number" TEXT,
    "display_number" TEXT,
    "parent_id" TEXT,
    "stem_latex" TEXT NOT NULL,
    "stem_text" TEXT NOT NULL,
    "stem_latex_normalized" TEXT,
    "shared_stem_latex" TEXT,
    "shared_stem_text" TEXT,
    "problem_type" "ocr"."ProblemType" NOT NULL,
    "answer_text" TEXT,
    "answer_latex" TEXT,
    "grade_level" TEXT,
    "subject" TEXT,
    "unit_major" TEXT,
    "unit_minor" TEXT,
    "unit_sub" TEXT,
    "difficulty" SMALLINT,
    "classification_confidence" DOUBLE PRECISION,
    "review_status" "ocr"."ReviewStatus" NOT NULL DEFAULT 'pending_review',
    "reviewed_by" TEXT,
    "is_common" BOOLEAN,
    "point_value" SMALLINT,
    "question_format" TEXT,
    "position_type" TEXT,
    "exam_source" JSONB,
    "solution_strategy" TEXT,
    "required_concepts" JSONB,
    "solution_steps" JSONB,
    "estimated_time_sec" INTEGER,
    "common_mistakes" JSONB,
    "difficulty_refined" DOUBLE PRECISION,
    "analysis_status" TEXT NOT NULL DEFAULT 'pending',
    "analyzed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr"."problem_choices" (
    "id" TEXT NOT NULL,
    "problem_id" TEXT NOT NULL,
    "position" SMALLINT NOT NULL,
    "label" VARCHAR(10) NOT NULL,
    "content_latex" TEXT NOT NULL,
    "content_text" TEXT NOT NULL,
    "is_correct" BOOLEAN,

    CONSTRAINT "problem_choices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr"."problem_assets" (
    "id" TEXT NOT NULL,
    "problem_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sub_kind" TEXT,
    "s3_key" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'webp',
    "width_px" INTEGER,
    "height_px" INTEGER,
    "detection_method" TEXT,
    "ai_description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "problem_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr"."problem_similarities" (
    "id" TEXT NOT NULL,
    "problem_id" TEXT NOT NULL,
    "similar_problem_id" TEXT NOT NULL,
    "similarity_score" DOUBLE PRECISION NOT NULL,
    "similarity_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "problem_similarities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "source_files_file_hash_key" ON "ocr"."source_files"("file_hash");

-- CreateIndex
CREATE INDEX "ocr_jobs_status_created_at_idx" ON "ocr"."ocr_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "problems_ocr_job_id_idx" ON "ocr"."problems"("ocr_job_id");

-- CreateIndex
CREATE INDEX "problems_textbook_id_idx" ON "ocr"."problems"("textbook_id");

-- CreateIndex
CREATE INDEX "problems_grade_level_subject_unit_major_idx" ON "ocr"."problems"("grade_level", "subject", "unit_major");

-- CreateIndex
CREATE INDEX "problems_review_status_idx" ON "ocr"."problems"("review_status");

-- CreateIndex
CREATE INDEX "problems_analysis_status_idx" ON "ocr"."problems"("analysis_status");

-- CreateIndex
CREATE UNIQUE INDEX "problem_choices_problem_id_position_key" ON "ocr"."problem_choices"("problem_id", "position");

-- CreateIndex
CREATE INDEX "problem_assets_problem_id_kind_idx" ON "ocr"."problem_assets"("problem_id", "kind");

-- CreateIndex
CREATE INDEX "problem_similarities_problem_id_idx" ON "ocr"."problem_similarities"("problem_id");

-- CreateIndex
CREATE UNIQUE INDEX "problem_similarities_problem_id_similar_problem_id_key" ON "ocr"."problem_similarities"("problem_id", "similar_problem_id");

-- AddForeignKey
ALTER TABLE "ocr"."ocr_jobs" ADD CONSTRAINT "ocr_jobs_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "ocr"."source_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr"."problems" ADD CONSTRAINT "problems_ocr_job_id_fkey" FOREIGN KEY ("ocr_job_id") REFERENCES "ocr"."ocr_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr"."problems" ADD CONSTRAINT "problems_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ocr"."problems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr"."problem_choices" ADD CONSTRAINT "problem_choices_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "ocr"."problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr"."problem_assets" ADD CONSTRAINT "problem_assets_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "ocr"."problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
