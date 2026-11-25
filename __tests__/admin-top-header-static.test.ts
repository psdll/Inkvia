import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin top header", () => {
  it("stays visible with the original content offset", () => {
    const header = readFileSync(
      resolve(process.cwd(), "components/admin/AdminTopHeader.tsx"),
      "utf8",
    );
    const page = readFileSync(
      resolve(process.cwd(), "app/admin/page.tsx"),
      "utf8",
    );
    const globalStyles = readFileSync(
      resolve(process.cwd(), "app/globals.css"),
      "utf8",
    );

    expect(header).not.toContain("admin-auto-hide-header");
    expect(header).not.toContain("admin-top-header-trigger");
    expect(header).toContain(
      'style={desktopMode ? undefined : { top: "calc(var(--global-notice-height, 0px) + 12px)" }}',
    );
    expect(page).not.toContain("admin-auto-hide-content");
    expect(globalStyles).not.toContain("管理后台顶部栏：桌面端收成顶部感应边");
  });
});
