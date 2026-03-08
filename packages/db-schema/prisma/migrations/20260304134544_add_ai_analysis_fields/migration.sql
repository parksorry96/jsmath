-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'teacher', 'student');

-- CreateEnum
CREATE TYPE "OcrJobStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'manual_review');

-- CreateEnum
CREATE TYPE "ProblemType" AS ENUM ('multiple_choice', 'short_answer', 'written_solution', 'essay');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('auto_approved', 'pending_review', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'student',
    "organization_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "organization_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'student',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "course_id" TEXT NOT NULL,
    "due_at" TIMESTAMP(3),
    "max_score" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_files" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ocr_jobs" (
    "id" TEXT NOT NULL,
    "source_file_id" TEXT NOT NULL,
    "status" "OcrJobStatus" NOT NULL DEFAULT 'pending',
    "problem_count" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "ocr_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problems" (
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
    "problem_type" "ProblemType" NOT NULL,
    "answer_text" TEXT,
    "answer_latex" TEXT,
    "grade_level" TEXT,
    "subject" TEXT,
    "unit_major" TEXT,
    "unit_minor" TEXT,
    "unit_sub" TEXT,
    "difficulty" SMALLINT,
    "classification_confidence" DOUBLE PRECISION,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'pending_review',
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
CREATE TABLE "problem_choices" (
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
CREATE TABLE "problem_assets" (
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
CREATE TABLE "problem_similarities" (
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
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_user_id_course_id_key" ON "enrollments"("user_id", "course_id");

-- CreateIndex
CREATE INDEX "assignments_course_id_idx" ON "assignments"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_files_file_hash_key" ON "source_files"("file_hash");

-- CreateIndex
CREATE INDEX "ocr_jobs_status_created_at_idx" ON "ocr_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "problems_ocr_job_id_idx" ON "problems"("ocr_job_id");

-- CreateIndex
CREATE INDEX "problems_textbook_id_idx" ON "problems"("textbook_id");

-- CreateIndex
CREATE INDEX "problems_grade_level_subject_unit_major_idx" ON "problems"("grade_level", "subject", "unit_major");

-- CreateIndex
CREATE INDEX "problems_review_status_idx" ON "problems"("review_status");

-- CreateIndex
CREATE UNIQUE INDEX "problem_choices_problem_id_position_key" ON "problem_choices"("problem_id", "position");

-- CreateIndex
CREATE INDEX "problem_assets_problem_id_kind_idx" ON "problem_assets"("problem_id", "kind");

-- CreateIndex
CREATE INDEX "problem_similarities_problem_id_idx" ON "problem_similarities"("problem_id");

-- CreateIndex
CREATE UNIQUE INDEX "problem_similarities_problem_id_similar_problem_id_key" ON "problem_similarities"("problem_id", "similar_problem_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr_jobs" ADD CONSTRAINT "ocr_jobs_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "source_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problems" ADD CONSTRAINT "problems_ocr_job_id_fkey" FOREIGN KEY ("ocr_job_id") REFERENCES "ocr_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problems" ADD CONSTRAINT "problems_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "problems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_choices" ADD CONSTRAINT "problem_choices_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_assets" ADD CONSTRAINT "problem_assets_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
