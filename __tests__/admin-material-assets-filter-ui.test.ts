import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("administrator material filter UI", () => {
  const source = readFileSync(resolve(process.cwd(), "app/admin/material-assets/page.tsx"), "utf8");

  it("uses one user-page-style filter trigger for status, creator, and category-linked models", () => {
    expect(source).toContain("function AdminMaterialsFilterPanel");
    expect(source).toContain("<Filter");
    expect(source).toContain("筛选");
    expect(source).toContain('title="状态"');
    expect(source).toContain('title="制作人"');
    expect(source).toContain("visibleModelGroups");
    expect(source).toContain("activeFilterCount");
    expect(source).not.toContain("<FrostedSelect");
  });

  it("propagates modelName to list, idsOnly, and filtered-delete requests", () => {
    expect(source).toContain('params.set("modelName", activeModelName)');
    expect(source).toContain("modelName: activeModelName");
    expect(source).toContain("[activeCategory, activeCreator, activeModelName");
  });

  it("renders and exits uncategorized only from server inventory metadata", () => {
    expect(source).toContain("hasUncategorized === true");
    expect(source).toContain('activeCategory === "uncategorized" && hasUncategorized === false');
    expect(source).toContain('setActiveCategory("all")');
  });

  it("keeps date range, search, and refresh outside the filter panel", () => {
    const panelStart = source.indexOf("function AdminMaterialsFilterPanel");
    const panelSource = source.slice(panelStart);

    expect(source).toContain("<DateRangePicker");
    expect(panelSource).not.toContain("<DateRangePicker");
    expect(panelSource).not.toContain('placeholder="搜索标题');
  });
});
