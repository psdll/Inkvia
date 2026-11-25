-- Preserve summary deletions in the incremental change stream.

ALTER TABLE "AdminUserSummary"
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "AdminUserSummary_deletedAt_lastActiveAt_idx"
ON "AdminUserSummary"("deletedAt", "lastActiveAt");
