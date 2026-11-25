-- Long-term admin operations read models.
-- These tables are append/derive-only foundations for the admin v2 APIs.

CREATE TABLE "AdminEvent" (
    "id" SERIAL NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT,
    "authUserId" INTEGER,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminUserSummary" (
    "adminKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authUserId" INTEGER,
    "username" TEXT,
    "lastActiveAt" TIMESTAMP(3),
    "todayTaskCount" INTEGER NOT NULL DEFAULT 0,
    "last7TaskCount" INTEGER NOT NULL DEFAULT 0,
    "last30TaskCount" INTEGER NOT NULL DEFAULT 0,
    "totalTaskCount" INTEGER NOT NULL DEFAULT 0,
    "successRate30d" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failedCount30d" INTEGER NOT NULL DEFAULT 0,
    "storageBytes" BIGINT NOT NULL DEFAULT 0,
    "assetCount" INTEGER NOT NULL DEFAULT 0,
    "materialCount" INTEGER NOT NULL DEFAULT 0,
    "modelCost30d" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "deviceCount" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUserSummary_pkey" PRIMARY KEY ("adminKey")
);

CREATE TABLE "AdminWorkFeed" (
    "generationId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "authUserId" INTEGER,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "mediaKind" TEXT NOT NULL,
    "thumbUrl" TEXT,
    "previewUrl" TEXT,
    "displayUrl" TEXT,
    "posterUrl" TEXT,
    "sizeBytes" INTEGER,
    "errorCode" TEXT,
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AdminWorkFeed_pkey" PRIMARY KEY ("generationId")
);

CREATE TABLE "AdminMediaCatalog" (
    "mediaId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "userId" TEXT,
    "authUserId" INTEGER,
    "category" TEXT,
    "mimeType" TEXT,
    "mediaKind" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "thumbUrl" TEXT,
    "previewUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" INTEGER,
    "storageProvider" TEXT,
    "storageKey" TEXT,
    "selectedAt" TIMESTAMP(3),
    "archiveStatus" TEXT NOT NULL DEFAULT 'active',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminMediaCatalog_pkey" PRIMARY KEY ("mediaId")
);

CREATE TABLE "AdminDailyStats" (
    "id" SERIAL NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "authUserId" INTEGER,
    "userId" TEXT NOT NULL,
    "taskCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "uploadCount" INTEGER NOT NULL DEFAULT 0,
    "outputCount" INTEGER NOT NULL DEFAULT 0,
    "storageBytesDelta" BIGINT NOT NULL DEFAULT 0,
    "totalStorageBytes" BIGINT NOT NULL DEFAULT 0,
    "assetCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminDailyStats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminModelUsageDaily" (
    "id" SERIAL NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "authUserId" INTEGER,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "avgLatencyMs" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminModelUsageDaily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminStorageSnapshot" (
    "id" SERIAL NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scope" TEXT NOT NULL,
    "pathKey" TEXT NOT NULL,
    "authUserId" INTEGER,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" BIGINT NOT NULL DEFAULT 0,
    "largestFileBytes" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminStorageSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminJob" (
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT,
    "operator" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AdminJob_pkey" PRIMARY KEY ("jobId")
);

CREATE TABLE "AdminAuditLog" (
    "id" SERIAL NOT NULL,
    "operator" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminDailyStats_bucketKey_key" ON "AdminDailyStats"("bucketKey");
CREATE UNIQUE INDEX "AdminModelUsageDaily_bucketKey_key" ON "AdminModelUsageDaily"("bucketKey");

CREATE INDEX "AdminEvent_eventType_occurredAt_idx" ON "AdminEvent"("eventType", "occurredAt");
CREATE INDEX "AdminEvent_authUserId_occurredAt_idx" ON "AdminEvent"("authUserId", "occurredAt");
CREATE INDEX "AdminEvent_processedAt_id_idx" ON "AdminEvent"("processedAt", "id");
CREATE INDEX "AdminEvent_entityType_entityId_idx" ON "AdminEvent"("entityType", "entityId");

CREATE INDEX "AdminUserSummary_lastActiveAt_idx" ON "AdminUserSummary"("lastActiveAt");
CREATE INDEX "AdminUserSummary_authUserId_idx" ON "AdminUserSummary"("authUserId");
CREATE INDEX "AdminUserSummary_updatedAt_idx" ON "AdminUserSummary"("updatedAt");
CREATE INDEX "AdminUserSummary_storageBytes_idx" ON "AdminUserSummary"("storageBytes");
CREATE INDEX "AdminUserSummary_last30TaskCount_idx" ON "AdminUserSummary"("last30TaskCount");

CREATE INDEX "AdminWorkFeed_authUserId_createdAt_generationId_idx" ON "AdminWorkFeed"("authUserId", "createdAt", "generationId");
CREATE INDEX "AdminWorkFeed_authUserId_type_createdAt_generationId_idx" ON "AdminWorkFeed"("authUserId", "type", "createdAt", "generationId");
CREATE INDEX "AdminWorkFeed_authUserId_status_createdAt_generationId_idx" ON "AdminWorkFeed"("authUserId", "status", "createdAt", "generationId");
CREATE INDEX "AdminWorkFeed_userId_createdAt_generationId_idx" ON "AdminWorkFeed"("userId", "createdAt", "generationId");
CREATE INDEX "AdminWorkFeed_updatedAt_generationId_idx" ON "AdminWorkFeed"("updatedAt", "generationId");
CREATE INDEX "AdminWorkFeed_deletedAt_createdAt_idx" ON "AdminWorkFeed"("deletedAt", "createdAt");

CREATE INDEX "AdminMediaCatalog_authUserId_sourceType_createdAt_mediaId_idx" ON "AdminMediaCatalog"("authUserId", "sourceType", "createdAt", "mediaId");
CREATE INDEX "AdminMediaCatalog_authUserId_category_createdAt_mediaId_idx" ON "AdminMediaCatalog"("authUserId", "category", "createdAt", "mediaId");
CREATE INDEX "AdminMediaCatalog_archiveStatus_createdAt_idx" ON "AdminMediaCatalog"("archiveStatus", "createdAt");
CREATE INDEX "AdminMediaCatalog_updatedAt_mediaId_idx" ON "AdminMediaCatalog"("updatedAt", "mediaId");
CREATE INDEX "AdminMediaCatalog_sourceType_sourceId_idx" ON "AdminMediaCatalog"("sourceType", "sourceId");

CREATE INDEX "AdminDailyStats_day_idx" ON "AdminDailyStats"("day");
CREATE INDEX "AdminDailyStats_authUserId_day_idx" ON "AdminDailyStats"("authUserId", "day");
CREATE INDEX "AdminDailyStats_userId_day_idx" ON "AdminDailyStats"("userId", "day");

CREATE INDEX "AdminModelUsageDaily_day_idx" ON "AdminModelUsageDaily"("day");
CREATE INDEX "AdminModelUsageDaily_authUserId_day_idx" ON "AdminModelUsageDaily"("authUserId", "day");
CREATE INDEX "AdminModelUsageDaily_provider_model_day_idx" ON "AdminModelUsageDaily"("provider", "model", "day");
CREATE INDEX "AdminModelUsageDaily_module_day_idx" ON "AdminModelUsageDaily"("module", "day");

CREATE INDEX "AdminStorageSnapshot_snapshotAt_idx" ON "AdminStorageSnapshot"("snapshotAt");
CREATE INDEX "AdminStorageSnapshot_pathKey_idx" ON "AdminStorageSnapshot"("pathKey");
CREATE INDEX "AdminStorageSnapshot_authUserId_snapshotAt_idx" ON "AdminStorageSnapshot"("authUserId", "snapshotAt");
CREATE INDEX "AdminStorageSnapshot_scope_snapshotAt_idx" ON "AdminStorageSnapshot"("scope", "snapshotAt");

CREATE INDEX "AdminJob_type_status_createdAt_idx" ON "AdminJob"("type", "status", "createdAt");
CREATE INDEX "AdminJob_status_createdAt_idx" ON "AdminJob"("status", "createdAt");
CREATE INDEX "AdminJob_operator_createdAt_idx" ON "AdminJob"("operator", "createdAt");
CREATE INDEX "AdminJob_expiresAt_idx" ON "AdminJob"("expiresAt");

CREATE INDEX "AdminAuditLog_operator_createdAt_idx" ON "AdminAuditLog"("operator", "createdAt");
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
