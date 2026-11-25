CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminEvent_status_availableAt_id_idx"
ON "AdminEvent" ("status", "availableAt", "id");
