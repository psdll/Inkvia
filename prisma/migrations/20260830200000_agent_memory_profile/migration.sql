-- One private long-term memory profile per user. The table starts empty and is
-- materialized only by an actual Agent request.

CREATE TABLE "AgentMemoryProfile" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "deletedAt" TIMESTAMP(3),
  "fileSyncedAt" TIMESTAMP(3),
  "syncError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentMemoryProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentMemoryProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentMemoryProfile_userId_key"
  ON "AgentMemoryProfile"("userId");
