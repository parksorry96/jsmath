-- CreateTable
CREATE TABLE "ocr"."curriculum_nodes" (
    "id" UUID NOT NULL,
    "curriculum_year" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parent_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "grade_level" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "curriculum_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_nodes_curriculum_year_code_key" ON "ocr"."curriculum_nodes"("curriculum_year", "code");

-- CreateIndex
CREATE INDEX "curriculum_nodes_curriculum_year_level_idx" ON "ocr"."curriculum_nodes"("curriculum_year", "level");

-- CreateIndex
CREATE INDEX "curriculum_nodes_parent_id_idx" ON "ocr"."curriculum_nodes"("parent_id");

-- AlterTable
ALTER TABLE "ocr"."problems" ADD COLUMN "curriculum_node_id" UUID;

-- CreateIndex
CREATE INDEX "problems_curriculum_node_id_idx" ON "ocr"."problems"("curriculum_node_id");

-- AddForeignKey
ALTER TABLE "ocr"."problems" ADD CONSTRAINT "problems_curriculum_node_id_fkey" FOREIGN KEY ("curriculum_node_id") REFERENCES "ocr"."curriculum_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ocr"."curriculum_nodes" ADD CONSTRAINT "curriculum_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ocr"."curriculum_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
