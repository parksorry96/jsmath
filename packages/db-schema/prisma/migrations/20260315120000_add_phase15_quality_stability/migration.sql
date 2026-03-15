-- Phase 1.5: Quality & Stability Layer

-- Extend ReviewStatus enum
ALTER TYPE "ocr"."ReviewStatus" ADD VALUE IF NOT EXISTS 'calibrated';
ALTER TYPE "ocr"."ReviewStatus" ADD VALUE IF NOT EXISTS 'flagged';
ALTER TYPE "ocr"."ReviewStatus" ADD VALUE IF NOT EXISTS 'retired';

-- RevisionChangeType enum
CREATE TYPE "ocr"."RevisionChangeType" AS ENUM ('content_edit', 'metadata_edit', 'review_action', 'ai_correction');

-- ProblemUsageType enum
CREATE TYPE "public"."ProblemUsageType" AS ENUM ('assignment', 'exam_document', 'diagnostic');

-- Add quality gate fields to Problem
ALTER TABLE "ocr"."problems"
  ADD COLUMN IF NOT EXISTS "flag_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "retired_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "retired_by" TEXT;

-- ProblemRevision
CREATE TABLE "ocr"."problem_revisions" (
  "id" TEXT NOT NULL,
  "problem_id" TEXT NOT NULL,
  "revision_number" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "change_type" "ocr"."RevisionChangeType" NOT NULL,
  "changed_fields" TEXT[],
  "change_summary" TEXT,
  "changed_by_id" TEXT NOT NULL,
  "changed_by_role" TEXT NOT NULL,
  "change_source" TEXT NOT NULL DEFAULT 'manual',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "problem_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "problem_revisions_problem_id_revision_number_key" ON "ocr"."problem_revisions"("problem_id", "revision_number");
CREATE INDEX "problem_revisions_problem_id_revision_number_idx" ON "ocr"."problem_revisions"("problem_id", "revision_number");
CREATE INDEX "problem_revisions_changed_by_id_idx" ON "ocr"."problem_revisions"("changed_by_id");

-- ProblemUsageLog
CREATE TABLE "public"."problem_usage_logs" (
  "id" TEXT NOT NULL,
  "problem_id" TEXT NOT NULL,
  "usage_type" "public"."ProblemUsageType" NOT NULL,
  "reference_id" TEXT NOT NULL,
  "reference_type" TEXT NOT NULL,
  "class_id" TEXT,
  "target_count" INTEGER,
  "used_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "used_by_user_id" TEXT NOT NULL,
  CONSTRAINT "problem_usage_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "problem_usage_logs_problem_id_used_at_idx" ON "public"."problem_usage_logs"("problem_id", "used_at");
CREATE INDEX "problem_usage_logs_problem_id_class_id_idx" ON "public"."problem_usage_logs"("problem_id", "class_id");
CREATE INDEX "problem_usage_logs_class_id_used_at_idx" ON "public"."problem_usage_logs"("class_id", "used_at");

-- ProblemStatistics
CREATE TABLE "ocr"."problem_statistics" (
  "id" TEXT NOT NULL,
  "problem_id" TEXT NOT NULL,
  "period_start" TIMESTAMPTZ,
  "period_end" TIMESTAMPTZ,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "correct_count" INTEGER NOT NULL DEFAULT 0,
  "p_value" DOUBLE PRECISION,
  "avg_score_ratio" DOUBLE PRECISION,
  "discrimination_index" DOUBLE PRECISION,
  "point_biserial_r" DOUBLE PRECISION,
  "avg_time_sec" DOUBLE PRECISION,
  "median_time_sec" DOUBLE PRECISION,
  "is_sufficient_n" BOOLEAN NOT NULL DEFAULT false,
  "last_computed_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "problem_statistics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "problem_statistics_problem_id_key" ON "ocr"."problem_statistics"("problem_id");
CREATE INDEX "problem_statistics_problem_id_idx" ON "ocr"."problem_statistics"("problem_id");
CREATE INDEX "problem_statistics_last_computed_at_idx" ON "ocr"."problem_statistics"("last_computed_at");

-- ChoiceStatistics
CREATE TABLE "ocr"."choice_statistics" (
  "id" TEXT NOT NULL,
  "problem_id" TEXT NOT NULL,
  "choice_position" INTEGER NOT NULL,
  "select_count" INTEGER NOT NULL DEFAULT 0,
  "select_rate" DOUBLE PRECISION,
  "last_computed_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "choice_statistics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "choice_statistics_problem_id_choice_position_key" ON "ocr"."choice_statistics"("problem_id", "choice_position");
CREATE INDEX "choice_statistics_problem_id_idx" ON "ocr"."choice_statistics"("problem_id");

-- LearningEvent
CREATE TABLE "public"."learning_events" (
  "id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "student_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "problem_id" TEXT,
  "assignment_id" TEXT,
  "organization_id" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "client_ts" TIMESTAMPTZ NOT NULL,
  "server_ts" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "device_type" TEXT,
  "app_version" TEXT,
  "ip_hash" TEXT,
  CONSTRAINT "learning_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "learning_events_student_id_server_ts_idx" ON "public"."learning_events"("student_id", "server_ts");
CREATE INDEX "learning_events_session_id_idx" ON "public"."learning_events"("session_id");
CREATE INDEX "learning_events_event_type_server_ts_idx" ON "public"."learning_events"("event_type", "server_ts");
CREATE INDEX "learning_events_assignment_id_student_id_idx" ON "public"."learning_events"("assignment_id", "student_id");
CREATE INDEX "learning_events_organization_id_server_ts_idx" ON "public"."learning_events"("organization_id", "server_ts");

-- LearningEventDailyStat
CREATE TABLE "public"."learning_event_daily_stats" (
  "id" TEXT NOT NULL,
  "student_id" TEXT NOT NULL,
  "stat_date" DATE NOT NULL,
  "problems_viewed" INTEGER NOT NULL DEFAULT 0,
  "problems_started" INTEGER NOT NULL DEFAULT 0,
  "problems_solved" INTEGER NOT NULL DEFAULT 0,
  "problems_correct" INTEGER NOT NULL DEFAULT 0,
  "hints_used" INTEGER NOT NULL DEFAULT 0,
  "total_duration_ms" BIGINT NOT NULL DEFAULT 0,
  "session_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "learning_event_daily_stats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "learning_event_daily_stats_student_id_stat_date_key" ON "public"."learning_event_daily_stats"("student_id", "stat_date");
CREATE INDEX "learning_event_daily_stats_student_id_stat_date_idx" ON "public"."learning_event_daily_stats"("student_id", "stat_date" DESC);
