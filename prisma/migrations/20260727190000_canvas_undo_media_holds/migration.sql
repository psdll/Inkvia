CREATE TABLE "CanvasUndoMediaHold" (
  "id" BIGSERIAL NOT NULL,
  "undoSessionId" UUID NOT NULL,
  "canvasId" INTEGER NOT NULL,
  "ownerUserId" INTEGER NOT NULL,
  "referenceKey" VARCHAR(2200) NOT NULL,
  "mediaId" UUID,
  "publicRef" VARCHAR(2048),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CanvasUndoMediaHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanvasUndoMediaHold_undoSessionId_referenceKey_key"
  ON "CanvasUndoMediaHold"("undoSessionId", "referenceKey");
CREATE INDEX "CanvasUndoMediaHold_expiresAt_idx"
  ON "CanvasUndoMediaHold"("expiresAt");
CREATE INDEX "CanvasUndoMediaHold_mediaId_expiresAt_idx"
  ON "CanvasUndoMediaHold"("mediaId", "expiresAt");
CREATE INDEX "CanvasUndoMediaHold_canvasId_ownerUserId_idx"
  ON "CanvasUndoMediaHold"("canvasId", "ownerUserId");

ALTER TABLE "CanvasUndoMediaHold"
  ADD CONSTRAINT "CanvasUndoMediaHold_canvasId_fkey"
  FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvasUndoMediaHold"
  ADD CONSTRAINT "CanvasUndoMediaHold_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvasUndoMediaHold"
  ADD CONSTRAINT "CanvasUndoMediaHold_mediaId_fkey"
  FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
