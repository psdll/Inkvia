CREATE TABLE "CanvasVoiceFavorite" (
  "userId" INTEGER NOT NULL,
  "providerScope" VARCHAR(128) NOT NULL,
  "voiceId" VARCHAR(256) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CanvasVoiceFavorite_pkey" PRIMARY KEY ("userId", "providerScope", "voiceId")
);

CREATE INDEX "CanvasVoiceFavorite_userId_createdAt_idx"
  ON "CanvasVoiceFavorite"("userId", "createdAt");

ALTER TABLE "CanvasVoiceFavorite"
  ADD CONSTRAINT "CanvasVoiceFavorite_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
