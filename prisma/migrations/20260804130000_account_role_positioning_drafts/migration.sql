ALTER TABLE "PromptReverseTask"
ADD COLUMN "surface" VARCHAR(32) NOT NULL DEFAULT 'toolbox_image';

CREATE TABLE "RolePositioningDraft" (
    "id" SERIAL NOT NULL,
    "authUserId" INTEGER NOT NULL,
    "surface" VARCHAR(32) NOT NULL,
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "reversePrompt" TEXT NOT NULL DEFAULT '',
    "reversePromptApplied" BOOLEAN NOT NULL DEFAULT false,
    "activeReverseTaskId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RolePositioningDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RolePositioningDraft_authUserId_surface_key"
ON "RolePositioningDraft"("authUserId", "surface");

CREATE INDEX "RolePositioningDraft_authUserId_updatedAt_idx"
ON "RolePositioningDraft"("authUserId", "updatedAt");

ALTER TABLE "RolePositioningDraft"
ADD CONSTRAINT "RolePositioningDraft_authUserId_fkey"
FOREIGN KEY ("authUserId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
