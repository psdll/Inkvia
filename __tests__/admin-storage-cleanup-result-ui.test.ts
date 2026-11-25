import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin storage cleanup result UI", () => {
  const overviewSource = readFileSync(
    resolve(process.cwd(), "components/admin/AdminOverviewTab.tsx"),
    "utf8",
  );
  const pageSource = readFileSync(
    resolve(process.cwd(), "app/admin/page.tsx"),
    "utf8",
  );
  const routeSource = readFileSync(
    resolve(process.cwd(), "app/api/admin/storage/route.ts"),
    "utf8",
  );
  const confirmSource = readFileSync(
    resolve(process.cwd(), "components/admin/AdminConfirmModal.tsx"),
    "utf8",
  );

  it("explains both cleanup scopes before the destructive action", () => {
    expect(overviewSource).toContain("任务作品/上传记录、关联日志、用量账单");
    expect(overviewSource).toContain("仍被其他数据引用或受保护的文件会跳过");
    expect(overviewSource).toContain("uploads/temp");
    expect(overviewSource).toContain("不会删除数据库记录");
  });

  it("names the destructive action and explains how automatic retention overlaps", () => {
    expect(overviewSource).toContain("删除全站用户旧任务作品");
    expect(confirmSource).toContain("删除全站用户的旧任务作品记录");
    expect(overviewSource).toContain("全站用户任务作品自动保留期限");
    expect(overviewSource).toContain("系统每 6 小时检查一次");
    expect(overviewSource).toContain("手动删除会立即生效");
  });

  it("keeps and renders the latest cleanup response", () => {
    expect(pageSource).toContain("setStorageCleanupResult");
    expect(pageSource).toContain("cleanupResult={storageCleanupResult}");
    expect(overviewSource).toContain("最近一次清理结果");
    expect(overviewSource).toContain("生成记录");
    expect(overviewSource).toContain("关联日志");
    expect(overviewSource).toContain("用量账单");
    expect(overviewSource).toContain("本地文件");
    expect(overviewSource).toContain("OSS 对象");
    expect(overviewSource).toContain("临时文件");
    expect(overviewSource).toContain("空目录");
    expect(overviewSource).toContain("释放空间");
  });

  it("returns classified file cleanup statistics from the storage API", () => {
    expect(routeSource).toContain(
      "deletedLocalFiles += Number(deletion.deletedLocalFiles || 0)",
    );
    expect(routeSource).toContain(
      "deletedOssObjects += Number(deletion.deletedOssObjects || 0)",
    );
    expect(routeSource).toContain(
      "skippedProtectedRefs += Number(deletion.skippedProtectedRefsCount || 0)",
    );
    expect(routeSource).toContain("ossErrorCount");
  });

  it("keeps destructive cleanup unarmed until a valid retention window is entered", () => {
    expect(pageSource).toContain('React.useState("0")');
    expect(overviewSource).toContain("0 表示未设置");
    expect(overviewSource).toContain("保留最近");
    expect(overviewSource).toContain("永久删除更早的全站用户任务作品");
    expect(overviewSource).toContain("cleanupDaysValid");
  });

  it("requires a password, typed phrase, and final confirmation for all-user cleanup", () => {
    expect(confirmSource).toContain("高危操作：这会批量物理删除全站用户数据");
    expect(confirmSource).toContain('const CLEANUP_CONFIRM_PHRASE = "删除全站用户旧任务作品"');
    expect(confirmSource).toContain("confirmationText");
    expect(confirmSource).toContain("isCriticalStorageCleanup");
    expect(pageSource).toContain("adminPassword");
    expect(routeSource).toContain("管理员密码错误，请重新输入");
  });
});
