-- Phase 1.5 P2+P3: Blueprints + Pipeline Checkpoints

-- ExamDocument blueprint fields
ALTER TABLE "public"."exam_documents"
  ADD COLUMN IF NOT EXISTS "blueprint_id" TEXT,
  ADD COLUMN IF NOT EXISTS "generation_id" TEXT;

-- ExamBlueprint
CREATE TABLE "public"."exam_blueprints" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "creator_id" TEXT NOT NULL,
  "grade_level" TEXT,
  "total_questions" INTEGER NOT NULL,
  "total_points" INTEGER,
  "time_limit_min" INTEGER,
  "unit_distribution" JSONB NOT NULL,
  "difficulty_distribution" JSONB NOT NULL,
  "type_distribution" JSONB NOT NULL,
  "point_distribution" JSONB,
  "exclude_recent_days" INTEGER,
  "exclude_problem_ids" JSONB,
  "is_template" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "exam_blueprints_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "exam_blueprints_creator_id_idx" ON "public"."exam_blueprints"("creator_id");

-- BlueprintGeneration
CREATE TABLE "public"."blueprint_generations" (
  "id" TEXT NOT NULL,
  "blueprint_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "selected_ids" JSONB,
  "match_score" DOUBLE PRECISION,
  "relaxations" JSONB,
  "error_message" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "blueprint_generations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "blueprint_generations_blueprint_id_fkey" FOREIGN KEY ("blueprint_id") REFERENCES "public"."exam_blueprints"("id") ON DELETE CASCADE
);
CREATE INDEX "blueprint_generations_blueprint_id_idx" ON "public"."blueprint_generations"("blueprint_id");

-- PipelineCheckpoint
CREATE TABLE "ocr"."pipeline_checkpoints" (
  "id" TEXT NOT NULL,
  "ocr_job_id" TEXT NOT NULL,
  "stage_name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "payload" JSONB,
  "error_message" TEXT,
  "started_at" TIMESTAMPTZ NOT NULL,
  "completed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pipeline_checkpoints_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pipeline_checkpoints_ocr_job_id_stage_name_key" ON "ocr"."pipeline_checkpoints"("ocr_job_id", "stage_name");
CREATE INDEX "pipeline_checkpoints_ocr_job_id_idx" ON "ocr"."pipeline_checkpoints"("ocr_job_id");
