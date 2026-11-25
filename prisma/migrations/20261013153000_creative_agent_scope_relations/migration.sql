-- Tie the new runtime's lifetime to existing owners and canvases.
ALTER TABLE "CreativeAgentSession" ADD CONSTRAINT "CreativeAgentSession_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreativeAgentSession" ADD CONSTRAINT "CreativeAgentSession_canvas_id_fkey" FOREIGN KEY ("canvas_id") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreativeAgentRequest" ADD CONSTRAINT "CreativeAgentRequest_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Request receipts include run snapshots; cascade them when the canvas/run goes away.
ALTER TABLE "CreativeAgentRequest" ADD COLUMN "run_id" TEXT;
ALTER TABLE "CreativeAgentRequest" ADD CONSTRAINT "CreativeAgentRequest_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "CreativeAgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
