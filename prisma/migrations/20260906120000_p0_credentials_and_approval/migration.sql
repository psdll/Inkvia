-- Expand only. Historical password conversion is a separate controlled operation.
ALTER TABLE "User" ADD COLUMN "passwordCipher" JSONB,
  ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentRun" ADD COLUMN "generationApproval" JSONB;

CREATE TABLE "PasswordResetGrant" (
  "id" UUID NOT NULL,
  "userId" INTEGER NOT NULL,
  "tokenDigest" CHAR(64) NOT NULL,
  "credentialVersion" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT NOT NULL,
  CONSTRAINT "PasswordResetGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PasswordResetGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PasswordResetGrant_tokenDigest_key" ON "PasswordResetGrant"("tokenDigest");
CREATE INDEX "PasswordResetGrant_userId_expiresAt_idx" ON "PasswordResetGrant"("userId", "expiresAt");
