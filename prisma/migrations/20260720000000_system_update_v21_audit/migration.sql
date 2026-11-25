ALTER TABLE "SystemUpdateRecord"
  ADD COLUMN "operatorUserAgent" TEXT,
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "rollbackOutcome" TEXT,
  ADD COLUMN "evidenceSha256" TEXT,
  ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3);

CREATE TABLE "SystemUpdatePhaseEvent" (
  "id" BIGSERIAL NOT NULL,
  "jobId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "phase" TEXT NOT NULL,
  "progress" INTEGER NOT NULL,
  "message" TEXT NOT NULL,
  "errorCode" TEXT,
  "rollbackOutcome" TEXT,
  "evidenceSha256" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SystemUpdatePhaseEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SystemUpdatePhaseEvent_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "SystemUpdateRecord"("jobId")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SystemUpdatePhaseEvent_jobId_sequence_key" UNIQUE ("jobId", "sequence")
);

CREATE INDEX "SystemUpdatePhaseEvent_jobId_occurredAt_idx"
  ON "SystemUpdatePhaseEvent"("jobId", "occurredAt");

CREATE FUNCTION "prevent_system_update_phase_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SystemUpdatePhaseEvent is append-only';
END;
$$;

CREATE TRIGGER "SystemUpdatePhaseEvent_append_only"
BEFORE UPDATE OR DELETE ON "SystemUpdatePhaseEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_system_update_phase_event_mutation"();

CREATE TRIGGER "SystemUpdatePhaseEvent_no_truncate"
BEFORE TRUNCATE ON "SystemUpdatePhaseEvent"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_system_update_phase_event_mutation"();
