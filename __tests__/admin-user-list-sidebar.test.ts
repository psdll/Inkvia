import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin user list sidebar", () => {
  it("renders only the identity and actions in each user card", () => {
    const sidebar = readFileSync(
      resolve(process.cwd(), "components/admin/UserListSidebar.tsx"),
      "utf8",
    );

    expect(sidebar).toContain("adminDisplayName(item)");
    expect(sidebar).toContain("onRequestExport");
    expect(sidebar).toContain("onRequestDelete");
    expect(sidebar).not.toContain("item.failureRate");
    expect(sidebar).not.toContain("item.generationCount");
    expect(sidebar).not.toContain("item.deviceCount");
    expect(sidebar).not.toContain("fmtTime(item.lastCreatedAt)");
    expect(sidebar).not.toContain("item.summary.map");
    expect(sidebar).not.toContain("ID: {item.userId}");
  });

  it("keeps user rows as a compact navigational list", () => {
    const sidebar = readFileSync(
      resolve(process.cwd(), "components/admin/UserListSidebar.tsx"),
      "utf8",
    );
    const adminPage = readFileSync(
      resolve(process.cwd(), "app/admin/page.tsx"),
      "utf8",
    );

    expect(sidebar).toContain("mb-2 w-full h-14 px-3");
    expect(sidebar).toContain("border border-[var(--border)]");
    expect(sidebar).toContain("hover:border-[var(--border-2)] hover:bg-[var(--panel-2)]");
    expect(sidebar).toContain("border border-[var(--primary-bg)] bg-[var(--panel-2)]");
    expect(sidebar).toContain("group-hover:opacity-100");
    expect(sidebar).not.toContain("h-12 px-3");
    expect(sidebar).toContain('className="h-full overflow-auto pr-1"');
    expect(sidebar).toContain('itemContent={(_, u) => <div className="pr-1">');
    expect(sidebar).toContain('title={displayName}');
    expect(adminPage).toContain('["--user-nav-width" as any]: "230px"');
    expect(sidebar).not.toContain("border-transparent hover:border-[var(--border)]");
  });

  it("provides a stable update notice and manual ranking action", () => {
    const sidebar = readFileSync(
      resolve(process.cwd(), "components/admin/UserListSidebar.tsx"),
      "utf8",
    );
    const adminPage = readFileSync(
      resolve(process.cwd(), "app/admin/page.tsx"),
      "utf8",
    );

    expect(sidebar).toContain("reconcileStableUserOrder");
    expect(sidebar).toContain("countUserOrderChanges");
    expect(sidebar).toContain("有新的生成活动");
    expect(sidebar).toContain("按最近生成排序");
    expect(sidebar).toContain("更新排序");
    expect(sidebar).toContain('aria-live="polite"');
    expect(sidebar).toContain('data-active={active ? "true" : undefined}');
    expect(sidebar).toContain("orderRefreshSignal");
    expect(adminPage).toContain("setUserOrderRefreshKey");
    expect(adminPage).toContain("orderRefreshSignal={userOrderRefreshKey}");
  });
});
