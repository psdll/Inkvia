ALTER TABLE "MediaLibraryItem"
  DROP CONSTRAINT IF EXISTS "MediaLibraryItem_selectedByUserId_fkey";

DROP INDEX IF EXISTS "MediaLibraryItem_selectedByUserId_selectedAt_idx";
DROP INDEX IF EXISTS "MediaLibraryItem_scope_selectedByUserId_createdAt_idx";
DROP TABLE IF EXISTS "MediaLibraryDownload";

ALTER TABLE "MediaLibraryItem"
  DROP COLUMN IF EXISTS "selectedByUserId",
  DROP COLUMN IF EXISTS "selectedAt";

CREATE TABLE IF NOT EXISTS "MaterialAsset" (
  "id" SERIAL PRIMARY KEY,
  "category" TEXT,
  "title" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "thumbnailUrl" TEXT,
  "previewUrl" TEXT,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "tags" TEXT NOT NULL DEFAULT '[]',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" INTEGER,
  "selectedByUserId" INTEGER,
  "selectedAt" TIMESTAMP(3),
  "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialAsset_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MaterialAsset_selectedByUserId_fkey"
    FOREIGN KEY ("selectedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "MaterialAssetDownload" (
  "id" SERIAL PRIMARY KEY,
  "assetId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "username" TEXT NOT NULL,
  "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MaterialAssetDownload_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "MaterialAsset"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MaterialAssetDownload_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "MaterialAsset_category_createdAt_idx"
  ON "MaterialAsset"("category", "createdAt");
CREATE INDEX IF NOT EXISTS "MaterialAsset_isDeleted_category_createdAt_idx"
  ON "MaterialAsset"("isDeleted", "category", "createdAt");
CREATE INDEX IF NOT EXISTS "MaterialAsset_selectedByUserId_selectedAt_idx"
  ON "MaterialAsset"("selectedByUserId", "selectedAt");
CREATE INDEX IF NOT EXISTS "MaterialAsset_isDeleted_selectedByUserId_createdAt_idx"
  ON "MaterialAsset"("isDeleted", "selectedByUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "MaterialAsset_createdByUserId_createdAt_idx"
  ON "MaterialAsset"("createdByUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "MaterialAssetDownload_assetId_downloadedAt_idx"
  ON "MaterialAssetDownload"("assetId", "downloadedAt");
CREATE INDEX IF NOT EXISTS "MaterialAssetDownload_userId_downloadedAt_idx"
  ON "MaterialAssetDownload"("userId", "downloadedAt");
