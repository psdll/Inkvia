import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (file: string) => readFileSync(file, "utf8");

describe("settings information architecture", () => {
  it("keeps preferences usable independently of same-page statistics", () => {
    const page = read("app/settings/page.tsx");
    expect(page).toContain("<GeneralSettingsPanel />");
    expect(page).toContain("<AccountUsageSection />");
    const usage = read("components/settings/account-usage-section.tsx");
    expect(usage).toContain("<ProfileCard />");
    expect(usage).toContain("<ModelUsagePanel />");
    expect(page).not.toContain("AtomicPageReveal");
    expect(page).not.toContain("useQuery");
  });
  it("retains the legacy administrator login and separate session gate", () => {
    expect(read("app/settings/page.tsx")).toContain('params.get("admin") === "1"');
    expect(read("app/admin/layout.tsx")).toContain("<AdminSessionGate initialAuthenticated={Boolean(verifyAdminToken(cookies().get(adminCookieName())?.value))}>");
    expect(read("app/admin/activity/page.tsx")).toContain("user?.isAdmin ? <SettingsLogsPanel />");
  });
  it("keeps material tools permission gated in the material library", () => {
    const tools = read("components/settings/material-tools.tsx");
    expect(tools).toContain("data?.canUploadMaterial");
    expect(tools).toContain("data?.hasMaterialInspirations");
    expect(read("app/materials/page.tsx")).toContain("<MaterialTools />");
  });
  it("retains statistics on web and redirects legacy desktop settings", () => {
    expect(read("components/settings/account-menu.tsx")).toContain('href={desktopMode ? "/admin?view=usage" : "/settings#usage"}');
    expect(read("components/settings/account-usage-section.tsx")).toContain('id="usage"');
    expect(read("components/admin/AdminOverviewTab.tsx")).toContain("<AccountUsageSection />");
    expect(read("app/usage/page.tsx")).toContain('redirect("/settings#usage")');
  });
});
