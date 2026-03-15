ALTER TABLE "ocr"."problems"
  ADD COLUMN "classification_2015" JSONB,
  ADD COLUMN "classification_2022" JSONB;

UPDATE "ocr"."problems"
SET "classification_2015" = jsonb_build_object(
  'curriculumYear', 2015,
  'subject', "subject",
  'unitMajor', "unit_major",
  'unitMinor', "unit_minor",
  'unitSub', "unit_sub",
  'curriculumNodeId', CASE
    WHEN "curriculum_node_id" IS NULL THEN NULL
    ELSE "curriculum_node_id"::text
  END,
  'confidence', "classification_confidence"
)
WHERE "classification_2015" IS NULL
  AND (
    "subject" IS NOT NULL
    OR "unit_major" IS NOT NULL
    OR "unit_minor" IS NOT NULL
    OR "unit_sub" IS NOT NULL
    OR "curriculum_node_id" IS NOT NULL
    OR "classification_confidence" IS NOT NULL
  );
