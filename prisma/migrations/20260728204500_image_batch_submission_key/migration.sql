-- AddColumn
ALTER TABLE "ImageBatch"
ADD COLUMN IF NOT EXISTS "lastSubmissionKey" VARCHAR(128);
