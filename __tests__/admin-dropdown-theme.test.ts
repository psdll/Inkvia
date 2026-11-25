import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const themeSource = read("styles/theme-system.css");

const dropdownPanelSources = [
  "components/ui/frosted-select.tsx",
  "components/ui/suggest-select.tsx",
  "components/ui/date-range-picker.tsx",
  "components/admin/UserWorksPanel.tsx",
  "components/admin/UserMaterialAssetsPanel.tsx",
  "app/admin/materials/page.tsx",
] as const;

function collectTsxFiles(directory: string): string[] {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("admin dropdown dark theme contract", () => {
  it("defines one opaque dropdown color and aliases the date range panel to it", () => {
    expect(themeSource.match(/--dropdown-panel-bg:\s*#202020\s*;/g) || []).toHaveLength(1);
    expect(themeSource).toMatch(/--date-range-panel-bg:\s*var\(--dropdown-panel-bg\)\s*;/);
  });

  it("overrides glass effects only inside the effective dark admin route", () => {
    const selector = 'html[data-theme="dark"][data-admin-dropdown-scope="true"] .app-dropdown-panel';
    const start = themeSource.indexOf(`${selector} {`);
    expect(start).toBeGreaterThan(-1);

    const block = start >= 0 ? themeSource.slice(start, themeSource.indexOf("}", start) + 1) : "";
    expect(block).toContain("background: var(--dropdown-panel-bg) !important;");
    expect(block).toContain("background-image: none !important;");
    expect(block).toContain("opacity: 1 !important;");
    expect(block).toContain("-webkit-backdrop-filter: none !important;");
    expect(block).toContain("backdrop-filter: none !important;");
  });

  it("mounts and cleans up the admin route scope marker", () => {
    const scopePath = resolve(root, "components/admin/AdminDropdownThemeScope.tsx");
    expect(existsSync(scopePath)).toBe(true);
    const scopeSource = existsSync(scopePath) ? readFileSync(scopePath, "utf8") : "";
    const layoutSource = read("app/admin/layout.tsx");

    expect(scopeSource).toContain("React.useLayoutEffect");
    expect(scopeSource).toContain('setAttribute("data-admin-dropdown-scope", "true")');
    expect(scopeSource).toContain('removeAttribute("data-admin-dropdown-scope")');
    expect(layoutSource).toContain('import { AdminDropdownThemeScope } from "@/components/admin/AdminDropdownThemeScope"');
    expect(layoutSource).toContain("<AdminDropdownThemeScope />");
  });

  it("marks every shared and local admin dropdown panel with the common surface class", () => {
    expect(read("components/admin/ModelCostsPanel.tsx")).toContain("<FrostedSelect");
    for (const path of dropdownPanelSources) {
      expect(read(path), `${path} is missing app-dropdown-panel`).toContain("app-dropdown-panel");
    }

    expect(read("components/admin/UserWorksPanel.tsx")).not.toContain("backdrop-blur-xl");
    expect(read("components/admin/UserMaterialAssetsPanel.tsx")).not.toContain("backdrop-blur-xl");
  });

  it("keeps native select elements out of administrator UI", () => {
    const adminSource = [...collectTsxFiles("app/admin"), ...collectTsxFiles("components/admin")]
      .map(read)
      .join("\n");

    expect(adminSource).not.toMatch(/<select(?:\s|>)/);
  });
});
