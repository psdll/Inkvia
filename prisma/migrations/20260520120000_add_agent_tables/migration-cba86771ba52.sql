-- 内容运营 Agent 数据表:由原先的 prisma db push 同步,本 migration 将其纳入版本化历史。
-- 数据库当前已经处于这一状态,执行 `prisma migrate resolve --applied 20260520120000_add_agent_tables` 标记为已应用。

-- CreateTable
CREATE TABLE "AgentConversation" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "summaryUntil" INTEGER,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMemory" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "history" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "version" INTEGER NOT NULL DEFAULT 1,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "sourceMessageId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "conversationId" INTEGER,
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentConversation_userId_updatedAt_idx" ON "AgentConversation"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentConversation_userId_status_idx" ON "AgentConversation"("userId", "status");

-- CreateIndex
CREATE INDEX "AgentMessage_conversationId_createdAt_idx" ON "AgentMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentMessage_userId_createdAt_idx" ON "AgentMessage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserMemory_userId_type_idx" ON "UserMemory"("userId", "type");

-- CreateIndex
CREATE INDEX "UserMemory_userId_isActive_idx" ON "UserMemory"("userId", "isActive");

-- CreateIndex
CREATE INDEX "UserMemory_userId_lastUsedAt_idx" ON "UserMemory"("userId", "lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserMemory_userId_type_key_key" ON "UserMemory"("userId", "type", "key");

-- CreateIndex
CREATE INDEX "AgentRun_userId_createdAt_idx" ON "AgentRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_purpose_status_idx" ON "AgentRun"("purpose", "status");

-- AddForeignKey
ALTER TABLE "AgentConversation" ADD CONSTRAINT "AgentConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
