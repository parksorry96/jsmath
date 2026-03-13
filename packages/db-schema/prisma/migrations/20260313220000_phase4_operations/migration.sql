-- Phase 4: Operations & Expansion
-- Adds: ParentWeeklyReport, GradeCutoff, StudentStreak, StudentAchievement, Attendance, BillingRecord, LtiPlatform
-- Adds: xp/level fields to users table

-- ─── Enums ───

CREATE TYPE "public"."AttendanceStatus" AS ENUM ('present', 'absent', 'late', 'excused');
CREATE TYPE "public"."BillingType" AS ENUM ('tuition', 'material', 'extra_class', 'other');
CREATE TYPE "public"."BillingStatus" AS ENUM ('pending', 'paid', 'overdue', 'cancelled');

-- ─── User XP/Level Fields ───

ALTER TABLE "public"."users" ADD COLUMN "xp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "public"."users" ADD COLUMN "level" INTEGER NOT NULL DEFAULT 1;

-- ─── ParentWeeklyReport ───

CREATE TABLE "public"."parent_weekly_reports" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "week_end" TIMESTAMP(3) NOT NULL,
    "assignment_completion_rate" DOUBLE PRECISION NOT NULL,
    "avg_score" DOUBLE PRECISION,
    "problems_solved" INTEGER NOT NULL,
    "correct_rate" DOUBLE PRECISION,
    "lessons_attended" INTEGER NOT NULL,
    "lessons_total" INTEGER NOT NULL,
    "mastery_progress" JSONB,
    "weakness_heatmap" JSONB,
    "score_trend" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_weekly_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "parent_weekly_reports_parent_id_week_start_idx" ON "public"."parent_weekly_reports"("parent_id", "week_start");
CREATE INDEX "parent_weekly_reports_student_id_idx" ON "public"."parent_weekly_reports"("student_id");
CREATE UNIQUE INDEX "parent_weekly_reports_parent_id_student_id_week_start_key" ON "public"."parent_weekly_reports"("parent_id", "student_id", "week_start");

-- ─── GradeCutoff ───

CREATE TABLE "public"."grade_cutoffs" (
    "id" TEXT NOT NULL,
    "exam_year" INTEGER NOT NULL,
    "exam_month" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "min_score" INTEGER NOT NULL,
    "max_score" INTEGER NOT NULL,
    "percentile" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_cutoffs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "grade_cutoffs_exam_year_exam_month_subject_idx" ON "public"."grade_cutoffs"("exam_year", "exam_month", "subject");
CREATE UNIQUE INDEX "grade_cutoffs_exam_year_exam_month_subject_grade_key" ON "public"."grade_cutoffs"("exam_year", "exam_month", "subject", "grade");

-- ─── StudentStreak ───

CREATE TABLE "public"."student_streaks" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "streak_type" TEXT NOT NULL,
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "longest_streak" INTEGER NOT NULL DEFAULT 0,
    "last_activity_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_streaks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_streaks_student_id_streak_type_key" ON "public"."student_streaks"("student_id", "streak_type");

ALTER TABLE "public"."student_streaks" ADD CONSTRAINT "student_streaks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── StudentAchievement ───

CREATE TABLE "public"."student_achievements" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "achievement_key" TEXT NOT NULL,
    "metadata" JSONB,
    "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_achievements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "student_achievements_student_id_idx" ON "public"."student_achievements"("student_id");
CREATE UNIQUE INDEX "student_achievements_student_id_achievement_key_key" ON "public"."student_achievements"("student_id", "achievement_key");

ALTER TABLE "public"."student_achievements" ADD CONSTRAINT "student_achievements_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Attendance ───

CREATE TABLE "public"."attendances" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "public"."AttendanceStatus" NOT NULL DEFAULT 'present',
    "note" TEXT,
    "checked_in_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendances_class_id_date_idx" ON "public"."attendances"("class_id", "date");
CREATE INDEX "attendances_student_id_date_idx" ON "public"."attendances"("student_id", "date");
CREATE UNIQUE INDEX "attendances_student_id_class_id_date_key" ON "public"."attendances"("student_id", "class_id", "date");

ALTER TABLE "public"."attendances" ADD CONSTRAINT "attendances_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "public"."attendances" ADD CONSTRAINT "attendances_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── BillingRecord ───

CREATE TABLE "public"."billing_records" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "class_id" TEXT,
    "type" "public"."BillingType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "description" TEXT,
    "billing_month" TIMESTAMP(3) NOT NULL,
    "status" "public"."BillingStatus" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "billing_records_student_id_billing_month_idx" ON "public"."billing_records"("student_id", "billing_month");
CREATE INDEX "billing_records_status_idx" ON "public"."billing_records"("status");

ALTER TABLE "public"."billing_records" ADD CONSTRAINT "billing_records_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── LtiPlatform ───

CREATE TABLE "public"."lti_platforms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "auth_endpoint" TEXT NOT NULL,
    "token_endpoint" TEXT NOT NULL,
    "jwks_uri" TEXT NOT NULL,
    "deployment_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lti_platforms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lti_platforms_issuer_key" ON "public"."lti_platforms"("issuer");
