-- Incremental administrator summaries. Additions only; legacy readers remain available.

ALTER TABLE "AdminUserSummary" ADD COLUMN "successTaskCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "failedTaskCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "linkedUserIds" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX "AdminUserSummary_updatedAt_adminKey_idx"
ON "AdminUserSummary"("updatedAt", "adminKey");

-- AnalyticsDailyByUser already exists in production. Its index is applied by
-- config/deploy/online-indexes/analytics-daily-by-user-user-day.sql.

-- Preserve a minimal old-row snapshot so a delete can repair summaries even if the feed row is absent.
CREATE OR REPLACE FUNCTION "enqueue_generation_admin_event"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO "AdminEvent" (
      "eventType", "entityType", "entityId", "userId", "authUserId",
      "payload", "occurredAt", "status", "attempts", "availableAt", "createdAt"
    ) VALUES (
      'generation.delete', 'generation', OLD.id::TEXT, OLD."userId", OLD."authUserId",
      jsonb_build_object(
        'generationId', OLD.id,
        'userId', OLD."userId",
        'authUserId', OLD."authUserId",
        'type', OLD."type",
        'status', OLD."status",
        'source', OLD."source",
        'createdAt', OLD."createdAt",
        'updatedAt', OLD."updatedAt",
        'sizeBytes', OLD."sizeBytes"
      ),
      CURRENT_TIMESTAMP, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
    RETURN OLD;
  END IF;

  INSERT INTO "AdminEvent" (
    "eventType", "entityType", "entityId", "userId", "authUserId",
    "payload", "occurredAt", "status", "attempts", "availableAt", "createdAt"
  ) VALUES (
    CASE WHEN TG_OP = 'INSERT' THEN 'generation.insert' ELSE 'generation.update' END,
    'generation', NEW.id::TEXT, NEW."userId", NEW."authUserId",
    jsonb_build_object('generationId', NEW.id), CURRENT_TIMESTAMP,
    'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );
  RETURN NEW;
END;
$$;
