-- CreateTable
CREATE TABLE "public"."legacy_grade_cutoffs" (
    "id" TEXT NOT NULL,
    "exam_year" INTEGER NOT NULL,
    "exam_month" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "display_score" INTEGER NOT NULL,
    "standard_score" INTEGER NOT NULL,
    "percentile" DOUBLE PRECISION,
    "top_display_score" INTEGER,
    "top_standard_score" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'ebsi_hidden_legacy',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legacy_grade_cutoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legacy_grade_cutoffs_exam_year_exam_month_subject_idx"
ON "public"."legacy_grade_cutoffs"("exam_year", "exam_month", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_grade_cutoffs_exam_year_exam_month_subject_grade_key"
ON "public"."legacy_grade_cutoffs"("exam_year", "exam_month", "subject", "grade");
