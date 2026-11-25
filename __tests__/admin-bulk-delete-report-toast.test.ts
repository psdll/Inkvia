import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "app/admin/page.tsx"), "utf8");

describe("admin bulk delete notifications", () => {
  it("does not mount a second deletion report", () => {
    expect(source).not.toContain("BulkDeleteReportToast");
    expect(source).not.toContain("setBulkDeleteReport");
  });

  it.each(["bulk_delete_generations", "bulk_delete_imports"])("uses the shared notice for %s", (action) => {
    const branch = source.split(`if (confirmAction.type === "${action}") {`)[1].split('if (confirmAction.type ===')[0];
    expect(branch).toContain('title: failedDeletes > 0 ? "部分删除失败" : "删除成功"');
    expect(branch.indexOf("setConfirmAction(null);", branch.indexOf("invalidateAdminCaches();")))
      .toBeLessThan(branch.lastIndexOf("notifyAdminAction({"));
    expect(branch).toContain("仍被引用，已保留");
  });
});
