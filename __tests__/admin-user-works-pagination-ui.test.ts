import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin user works pagination UI", () => {
  it("appends bounded cursor batches through scrolling without manual page controls", () => {
    const pageSource = readFileSync(
      resolve(process.cwd(), "app/admin/page.tsx"),
      "utf8",
    );
    const panelSource = readFileSync(
      resolve(process.cwd(), "components/admin/UserWorksPanel.tsx"),
      "utf8",
    );

    expect(pageSource).toContain("loadMoreWorks");
    expect(pageSource).toContain("onLoadPage={loadMoreWorks}");
    expect(panelSource).toContain("useAutoPaginate");
    expect(panelSource).toContain("onScroll={pagination.onScroll}");
    expect(panelSource).not.toContain("上一页");
    expect(panelSource).not.toContain("下一页");
    expect(pageSource).toContain("appendAdminWorksPage(prev.generations, json.generations || [])");

  });

  it("binds the shared scroll-to-top control to the internal works scroller", () => {
    const panelSource = readFileSync(
      resolve(process.cwd(), "components/admin/UserWorksPanel.tsx"),
      "utf8",
    );

    expect(panelSource).toContain(
      'import { ScrollToTopButton } from "@/components/ui/scroll-to-top-button"',
    );
    expect(panelSource).toContain(
      "<ScrollToTopButton scrollContainerRef={gridViewportRef} />",
    );
  });

  it("selects failed works from the user's complete history instead of the visible date range", () => {
    const panelSource = readFileSync(
      resolve(process.cwd(), "components/admin/UserWorksPanel.tsx"),
      "utf8",
    );

    expect(panelSource).toContain("loadAllFailedWorkIds(activeUser.adminKey)");
    expect(panelSource).not.toContain("setSelectedIds(new Set(failedIds))");
  });

  it("keeps failure text on the card without a hover tooltip", () => {
    const panelSource = readFileSync(
      resolve(process.cwd(), "components/admin/UserWorksPanel.tsx"),
      "utf8",
    );

    expect(panelSource).toContain('import { friendlyErrorPrimaryText } from "@/lib/error-friendly"');
    expect(panelSource).toContain("errorMsg?: string | null");
    expect(panelSource).toContain('const failureReason = g.errorMsg ? friendlyErrorPrimaryText(g.errorMsg) : "未记录失败原因"');
    expect(panelSource).not.toContain("title={failureReason}");
    expect(panelSource).not.toContain('role="tooltip"');
    expect(panelSource).toContain("{failureReason}");
  });

  it("returns to all works after clearing unreferenced imports without reloading the empty import filter", () => {
    const pageSource = readFileSync(
      resolve(process.cwd(), "app/admin/page.tsx"),
      "utf8",
    );
    const start = pageSource.indexOf(
      'if (confirmAction.type === "bulk_delete_imports")',
    );
    const end = pageSource.indexOf(
      'if (confirmAction.type === "delete_feedback")',
      start,
    );
    const handler = pageSource.slice(start, end);

    expect(handler).toContain('setWorksTypeFilter("all")');
    expect(handler).not.toContain("await loadUser({ force: true })");
  });
});
