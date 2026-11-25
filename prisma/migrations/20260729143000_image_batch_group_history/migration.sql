-- AlterTable
ALTER TABLE "ImageBatchGroup"
ADD COLUMN "authUserId" INTEGER,
ADD COLUMN "sequence" INTEGER,
ADD COLUMN "hiddenAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "ImageBatchGroup_authUserId_sequence_key"
ON "ImageBatchGroup"("authUserId", "sequence");

-- CreateIndex
CREATE INDEX "ImageBatchGroup_authUserId_hiddenAt_createdAt_id_idx"
ON "ImageBatchGroup"("authUserId", "hiddenAt", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "ImageBatchGroup"
ADD CONSTRAINT "ImageBatchGroup_authUserId_fkey"
FOREIGN KEY ("authUserId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
