ALTER TABLE "ocr"."problems"
  ADD COLUMN IF NOT EXISTS "bbox" JSONB,
  ADD COLUMN IF NOT EXISTS "stem_tsv" TSVECTOR,
  ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

CREATE INDEX IF NOT EXISTS "problems_stem_tsv_idx"
  ON "ocr"."problems"
  USING GIN ("stem_tsv");

CREATE INDEX IF NOT EXISTS "problems_embedding_idx"
  ON "ocr"."problems"
  USING HNSW ("embedding" vector_cosine_ops)
  WITH ("m" = 16, "ef_construction" = 64);
