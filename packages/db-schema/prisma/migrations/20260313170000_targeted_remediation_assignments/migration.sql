-- AlterTable: assignments
ALTER TABLE "assignments"
ADD COLUMN "target_student_id" TEXT;

-- CreateIndex
CREATE INDEX "assignments_target_student_id_idx"
ON "assignments"("target_student_id");

-- AddForeignKey
ALTER TABLE "assignments"
ADD CONSTRAINT "assignments_target_student_id_fkey"
FOREIGN KEY ("target_student_id") REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
