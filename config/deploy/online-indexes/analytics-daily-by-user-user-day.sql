CREATE INDEX CONCURRENTLY IF NOT EXISTS "AnalyticsDailyByUser_userId_day_idx"
ON "AnalyticsDailyByUser" ("userId", "day");
