ALTER TABLE "Template" ADD COLUMN "category" TEXT;
CREATE INDEX "Template_category_createdAt_id_idx" ON "Template"("category", "createdAt", "id");
