ALTER TABLE "MediaLibraryItem"
  ADD COLUMN IF NOT EXISTS "selectedByUserId" INTEGER,
  ADD COLUMN IF NOT EXISTS "selectedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MediaLibraryItem_selectedByUserId_fkey'
  ) THEN
    ALTER TABLE "MediaLibraryItem"
      ADD CONSTRAINT "MediaLibraryItem_selectedByUserId_fkey"
      FOREIGN KEY ("selectedByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "MediaLibraryDownload" (
  "id" SERIAL PRIMARY KEY,
  "itemId" INTEGER NOT NULL,
  "userId" INTEGER NOT NULL,
  "username" TEXT NOT NULL,
  "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaLibraryDownload_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "MediaLibraryItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MediaLibraryDownload_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "MediaLibraryItem_selectedByUserId_selectedAt_idx"
  ON "MediaLibraryItem"("selectedByUserId", "selectedAt");
CREATE INDEX IF NOT EXISTS "MediaLibraryItem_scope_selectedByUserId_createdAt_idx"
  ON "MediaLibraryItem"("scope", "selectedByUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "MediaLibraryDownload_itemId_downloadedAt_idx"
  ON "MediaLibraryDownload"("itemId", "downloadedAt");
CREATE INDEX IF NOT EXISTS "MediaLibraryDownload_userId_downloadedAt_idx"
  ON "MediaLibraryDownload"("userId", "downloadedAt");
