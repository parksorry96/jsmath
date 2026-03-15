ALTER TABLE "ocr"."source_files"
ADD COLUMN IF NOT EXISTS "uploader_id" TEXT;

DROP INDEX IF EXISTS "ocr"."source_files_file_hash_key";

CREATE UNIQUE INDEX IF NOT EXISTS "source_files_uploader_id_file_hash_key"
ON "ocr"."source_files"("uploader_id", "file_hash");

CREATE INDEX IF NOT EXISTS "source_files_uploader_id_idx"
ON "ocr"."source_files"("uploader_id");
