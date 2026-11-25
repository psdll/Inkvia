-- CreateTable
CREATE TABLE "ImageBatchGroup" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageBatchGroup_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ImageBatchItem"
ADD COLUMN "groupId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "ImageBatchGroup_batchId_position_key"
ON "ImageBatchGroup"("batchId", "position");

-- CreateIndex
CREATE INDEX "ImageBatchGroup_batchId_idx"
ON "ImageBatchGroup"("batchId");

-- CreateIndex
CREATE INDEX "ImageBatchItem_groupId_idx"
ON "ImageBatchItem"("groupId");

-- AddForeignKey
ALTER TABLE "ImageBatchGroup"
ADD CONSTRAINT "ImageBatchGroup_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "ImageBatch"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageBatchItem"
ADD CONSTRAINT "ImageBatchItem_groupId_fkey"
FOREIGN KEY ("groupId") REFERENCES "ImageBatchGroup"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
