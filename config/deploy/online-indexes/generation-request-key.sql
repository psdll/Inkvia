CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Generation_requestKey_key"
ON public."Generation" USING btree ("requestKey")
WHERE "requestKey" IS NOT NULL;
