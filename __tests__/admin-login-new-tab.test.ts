import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(process.cwd(), "components/settings/admin-login-panel.tsx"),
  "utf8",
);

describe("admin login navigation", () => {
  it("enters the console in a new tab after authentication and keeps the current page", () => {
    expect(source).toContain('window.open("/admin", "_blank")');
    expect(source).toContain('adminTab.opener = null');
    expect(source.indexOf('window.open')).toBeGreaterThan(source.indexOf('if (!res.ok)'));
    expect(source).not.toContain('window.open("", "_blank")');
    expect(source).not.toContain('正在验证管理员身份');
    expect(source).not.toContain("window.location.assign");
    expect(source).toContain('setPassword("");');
  });
});
