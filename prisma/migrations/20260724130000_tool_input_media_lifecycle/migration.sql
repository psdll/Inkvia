CREATE TABLE "GenerationInputMedia" (
  "id" BIGSERIAL NOT NULL,
  "generationId" INTEGER NOT NULL,
  "mediaId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenerationInputMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GenerationInputMedia_generationId_position_key" ON "GenerationInputMedia"("generationId", "position");
CREATE INDEX "GenerationInputMedia_mediaId_idx" ON "GenerationInputMedia"("mediaId");
CREATE INDEX "GenerationInputMedia_generationId_position_idx" ON "GenerationInputMedia"("generationId", "position");

ALTER TABLE "GenerationInputMedia" ADD CONSTRAINT "GenerationInputMedia_generationId_fkey"
  FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GenerationInputMedia" ADD CONSTRAINT "GenerationInputMedia_mediaId_fkey"
  FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
