ALTER TABLE "ocr"."problems"
  ADD COLUMN IF NOT EXISTS "solution_confidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "review_confidence" DOUBLE PRECISION;
