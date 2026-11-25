CREATE TABLE "SystemRoleSkill" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "summary" VARCHAR(200) NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "coverUrl" TEXT,
    "content" TEXT NOT NULL,
    "usageScenario" TEXT NOT NULL,
    "usageGuide" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'hidden',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemRoleSkill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserRoleSkill" (
    "id" BIGSERIAL NOT NULL,
    "authUserId" INTEGER NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "summary" VARCHAR(200) NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "coverUrl" TEXT,
    "content" TEXT NOT NULL,
    "usageScenario" TEXT NOT NULL,
    "usageGuide" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRoleSkill_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SystemRoleSkill_status_deletedAt_updatedAt_idx"
ON "SystemRoleSkill"("status", "deletedAt", "updatedAt");

CREATE INDEX "SystemRoleSkill_category_status_deletedAt_idx"
ON "SystemRoleSkill"("category", "status", "deletedAt");

CREATE INDEX "UserRoleSkill_authUserId_deletedAt_updatedAt_idx"
ON "UserRoleSkill"("authUserId", "deletedAt", "updatedAt");

CREATE INDEX "UserRoleSkill_authUserId_category_deletedAt_idx"
ON "UserRoleSkill"("authUserId", "category", "deletedAt");

ALTER TABLE "UserRoleSkill"
ADD CONSTRAINT "UserRoleSkill_authUserId_fkey"
FOREIGN KEY ("authUserId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RolePositioningDraft"
ADD COLUMN "selectedSkillSource" VARCHAR(16),
ADD COLUMN "selectedSkillId" BIGINT,
ADD COLUMN "resultSkillSource" VARCHAR(16),
ADD COLUMN "resultSkillId" BIGINT,
ADD COLUMN "resultSkillName" VARCHAR(64),
ADD COLUMN "resultSkillRevision" INTEGER;

ALTER TABLE "PromptReverseTask"
ADD COLUMN "skillSource" VARCHAR(16),
ADD COLUMN "skillId" BIGINT,
ADD COLUMN "skillName" VARCHAR(64),
ADD COLUMN "skillRevision" INTEGER;
