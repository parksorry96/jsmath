-- Phase 3: AI Enhancement Schema Changes

-- 1. SmartScore fields on submissions
ALTER TABLE "submissions" ADD COLUMN "smart_score" DOUBLE PRECISION;
ALTER TABLE "submissions" ADD COLUMN "smart_score_meta" JSONB;

-- 2. Rubric fields on submission_answers
ALTER TABLE "submission_answers" ADD COLUMN "rubric_result" JSONB;
ALTER TABLE "submission_answers" ADD COLUMN "rubric_score" DOUBLE PRECISION;
ALTER TABLE "submission_answers" ADD COLUMN "rubric_version" INTEGER;

-- 3. DiagnosticStatus enum
CREATE TYPE "DiagnosticStatus" AS ENUM ('in_progress', 'completed', 'abandoned');

-- 4. DiagnosticSession table
CREATE TABLE "diagnostic_sessions" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "status" "DiagnosticStatus" NOT NULL DEFAULT 'in_progress',
    "current_ability" JSONB,
    "result" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagnostic_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "diagnostic_sessions_student_id_idx" ON "diagnostic_sessions"("student_id");

ALTER TABLE "diagnostic_sessions" ADD CONSTRAINT "diagnostic_sessions_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. DiagnosticResponse table
CREATE TABLE "diagnostic_responses" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "problem_id" TEXT NOT NULL,
    "student_answer" TEXT,
    "is_correct" BOOLEAN,
    "response_time_sec" INTEGER,
    "ability_before" DOUBLE PRECISION,
    "ability_after" DOUBLE PRECISION,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnostic_responses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "diagnostic_responses_session_id_problem_id_key" ON "diagnostic_responses"("session_id", "problem_id");
CREATE INDEX "diagnostic_responses_session_id_idx" ON "diagnostic_responses"("session_id");

ALTER TABLE "diagnostic_responses" ADD CONSTRAINT "diagnostic_responses_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "diagnostic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. CurriculumPrerequisite table
CREATE TABLE "curriculum_prerequisites" (
    "id" TEXT NOT NULL,
    "from_subject" TEXT NOT NULL,
    "from_unit" TEXT NOT NULL,
    "to_subject" TEXT NOT NULL,
    "to_unit" TEXT NOT NULL,
    "strength" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "curriculum_prerequisites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "curriculum_prerequisites_from_subject_from_unit_to_subject_to_unit_key"
    ON "curriculum_prerequisites"("from_subject", "from_unit", "to_subject", "to_unit");
CREATE INDEX "curriculum_prerequisites_to_subject_to_unit_idx"
    ON "curriculum_prerequisites"("to_subject", "to_unit");

-- 7. TutorStatus and MessageRole enums
CREATE TYPE "TutorStatus" AS ENUM ('active', 'resolved', 'abandoned');
CREATE TYPE "MessageRole" AS ENUM ('student', 'tutor');

-- 8. TutorSession table
CREATE TABLE "tutor_sessions" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "problem_id" TEXT NOT NULL,
    "status" "TutorStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tutor_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tutor_sessions_student_id_idx" ON "tutor_sessions"("student_id");
CREATE INDEX "tutor_sessions_problem_id_idx" ON "tutor_sessions"("problem_id");

ALTER TABLE "tutor_sessions" ADD CONSTRAINT "tutor_sessions_student_id_fkey"
    FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 9. TutorMessage table
CREATE TABLE "tutor_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tutor_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tutor_messages_session_id_created_at_idx" ON "tutor_messages"("session_id", "created_at");

ALTER TABLE "tutor_messages" ADD CONSTRAINT "tutor_messages_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "tutor_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
