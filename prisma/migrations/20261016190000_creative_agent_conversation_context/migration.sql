-- NULL is legacy/uninitialized; explicit versioned empty state is a durable clear.
ALTER TABLE "CreativeAgentSession" ADD COLUMN "creation_context" JSONB;
