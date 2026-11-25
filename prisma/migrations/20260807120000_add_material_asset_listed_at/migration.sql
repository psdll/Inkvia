ALTER TABLE "MaterialAsset" ADD COLUMN "listedAt" TIMESTAMP(3);

CREATE INDEX "MaterialAsset_isDeleted_selectedByUserId_listedAt_idx"
ON "MaterialAsset"("isDeleted", "selectedByUserId", "listedAt");
