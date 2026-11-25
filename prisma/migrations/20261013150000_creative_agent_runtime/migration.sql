CREATE TABLE "CreativeAgentSession" (
  id text PRIMARY KEY,
  actor_user_id integer NOT NULL,
  canvas_id integer NOT NULL,
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE(actor_user_id, canvas_id)
);
CREATE TABLE "CreativeAgentRun" (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES "CreativeAgentSession"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  actor_user_id integer NOT NULL,
  canvas_id integer NOT NULL,
  status text NOT NULL CHECK(status IN ('queued','running','waiting_decision','waiting_action','paused','stopping','completed','stopped','failed')),
  epoch integer NOT NULL DEFAULT 0,
  worker_id text,
  lease_expires_at timestamptz(3),
  input jsonb NOT NULL,
  error text,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "CreativeAgentRun_one_active_canvas" ON "CreativeAgentRun"(canvas_id)
  WHERE status IN ('queued','running','waiting_decision','waiting_action','paused','stopping');
CREATE INDEX "CreativeAgentRun_status_created_at_idx" ON "CreativeAgentRun"(status, created_at);
CREATE TABLE "CreativeAgentMessage" (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES "CreativeAgentSession"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  run_id text NOT NULL REFERENCES "CreativeAgentRun"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  role text NOT NULL CHECK(role IN ('user','assistant')),
  text text NOT NULL,
  reference_data jsonb,
  input_hash text,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE "CreativeAgentEvent" (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id text NOT NULL REFERENCES "CreativeAgentRun"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX "CreativeAgentEvent_run_id_sequence_idx" ON "CreativeAgentEvent"(run_id, sequence);
CREATE TABLE "CreativeAgentAction" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES "CreativeAgentRun"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  actor_user_id integer NOT NULL,
  canvas_id integer NOT NULL,
  epoch integer NOT NULL,
  kind text NOT NULL,
  input_hash text NOT NULL,
  state text NOT NULL CHECK(state IN ('claimed','succeeded','failed','unknown')),
  result jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX "CreativeAgentAction_run_id_idx" ON "CreativeAgentAction"(run_id);
CREATE TABLE "CreativeAgentDecision" (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES "CreativeAgentRun"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  action_id text NOT NULL UNIQUE,
  proposal_hash text NOT NULL,
  title text NOT NULL,
  question text NOT NULL,
  options jsonb NOT NULL,
  state text NOT NULL CHECK(state IN ('pending','answered','cancelled')),
  answer jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  answered_at timestamptz(3)
);
CREATE TABLE "CreativeAgentRequest" (
  id text PRIMARY KEY,
  actor_user_id integer NOT NULL,
  input_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE INDEX "CreativeAgentRun_session_id_created_at_idx" ON "CreativeAgentRun"(session_id, created_at);
CREATE INDEX "CreativeAgentRun_canvas_id_status_idx" ON "CreativeAgentRun"(canvas_id, status);
CREATE INDEX "CreativeAgentMessage_session_id_created_at_idx" ON "CreativeAgentMessage"(session_id, created_at);
