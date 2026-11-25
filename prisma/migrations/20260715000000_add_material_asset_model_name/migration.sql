ALTER TABLE "MaterialAsset" ADD COLUMN "modelName" TEXT;

CREATE INDEX "MaterialAsset_modelName_idx" ON "MaterialAsset"("modelName");
