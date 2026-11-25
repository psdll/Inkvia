-- CreateTable
CREATE TABLE "WhitelistName" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhitelistName_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "token" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Generation" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'legacy',
    "authUserId" INTEGER,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'tool',
    "prompt" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL,
    "externalProvider" TEXT,
    "externalTaskId" TEXT,
    "errorMsg" TEXT,
    "localPath" TEXT,
    "templateData" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "prompt" TEXT NOT NULL,
    "toolType" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "previewImagePath" TEXT,
    "previewVideoPath" TEXT,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateTag" (
    "templateId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,

    CONSTRAINT "TemplateTag_pkey" PRIMARY KEY ("templateId","tagId")
);

-- CreateTable
CREATE TABLE "Log" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'system',
    "hiddenFromUser" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "duration" INTEGER,
    "generationId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ModerationDict" (
    "id" SERIAL NOT NULL,
    "word" TEXT NOT NULL,
    "variants" TEXT NOT NULL DEFAULT '[]',
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'hard',
    "platform" TEXT NOT NULL DEFAULT 'all',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationDict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfBatchTask" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "authUserId" INTEGER,
    "platform" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "styleConfig" TEXT NOT NULL DEFAULT '{}',
    "model" TEXT NOT NULL DEFAULT 'openrouter',
    "totalCount" INTEGER NOT NULL,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorLog" TEXT,
    "configSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CfBatchTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CfContent" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "authUserId" INTEGER,
    "platform" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "hook" TEXT NOT NULL DEFAULT '',
    "scriptData" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qualityIssues" TEXT,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "moderationStatus" TEXT NOT NULL DEFAULT 'pending',
    "moderationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "moderatedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "executionLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CfContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendingTopic" (
    "id" SERIAL NOT NULL,
    "platform" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "rank" INTEGER,
    "heat" TEXT,
    "category" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendingTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaLibraryItem" (
    "id" SERIAL NOT NULL,
    "scope" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "groupName" TEXT,
    "title" TEXT NOT NULL,
    "ossUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "ownerUserId" INTEGER,
    "createdByUserId" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhitelistName_name_key" ON "WhitelistName"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_token_key" ON "User"("token");

-- CreateIndex
CREATE INDEX "Generation_userId_idx" ON "Generation"("userId");

-- CreateIndex
CREATE INDEX "Generation_authUserId_idx" ON "Generation"("authUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "TemplateTag_tagId_idx" ON "TemplateTag"("tagId");

-- CreateIndex
CREATE INDEX "TemplateTag_templateId_idx" ON "TemplateTag"("templateId");

-- CreateIndex
CREATE INDEX "Log_userId_idx" ON "Log"("userId");

-- CreateIndex
CREATE INDEX "Log_userId_hiddenFromUser_idx" ON "Log"("userId", "hiddenFromUser");

-- CreateIndex
CREATE INDEX "Log_category_idx" ON "Log"("category");

-- CreateIndex
CREATE INDEX "Log_level_idx" ON "Log"("level");

-- CreateIndex
CREATE INDEX "Log_createdAt_idx" ON "Log"("createdAt");

-- CreateIndex
CREATE INDEX "Log_generationId_idx" ON "Log"("generationId");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationDict_word_key" ON "ModerationDict"("word");

-- CreateIndex
CREATE INDEX "ModerationDict_category_idx" ON "ModerationDict"("category");

-- CreateIndex
CREATE INDEX "ModerationDict_platform_idx" ON "ModerationDict"("platform");

-- CreateIndex
CREATE INDEX "CfBatchTask_userId_idx" ON "CfBatchTask"("userId");

-- CreateIndex
CREATE INDEX "CfBatchTask_status_idx" ON "CfBatchTask"("status");

-- CreateIndex
CREATE INDEX "CfContent_taskId_idx" ON "CfContent"("taskId");

-- CreateIndex
CREATE INDEX "CfContent_userId_idx" ON "CfContent"("userId");

-- CreateIndex
CREATE INDEX "TrendingTopic_platform_idx" ON "TrendingTopic"("platform");

-- CreateIndex
CREATE INDEX "TrendingTopic_fetchedAt_idx" ON "TrendingTopic"("fetchedAt");

-- CreateIndex
CREATE INDEX "TrendingTopic_expiresAt_idx" ON "TrendingTopic"("expiresAt");

-- CreateIndex
CREATE INDEX "MediaLibraryItem_scope_kind_createdAt_idx" ON "MediaLibraryItem"("scope", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "MediaLibraryItem_scope_groupName_createdAt_idx" ON "MediaLibraryItem"("scope", "groupName", "createdAt");

-- CreateIndex
CREATE INDEX "MediaLibraryItem_ownerUserId_scope_createdAt_idx" ON "MediaLibraryItem"("ownerUserId", "scope", "createdAt");

-- CreateIndex
CREATE INDEX "MediaLibraryItem_ownerUserId_groupName_createdAt_idx" ON "MediaLibraryItem"("ownerUserId", "groupName", "createdAt");

-- CreateIndex
CREATE INDEX "MediaLibraryItem_isDeleted_createdAt_idx" ON "MediaLibraryItem"("isDeleted", "createdAt");

-- AddForeignKey
ALTER TABLE "Generation" ADD CONSTRAINT "Generation_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateTag" ADD CONSTRAINT "TemplateTag_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateTag" ADD CONSTRAINT "TemplateTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CfContent" ADD CONSTRAINT "CfContent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CfBatchTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaLibraryItem" ADD CONSTRAINT "MediaLibraryItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
