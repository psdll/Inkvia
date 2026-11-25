-- Reliable incremental events and generation work-feed projection.
-- Compatible rollout: additions only; legacy Generation reads remain available.

ALTER TABLE "AdminEvent" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "lockedAt" TIMESTAMP(3),
ADD COLUMN "lockedBy" TEXT,
ADD COLUMN "lastError" TEXT;

ALTER TABLE "AdminWorkFeed" ADD COLUMN "sourceEventId" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "sizeBytes64" BIGINT;

-- AdminEvent is created in this pending release and remains empty until normal
-- post-start business writes fire the approved Generation trigger.

CREATE INDEX "AdminEvent_status_availableAt_id_idx"
ON "AdminEvent"("status", "availableAt", "id");

CREATE INDEX "AdminEvent_status_lockedAt_idx"
ON "AdminEvent"("status", "lockedAt");

CREATE INDEX "AdminWorkFeed_sourceEventId_idx"
ON "AdminWorkFeed"("sourceEventId");

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
      jsonb_build_object('generationId', OLD.id), CURRENT_TIMESTAMP,
      'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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

CREATE TRIGGER "Generation_admin_event_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "Generation"
FOR EACH ROW EXECUTE FUNCTION "enqueue_generation_admin_event"();
