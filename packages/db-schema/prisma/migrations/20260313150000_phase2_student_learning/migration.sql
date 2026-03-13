-- CreateEnum
CREATE TYPE "ErrorType" AS ENUM ('concept_gap', 'pattern_gap', 'calculation_error', 'careless_mistake');

-- CreateEnum
CREATE TYPE "MasteryState" AS ENUM ('not_started', 'learning', 'practicing', 'mastered');

-- AlterEnum
ALTER TYPE "AssignmentType" ADD VALUE 'remediation';

-- AlterTable: Add source_assignment_id to assignments
ALTER TABLE "assignments" ADD COLUMN "source_assignment_id" TEXT;

-- AlterTable: Add alternative_solutions to problems (ocr schema)
ALTER TABLE "ocr"."problems" ADD COLUMN "alternative_solutions" JSONB;

-- CreateTable: wrong_answers
CREATE TABLE "wrong_answers" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "problem_id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "error_type" "ErrorType" NOT NULL,
    "note" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_retry_correct" BOOLEAN,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wrong_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: student_masteries
CREATE TABLE "student_masteries" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "curriculum_node_id" TEXT NOT NULL,
    "state" "MasteryState" NOT NULL DEFAULT 'not_started',
    "consecutive_correct" INTEGER NOT NULL DEFAULT 0,
    "total_attempts" INTEGER NOT NULL DEFAULT 0,
    "total_correct" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "mastered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_masteries_pkey" PRIMARY KEY ("id")
);

-- CreateTable: review_schedules
CREATE TABLE "review_schedules" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "wrong_answer_id" TEXT NOT NULL,
    "problem_id" TEXT NOT NULL,
    "next_review_at" TIMESTAMP(3) NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "ease_factor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "last_reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: wrong_answers
CREATE INDEX "wrong_answers_student_id_error_type_idx" ON "wrong_answers"("student_id", "error_type");
CREATE INDEX "wrong_answers_student_id_resolved_at_idx" ON "wrong_answers"("student_id", "resolved_at");
CREATE UNIQUE INDEX "wrong_answers_student_id_problem_id_submission_id_key" ON "wrong_answers"("student_id", "problem_id", "submission_id");

-- CreateIndex: student_masteries
CREATE INDEX "student_masteries_student_id_state_idx" ON "student_masteries"("student_id", "state");
CREATE UNIQUE INDEX "student_masteries_student_id_curriculum_node_id_key" ON "student_masteries"("student_id", "curriculum_node_id");

-- CreateIndex: review_schedules
CREATE UNIQUE INDEX "review_schedules_wrong_answer_id_key" ON "review_schedules"("wrong_answer_id");
CREATE INDEX "review_schedules_student_id_next_review_at_idx" ON "review_schedules"("student_id", "next_review_at");
CREATE INDEX "review_schedules_next_review_at_idx" ON "review_schedules"("next_review_at");

-- AddForeignKey: wrong_answers
ALTER TABLE "wrong_answers" ADD CONSTRAINT "wrong_answers_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: student_masteries
ALTER TABLE "student_masteries" ADD CONSTRAINT "student_masteries_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: review_schedules
ALTER TABLE "review_schedules" ADD CONSTRAINT "review_schedules_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "review_schedules" ADD CONSTRAINT "review_schedules_wrong_answer_id_fkey" FOREIGN KEY ("wrong_answer_id") REFERENCES "wrong_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
