CREATE TABLE "MediaAsset" (
  "id" UUID NOT NULL,
  "ownerUserId" INTEGER,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'initiated',
  "originalName" VARCHAR(512),
  "declaredMime" VARCHAR(128),
  "detectedMime" VARCHAR(128),
  "sizeBytes" BIGINT,
  "checksumSha256" CHAR(64),
  "storageProvider" TEXT NOT NULL DEFAULT 'local',
  "quarantineKey" TEXT,
  "originalKey" TEXT,
  "publicUrl" TEXT,
  "variants" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "failureCode" VARCHAR(128),
  "failureMessage" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseOwner" VARCHAR(256),
  "leaseUntil" TIMESTAMP(3),
  "referenceCount" INTEGER NOT NULL DEFAULT 0,
  "retentionUntil" TIMESTAMP(3),
  "softDeletedAt" TIMESTAMP(3),
  "purgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MediaAsset_status_check" CHECK ("status" IN (
    'initiated', 'uploaded', 'quarantined', 'scanning', 'processing',
    'ready', 'failed', 'soft_deleted', 'purging', 'purged'
  )),
  CONSTRAINT "MediaAsset_referenceCount_check" CHECK ("referenceCount" >= 0),
  CONSTRAINT "MediaAsset_sizeBytes_check" CHECK ("sizeBytes" IS NULL OR "sizeBytes" >= 0)
);

CREATE TABLE "MediaReference" (
  "id" BIGSERIAL NOT NULL,
  "mediaId" UUID NOT NULL,
  "sourceType" VARCHAR(32) NOT NULL,
  "sourceId" VARCHAR(256) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaReference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MediaReference_sourceType_check" CHECK ("sourceType" IN (
    'canvas_current', 'canvas_snapshot', 'generation', 'library'
  ))
);

CREATE INDEX "MediaAsset_ownerUserId_createdAt_idx" ON "MediaAsset"("ownerUserId", "createdAt");
CREATE INDEX "MediaAsset_ownerUserId_checksumSha256_idx" ON "MediaAsset"("ownerUserId", "checksumSha256");
CREATE INDEX "MediaAsset_status_retentionUntil_idx" ON "MediaAsset"("status", "retentionUntil");
CREATE INDEX "MediaAsset_status_leaseUntil_idx" ON "MediaAsset"("status", "leaseUntil");
CREATE INDEX "MediaAsset_checksumSha256_idx" ON "MediaAsset"("checksumSha256");
CREATE UNIQUE INDEX "MediaReference_mediaId_sourceType_sourceId_key" ON "MediaReference"("mediaId", "sourceType", "sourceId");
CREATE INDEX "MediaReference_sourceType_sourceId_idx" ON "MediaReference"("sourceType", "sourceId");
CREATE INDEX "MediaReference_mediaId_sourceType_idx" ON "MediaReference"("mediaId", "sourceType");

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MediaReference" ADD CONSTRAINT "MediaReference_mediaId_fkey"
  FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
