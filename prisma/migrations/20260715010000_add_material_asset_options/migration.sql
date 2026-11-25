-- Candidate values are independent from uploaded material metadata. Deleting a
-- candidate later must not change any MaterialAsset row.
CREATE TABLE "MaterialAssetOption" (
  "id" SERIAL NOT NULL,
  "kind" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MaterialAssetOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaterialAssetOption_kind_value_key" ON "MaterialAssetOption"("kind", "value");
CREATE INDEX "MaterialAssetOption_kind_value_idx" ON "MaterialAssetOption"("kind", "value");

-- Historical MaterialAsset rows are exposed through a read-only application
-- fallback. This migration intentionally leaves MaterialAssetOption empty.
