ALTER TABLE "Canvas"
ADD COLUMN "revision64" BIGINT NOT NULL DEFAULT 1,
ADD COLUMN "projectionRevision" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "snapshotRevision" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN "currentSnapshotId" BIGINT,
ADD COLUMN "nodeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "edgeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "CanvasMutation" (
  "id" BIGSERIAL NOT NULL,
  "canvasId" INTEGER NOT NULL,
  "actorUserId" INTEGER NOT NULL,
  "clientMutationId" UUID NOT NULL,
  "clientSequence" BIGINT NOT NULL,
  "payloadHash" CHAR(64) NOT NULL,
  "baseRevision" BIGINT NOT NULL,
  "revision" BIGINT NOT NULL,
  "protocolVersion" INTEGER NOT NULL,
  "operations" JSONB NOT NULL,
  "touchedPaths" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CanvasMutation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CanvasSnapshot" (
  "id" BIGSERIAL NOT NULL,
  "canvasId" INTEGER NOT NULL,
  "revision" BIGINT NOT NULL,
  "documentSchemaVersion" INTEGER NOT NULL,
  "operationProtocolVersion" INTEGER NOT NULL,
  "codec" TEXT NOT NULL DEFAULT 'gzip',
  "compressedJson" BYTEA NOT NULL,
  "uncompressedBytes" INTEGER NOT NULL,
  "checksumSha256" CHAR(64) NOT NULL,
  "nodeCount" INTEGER NOT NULL,
  "edgeCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CanvasSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CanvasNodeState" (
  "canvasId" INTEGER NOT NULL,
  "nodeId" TEXT NOT NULL,
  "nodeVersion" BIGINT NOT NULL,
  "kind" TEXT NOT NULL,
  "positionX" DOUBLE PRECISION NOT NULL,
  "positionY" DOUBLE PRECISION NOT NULL,
  "width" DOUBLE PRECISION,
  "height" DOUBLE PRECISION,
  "parentId" TEXT,
  "zIndex" INTEGER NOT NULL DEFAULT 0,
  "data" JSONB NOT NULL,
  "searchText" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanvasNodeState_pkey" PRIMARY KEY ("canvasId", "nodeId")
);

CREATE TABLE "CanvasEdgeState" (
  "canvasId" INTEGER NOT NULL,
  "edgeId" TEXT NOT NULL,
  "edgeVersion" BIGINT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "bboxMinX" DOUBLE PRECISION,
  "bboxMinY" DOUBLE PRECISION,
  "bboxMaxX" DOUBLE PRECISION,
  "bboxMaxY" DOUBLE PRECISION,
  "data" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanvasEdgeState_pkey" PRIMARY KEY ("canvasId", "edgeId")
);

CREATE TABLE "CanvasMember" (
  "canvasId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanvasMember_pkey" PRIMARY KEY ("canvasId", "userId")
);

CREATE UNIQUE INDEX "Canvas_currentSnapshotId_key" ON "Canvas"("currentSnapshotId");
CREATE UNIQUE INDEX "CanvasMutation_canvasId_revision_key" ON "CanvasMutation"("canvasId", "revision");
CREATE UNIQUE INDEX "CanvasMutation_canvasId_clientMutationId_key" ON "CanvasMutation"("canvasId", "clientMutationId");
CREATE INDEX "CanvasMutation_canvasId_revision_idx" ON "CanvasMutation"("canvasId", "revision");
CREATE INDEX "CanvasMutation_actorUserId_createdAt_idx" ON "CanvasMutation"("actorUserId", "createdAt");
CREATE UNIQUE INDEX "CanvasSnapshot_canvasId_revision_key" ON "CanvasSnapshot"("canvasId", "revision");
CREATE INDEX "CanvasSnapshot_canvasId_createdAt_idx" ON "CanvasSnapshot"("canvasId", "createdAt");
CREATE INDEX "CanvasNodeState_canvasId_parentId_idx" ON "CanvasNodeState"("canvasId", "parentId");
CREATE INDEX "CanvasNodeState_canvasId_kind_idx" ON "CanvasNodeState"("canvasId", "kind");
CREATE INDEX "CanvasNodeState_canvasId_updatedAt_idx" ON "CanvasNodeState"("canvasId", "updatedAt");
CREATE INDEX "CanvasEdgeState_canvasId_sourceId_idx" ON "CanvasEdgeState"("canvasId", "sourceId");
CREATE INDEX "CanvasEdgeState_canvasId_targetId_idx" ON "CanvasEdgeState"("canvasId", "targetId");
CREATE INDEX "CanvasEdgeState_canvasId_updatedAt_idx" ON "CanvasEdgeState"("canvasId", "updatedAt");
CREATE INDEX "CanvasMember_userId_role_idx" ON "CanvasMember"("userId", "role");

ALTER TABLE "CanvasMutation" ADD CONSTRAINT "CanvasMutation_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvasMutation" ADD CONSTRAINT "CanvasMutation_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CanvasSnapshot" ADD CONSTRAINT "CanvasSnapshot_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvasNodeState" ADD CONSTRAINT "CanvasNodeState_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvasEdgeState" ADD CONSTRAINT "CanvasEdgeState_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvasMember" ADD CONSTRAINT "CanvasMember_canvasId_fkey" FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvasMember" ADD CONSTRAINT "CanvasMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Canvas" ADD CONSTRAINT "Canvas_currentSnapshotId_fkey" FOREIGN KEY ("currentSnapshotId") REFERENCES "CanvasSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
