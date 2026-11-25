CREATE TABLE "CreativeAgentTraceEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sequence" BIGSERIAL NOT NULL UNIQUE,
  "run_id" TEXT NOT NULL REFERENCES "CreativeAgentRun"("id") ON DELETE CASCADE,
  "span_id" TEXT NOT NULL,
  "parent_span_id" TEXT,
  "category" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "summary" JSONB NOT NULL DEFAULT '{}',
  "detail" JSONB,
  "event_key" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("run_id", "event_key")
);
CREATE INDEX "CreativeAgentTraceEvent_run_id_sequence_idx" ON "CreativeAgentTraceEvent"("run_id", "sequence");
CREATE INDEX "CreativeAgentTraceEvent_run_id_span_id_sequence_idx" ON "CreativeAgentTraceEvent"("run_id", "span_id", "sequence");
CREATE INDEX "CreativeAgentTraceEvent_created_at_idx" ON "CreativeAgentTraceEvent"("created_at");
