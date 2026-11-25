-- 把 AgentMessage.metadata 从 TEXT 改成 jsonb,使后续可以按字段 JSON 查询。
-- 用 USING metadata::jsonb 转换现有数据,避免 Prisma 默认的 DROP+ADD 导致数据丢失。
-- 现有数据已确认全部是合法 JSON 字符串。

ALTER TABLE "AgentMessage" ALTER COLUMN "metadata" TYPE JSONB USING metadata::jsonb;
