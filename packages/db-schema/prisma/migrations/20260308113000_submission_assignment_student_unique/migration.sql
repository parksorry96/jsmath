WITH ranked_submissions AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY assignment_id, student_id
      ORDER BY submitted_at DESC, created_at DESC, id DESC
    ) AS row_num
  FROM "public"."submissions"
)
DELETE FROM "public"."submission_answers" AS answers
USING ranked_submissions
WHERE answers.submission_id = ranked_submissions.id
  AND ranked_submissions.row_num > 1;

WITH ranked_submissions AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY assignment_id, student_id
      ORDER BY submitted_at DESC, created_at DESC, id DESC
    ) AS row_num
  FROM "public"."submissions"
)
DELETE FROM "public"."submission_photos" AS photos
USING ranked_submissions
WHERE photos.submission_id = ranked_submissions.id
  AND ranked_submissions.row_num > 1;

WITH ranked_submissions AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY assignment_id, student_id
      ORDER BY submitted_at DESC, created_at DESC, id DESC
    ) AS row_num
  FROM "public"."submissions"
)
DELETE FROM "public"."submissions" AS submissions
USING ranked_submissions
WHERE submissions.id = ranked_submissions.id
  AND ranked_submissions.row_num > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "submissions_assignment_id_student_id_key"
ON "public"."submissions"("assignment_id", "student_id");
