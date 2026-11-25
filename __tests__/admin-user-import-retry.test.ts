import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

describe("failed user import retry", () => {
  it("keeps an interrupted archive and exposes an authenticated retry route", () => {
    const maintenance = source("lib/admin/user-export-maintenance.ts");
    const stuckBlock = maintenance.slice(maintenance.indexOf("const stuckImports"));
    const route = source("app/api/admin/user/import/retry/route.ts");
    const runner = source("lib/admin/user-import-runner.ts");

    expect(stuckBlock).not.toContain("await safeUnlink(job.filePath)");
    expect(stuckBlock).toContain("文件已保留，可直接重试");
    expect(route).toContain("requireAdminRequest");
    expect(route).toContain("retryUserImportJob");
    expect(runner).toContain("export async function retryUserImportJob");
    expect(runner).toContain("USER_IMPORT_HEARTBEAT_MS");
    expect(runner).toContain("clearInterval(importHeartbeat)");
  });

  it("offers retry from the error modal without uploading the ZIP again", () => {
    const page = source("app/admin/page.tsx");
    const modal = source("components/admin/ImportProgressModal.tsx");

    expect(page).toContain('fetch("/api/admin/user/import/retry"');
    expect(modal).toContain("使用已上传文件重试");
    expect(modal).toContain("state.jobId");
  });

  it("records a committed import as done before removing its retry archive", () => {
    const runner = source("lib/admin/user-import-runner.ts");
    const archiveDelete = runner.indexOf("await fs.remove(job.filePath)");
    const doneStatus = runner.indexOf('status: "done"');

    expect(doneStatus).toBeGreaterThan(-1);
    expect(archiveDelete).toBeGreaterThan(doneStatus);
  });
});
