-- Add structured questions without changing existing approval records.
ALTER TABLE "CreativeAgentDecision" ADD COLUMN "fields" JSONB NOT NULL DEFAULT '[]'::jsonb;
