-- Original SQL creates a PostgreSQL UNIQUE constraint; Prisma installations may use an index.
ALTER TABLE "CreativeAgentSession" DROP CONSTRAINT IF EXISTS "CreativeAgentSession_actor_user_id_canvas_id_key";
DROP INDEX IF EXISTS "CreativeAgentSession_actor_user_id_canvas_id_key";
ALTER TABLE "CreativeAgentSession"
  ADD COLUMN title text NOT NULL DEFAULT '新对话',
  ADD COLUMN title_source text NOT NULL DEFAULT 'auto',
  ADD COLUMN title_message_id text,
  ADD COLUMN title_attempt_message_id text,
  ADD COLUMN title_claim_id text;
UPDATE "CreativeAgentSession" s SET title='创作对话'
WHERE EXISTS (SELECT 1 FROM "CreativeAgentMessage" m WHERE m.session_id=s.id);
CREATE INDEX "CreativeAgentSession_actor_user_id_canvas_id_updated_at_idx"
ON "CreativeAgentSession"(actor_user_id,canvas_id,updated_at);
