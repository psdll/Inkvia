-- DropIndex
DROP INDEX "BillingPriceRule_priority_idx";

-- AlterTable
ALTER TABLE "MaterialAsset" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UserExportJob" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "UserImportJob" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Canvas" (
    "id" SERIAL NOT NULL,
    "authUserId" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '未命名画布',
    "data" JSONB NOT NULL DEFAULT '{}',
    "thumbnail" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Canvas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Canvas_authUserId_updatedAt_idx" ON "Canvas"("authUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "Canvas_authUserId_deletedAt_updatedAt_idx" ON "Canvas"("authUserId", "deletedAt", "updatedAt");

-- AddForeignKey
ALTER TABLE "Canvas" ADD CONSTRAINT "Canvas_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
