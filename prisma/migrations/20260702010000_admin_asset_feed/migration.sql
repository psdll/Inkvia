CREATE TABLE "AdminAssetFeed" (
  "id" SERIAL NOT NULL,
  "generationId" INTEGER NOT NULL,
  "userId" TEXT NOT NULL,
  "authUserId" INTEGER,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "mediaKind" TEXT NOT NULL,
  "thumbUrl" TEXT,
  "displayUrl" TEXT,
  "previewUrl" TEXT,
  "posterUrl" TEXT,
  "localPath" TEXT,
  "outputPaths" JSONB NOT NULL DEFAULT '[]',
  "inputMaterials" JSONB NOT NULL DEFAULT '[]',
  "errorMsg" TEXT,
  "externalTaskId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdminAssetFeed_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminAssetFeed_generationId_key" ON "AdminAssetFeed"("generationId");
CREATE INDEX "AdminAssetFeed_generationId_idx" ON "AdminAssetFeed"("generationId");
CREATE INDEX "AdminAssetFeed_createdAt_id_idx" ON "AdminAssetFeed"("createdAt" DESC, "id" DESC);
CREATE INDEX "AdminAssetFeed_authUserId_updatedAt_id_idx" ON "AdminAssetFeed"("authUserId", "updatedAt", "id");
CREATE INDEX "AdminAssetFeed_userId_updatedAt_id_idx" ON "AdminAssetFeed"("userId", "updatedAt", "id");
CREATE INDEX "AdminAssetFeed_authUserId_type_createdAt_id_idx" ON "AdminAssetFeed"("authUserId", "type", "createdAt" DESC, "id" DESC) WHERE "authUserId" IS NOT NULL;
CREATE INDEX "AdminAssetFeed_guest_userId_type_createdAt_id_idx" ON "AdminAssetFeed"("userId", "type", "createdAt" DESC, "id" DESC) WHERE "authUserId" IS NULL;
