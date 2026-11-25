CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminEvent_unfinished_id_idx"
ON "AdminEvent" ("id" ASC)
WHERE "status" <> 'done';
