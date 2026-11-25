-- 为 CfContent.authUserId 增加索引：加速管理员用户面板按 authUserId 的聚合统计
CREATE INDEX IF NOT EXISTS "CfContent_authUserId_idx" ON "CfContent"("authUserId");
