CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminUserSummary_updatedAt_adminKey_idx"
ON "AdminUserSummary" ("updatedAt", "adminKey");
