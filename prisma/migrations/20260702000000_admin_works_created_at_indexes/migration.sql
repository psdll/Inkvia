CREATE INDEX IF NOT EXISTS "Generation_authUserId_type_createdAt_id_idx"
ON "Generation"("authUserId", "type", "createdAt" DESC, "id" DESC)
WHERE "authUserId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Generation_guest_userId_type_createdAt_id_idx"
ON "Generation"("userId", "type", "createdAt" DESC, "id" DESC)
WHERE "authUserId" IS NULL;
