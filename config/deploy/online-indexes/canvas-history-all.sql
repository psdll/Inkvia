CREATE INDEX CONCURRENTLY IF NOT EXISTS "Generation_canvas_history_all_idx" ON "Generation" ("authUserId", "source", "status", "createdAt", "id");
