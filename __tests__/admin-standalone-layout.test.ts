import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("admin standalone layout", () => {
  it("keeps the existing full-width web admin layout", () => {
    const header = read("components/admin/AdminTopHeader.tsx");
    const page = read("app/admin/page.tsx");
    const overview = read("components/admin/AdminOverviewTab.tsx");
    const feedback = read("components/admin/FeedbackCenterPanel.tsx");
    const userSidebar = read("components/admin/UserListSidebar.tsx");

    expect(header).toContain(
      '" : "pointer-events-none fixed left-0 right-0',
    );
    expect(
      [header, page, overview, feedback].join("\n"),
    ).not.toContain("md:pl-[76px]");
    expect(page).toContain('["--admin-fixed-nav-offset" as any]: "0px"');
    expect(userSidebar).toContain("var(--admin-fixed-nav-offset, 0px)");
  });
});
