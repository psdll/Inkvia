import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AdminSystemTab active configuration panel", () => {
  it("renders toolbox, pricing, and API configuration as direct active modules", () => {
    const source = readFileSync(resolve(process.cwd(), "components/admin/AdminSystemTab.tsx"), "utf8");

    expect(source).not.toContain("function CollapsibleSystemSection");
    expect(source).toContain("function renderActiveSection");
    expect(source).toContain('case "imageEditModels":');
    expect(source).toMatch(/<section\s+id="sys-image-edit-models"/);
    expect(source).toMatch(/<ImageEditModelsPanel\s+refreshSignal=\{refreshSignal\}\s+active=\{active && activeSection === "imageEditModels"\}/);
    expect(source).toContain('case "billingPrices":');
    expect(source).toMatch(/<section\s+id="sys-billing-prices"/);
    expect(source).toMatch(/<BillingPriceRulesPanel\s+refreshSignal=\{refreshSignal\}\s+active=\{active && activeSection === "billingPrices"\}/);
    expect(source).not.toContain('title="AI 平台 · 一键配置"');
    expect(source).toMatch(/<section\s+id="sys-providers"/);
    expect(source).toMatch(/<ProvidersPanel\s+refreshSignal=\{refreshSignal\}\s+active=\{active && activeSection === "providers"\}/);
  });

  it("keeps the material-management action in the heading and inspiration permissions expanded", () => {
    const systemTab = readFileSync(resolve(process.cwd(), "components/admin/AdminSystemTab.tsx"), "utf8");
    const permissions = readFileSync(
      resolve(process.cwd(), "components/admin/MaterialCreatorInspirationPermissions.tsx"),
      "utf8",
    );

    expect(systemTab.indexOf('href="/admin/material-assets?from=materialAssets"')).toBeLessThan(
      systemTab.indexOf("<MaterialRequestDocSection />"),
    );
    expect(systemTab).toContain("mb-4 flex flex-wrap items-start justify-between gap-3");
    expect(permissions).not.toContain("collapsed");
    expect(permissions).not.toContain("aria-expanded");
    expect(permissions).not.toContain("ChevronDown");
    expect(permissions).not.toContain("ChevronUp");
    expect(permissions).toContain("loading && !rows.length ?");
  });

  it("uses the same accent treatment for both material-library entry actions", () => {
    const systemTab = readFileSync(resolve(process.cwd(), "components/admin/AdminSystemTab.tsx"), "utf8");
    const ossSection = readFileSync(resolve(process.cwd(), "components/admin/AdminOssSection.tsx"), "utf8");
    const accentClasses =
      "border-emerald-500/25 bg-emerald-500/10 px-4 text-[13px] text-emerald-600 transition hover:bg-emerald-500/15 dark:text-emerald-300";

    expect(systemTab).toContain(accentClasses);
    expect(ossSection).toContain(accentClasses);
  });

  it("keeps the add-user form and user list permanently expanded", () => {
    const userManagement = readFileSync(resolve(process.cwd(), "components/admin/UserManagement.tsx"), "utf8");

    expect(userManagement).not.toContain("addPanelOpen");
    expect(userManagement).not.toContain("listOpen");
    expect(userManagement).not.toContain("listVisible");
    expect(userManagement).not.toContain("ChevronDown");
    expect(userManagement).not.toContain("ChevronUp");
    expect(userManagement).toContain("ref={addInputRef}");
    expect(userManagement).toContain("filteredRows.map((row) => (");
  });
});
