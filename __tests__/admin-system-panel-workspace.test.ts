import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("admin system settings workspace", () => {
  it("gives the navigation and active-content panels one shared desktop height", () => {
    const systemTab = readFileSync(
      resolve(process.cwd(), "components/admin/AdminSystemTab.tsx"),
      "utf8",
    );
    const sidebar = readFileSync(
      resolve(process.cwd(), "components/admin/SystemNavSidebar.tsx"),
      "utf8",
    );

    expect(systemTab).toContain('["--system-panel-height" as any]');
    expect(systemTab).toContain("lg:grid");
    expect(systemTab).toContain("lg:h-[var(--system-panel-height)]");
    expect(systemTab).toContain("lg:h-full");
    expect(systemTab).toContain('"lg:overflow-y-auto"');
    expect(sidebar).toContain('height: "var(--system-panel-height)"');
    expect(sidebar).toContain("lg:h-full");
  });

  it("matches the user-management panel framing", () => {
    const systemTab = readFileSync(
      resolve(process.cwd(), "components/admin/AdminSystemTab.tsx"),
      "utf8",
    );
    const sidebar = readFileSync(
      resolve(process.cwd(), "components/admin/SystemNavSidebar.tsx"),
      "utf8",
    );

    expect(sidebar).toContain(
      "border border-[var(--border-2)] bg-[var(--panel-bg)]/92",
    );
    expect(systemTab).toContain(
      "rounded-3xl border border-[var(--border-2)] bg-[var(--panel-bg)]/94",
    );
    expect(systemTab).toContain(
      "[&>div>*]:border-0 [&>div>*]:bg-transparent [&>div>*]:shadow-none",
    );
  });
});
