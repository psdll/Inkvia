CREATE TABLE IF NOT EXISTS "MaterialAssetSelectionEvent" (
  "id" SERIAL PRIMARY KEY,
  "assetId" INTEGER NOT NULL,
  "userId" INTEGER,
  "username" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "operatorUsername" TEXT,
  "assetTitle" TEXT,
  "assetCategory" TEXT,
  "assetImageUrl" TEXT,
  "assetThumbnailUrl" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialAssetSelectionEvent_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "MaterialAsset"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MaterialAssetSelectionEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "MaterialAssetSelectionEvent_assetId_occurredAt_idx"
  ON "MaterialAssetSelectionEvent"("assetId", "occurredAt");

CREATE INDEX IF NOT EXISTS "MaterialAssetSelectionEvent_userId_occurredAt_idx"
  ON "MaterialAssetSelectionEvent"("userId", "occurredAt");

CREATE INDEX IF NOT EXISTS "MaterialAssetSelectionEvent_action_occurredAt_idx"
  ON "MaterialAssetSelectionEvent"("action", "occurredAt");
