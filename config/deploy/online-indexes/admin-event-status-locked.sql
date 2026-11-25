CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminEvent_status_lockedAt_idx"
ON "AdminEvent" ("status", "lockedAt");
