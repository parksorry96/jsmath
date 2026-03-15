-- Backfill existing rows
UPDATE ocr.problems
SET stem_tsv = to_tsvector('simple',
  COALESCE(stem_text, '') || ' ' ||
  COALESCE(subject, '') || ' ' ||
  COALESCE(unit_major, '') || ' ' ||
  COALESCE(unit_minor, '') || ' ' ||
  COALESCE(answer_text, '')
)
WHERE stem_tsv IS NULL;

-- Auto-update trigger
CREATE OR REPLACE FUNCTION ocr.update_stem_tsv() RETURNS trigger AS $$
BEGIN
  NEW.stem_tsv := to_tsvector('simple',
    COALESCE(NEW.stem_text, '') || ' ' ||
    COALESCE(NEW.subject, '') || ' ' ||
    COALESCE(NEW.unit_major, '') || ' ' ||
    COALESCE(NEW.unit_minor, '') || ' ' ||
    COALESCE(NEW.answer_text, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_problems_stem_tsv
  BEFORE INSERT OR UPDATE OF stem_text, subject, unit_major, unit_minor, answer_text
  ON ocr.problems
  FOR EACH ROW EXECUTE FUNCTION ocr.update_stem_tsv();
