CREATE TABLE "MonitoringAlertRecord" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "activeKey" TEXT,
    "source" TEXT NOT NULL DEFAULT 'project',
    "kind" TEXT NOT NULL,
    "resourceKey" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "currentPercent" DOUBLE PRECISION NOT NULL,
    "peakPercent" DOUBLE PRECISION NOT NULL,
    "warningPercent" DOUBLE PRECISION NOT NULL,
    "criticalPercent" DOUBLE PRECISION NOT NULL,
    "resourcePath" TEXT NOT NULL,
    "totalBytes" BIGINT NOT NULL,
    "freeBytes" BIGINT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "lastObservedAt" TIMESTAMP(3) NOT NULL,
    "recoveredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgementNote" TEXT,
    "silencedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoringAlertRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MonitoringAlertRecord_fingerprint_key"
ON "MonitoringAlertRecord"("fingerprint");

CREATE UNIQUE INDEX "MonitoringAlertRecord_activeKey_key"
ON "MonitoringAlertRecord"("activeKey");

CREATE INDEX "MonitoringAlertRecord_state_startsAt_idx"
ON "MonitoringAlertRecord"("state", "startsAt");

CREATE INDEX "MonitoringAlertRecord_expiresAt_idx"
ON "MonitoringAlertRecord"("expiresAt");

CREATE INDEX "MonitoringAlertRecord_resourceKey_startsAt_idx"
ON "MonitoringAlertRecord"("resourceKey", "startsAt");
