CREATE TABLE "ToolWorkspaceDraft" (
    "id" UUID NOT NULL,
    "authUserId" INTEGER NOT NULL,
    "tool" VARCHAR(16) NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolWorkspaceDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ToolWorkspaceDraftMedia" (
    "id" BIGSERIAL NOT NULL,
    "draftId" UUID NOT NULL,
    "mediaId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "slot" VARCHAR(16),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolWorkspaceDraftMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ToolWorkspaceDraft_authUserId_tool_key"
ON "ToolWorkspaceDraft"("authUserId", "tool");

CREATE INDEX "ToolWorkspaceDraft_authUserId_updatedAt_idx"
ON "ToolWorkspaceDraft"("authUserId", "updatedAt");

CREATE UNIQUE INDEX "ToolWorkspaceDraftMedia_draftId_position_key"
ON "ToolWorkspaceDraftMedia"("draftId", "position");

CREATE INDEX "ToolWorkspaceDraftMedia_mediaId_idx"
ON "ToolWorkspaceDraftMedia"("mediaId");

ALTER TABLE "ToolWorkspaceDraft"
ADD CONSTRAINT "ToolWorkspaceDraft_authUserId_fkey"
FOREIGN KEY ("authUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ToolWorkspaceDraftMedia"
ADD CONSTRAINT "ToolWorkspaceDraftMedia_draftId_fkey"
FOREIGN KEY ("draftId") REFERENCES "ToolWorkspaceDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ToolWorkspaceDraftMedia"
ADD CONSTRAINT "ToolWorkspaceDraftMedia_mediaId_fkey"
FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
