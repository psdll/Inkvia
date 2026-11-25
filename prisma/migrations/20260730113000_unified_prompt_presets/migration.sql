-- CreateTable
CREATE TABLE "PromptPreset" (
    "id" BIGSERIAL NOT NULL,
    "authUserId" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "content" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "legacyKey" VARCHAR(256),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuiltinPromptPreset" (
    "id" BIGSERIAL NOT NULL,
    "key" VARCHAR(256) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "content" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuiltinPromptPreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBuiltinPromptDeletion" (
    "authUserId" INTEGER NOT NULL,
    "builtinPromptPresetId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBuiltinPromptDeletion_pkey" PRIMARY KEY ("authUserId", "builtinPromptPresetId")
);

-- CreateTable
CREATE TABLE "PromptPresetMigrationState" (
    "id" BIGSERIAL NOT NULL,
    "subjectKey" VARCHAR(128) NOT NULL,
    "authUserId" INTEGER,
    "source" VARCHAR(64) NOT NULL,
    "version" INTEGER NOT NULL,
    "digest" VARCHAR(64) NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptPresetMigrationState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromptPreset_authUserId_legacyKey_key" ON "PromptPreset"("authUserId", "legacyKey");
CREATE INDEX "PromptPreset_authUserId_deletedAt_updatedAt_idx" ON "PromptPreset"("authUserId", "deletedAt", "updatedAt");
CREATE UNIQUE INDEX "BuiltinPromptPreset_key_key" ON "BuiltinPromptPreset"("key");
CREATE INDEX "BuiltinPromptPreset_deletedAt_updatedAt_idx" ON "BuiltinPromptPreset"("deletedAt", "updatedAt");
CREATE INDEX "UserBuiltinPromptDeletion_builtinPromptPresetId_idx" ON "UserBuiltinPromptDeletion"("builtinPromptPresetId");
CREATE UNIQUE INDEX "PromptPresetMigrationState_subjectKey_key" ON "PromptPresetMigrationState"("subjectKey");
CREATE INDEX "PromptPresetMigrationState_authUserId_source_idx" ON "PromptPresetMigrationState"("authUserId", "source");

-- AddForeignKey
ALTER TABLE "PromptPreset" ADD CONSTRAINT "PromptPreset_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBuiltinPromptDeletion" ADD CONSTRAINT "UserBuiltinPromptDeletion_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBuiltinPromptDeletion" ADD CONSTRAINT "UserBuiltinPromptDeletion_builtinPromptPresetId_fkey" FOREIGN KEY ("builtinPromptPresetId") REFERENCES "BuiltinPromptPreset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromptPresetMigrationState" ADD CONSTRAINT "PromptPresetMigrationState_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
