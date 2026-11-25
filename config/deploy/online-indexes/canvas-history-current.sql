CREATE INDEX CONCURRENTLY IF NOT EXISTS "Generation_canvas_history_current_idx" ON "Generation" ("authUserId", "canvasId", "status", "createdAt", "id");
