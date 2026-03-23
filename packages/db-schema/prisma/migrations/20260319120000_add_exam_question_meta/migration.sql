-- CreateTable
CREATE TABLE "ocr"."exam_question_meta" (
    "id" TEXT NOT NULL,
    "exam_year" INTEGER NOT NULL,
    "exam_month" INTEGER NOT NULL,
    "exam_type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "question_number" INTEGER NOT NULL,
    "correct_answer" TEXT,
    "correct_rate" DOUBLE PRECISION,
    "point_value" SMALLINT,
    "choice_rates" JSONB,
    "is_common" BOOLEAN,
    "source" TEXT NOT NULL DEFAULT 'megastudy',
    "problem_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_question_meta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_question_meta_problem_id_idx" ON "ocr"."exam_question_meta"("problem_id");

-- CreateIndex
CREATE INDEX "exam_question_meta_exam_year_exam_month_subject_idx" ON "ocr"."exam_question_meta"("exam_year", "exam_month", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "exam_question_meta_exam_year_exam_month_exam_type_subject_q_key" ON "ocr"."exam_question_meta"("exam_year", "exam_month", "exam_type", "subject", "question_number");

-- AddForeignKey
ALTER TABLE "ocr"."exam_question_meta" ADD CONSTRAINT "exam_question_meta_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "ocr"."problems"("id") ON DELETE SET NULL ON UPDATE CASCADE;
