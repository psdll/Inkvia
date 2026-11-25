import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const productPage = readFileSync(resolve(root, "app/admin/materials/page.tsx"), "utf8");
const materialPage = readFileSync(resolve(root, "app/admin/material-assets/page.tsx"), "utf8");
const materialRoute = readFileSync(resolve(root, "app/api/admin/material-assets/route.ts"), "utf8");
const systemTab = readFileSync(resolve(root, "components/admin/AdminSystemTab.tsx"), "utf8");

describe("admin library loading performance", () => {
  it("loads the product library in pages without warming every media item", () => {
    expect(productPage).toContain("const ADMIN_MEDIA_PAGE_SIZE = 48");
    expect(productPage).toContain('url.searchParams.set("page", String(page))');
    expect(productPage).toContain('url.searchParams.set("pageSize", String(ADMIN_MEDIA_PAGE_SIZE))');
    expect(productPage).toContain('mode: "replace" | "append"');
    expect(productPage).toContain("加载更多");
    expect(productPage).not.toContain('url.searchParams.set("all", "1")');
    expect(productPage).not.toContain('url.searchParams.set("ts", String(Date.now()))');
    expect(productPage).not.toContain("new window.Image()");
  });

  it("only gives eager priority to the first product and material thumbnails", () => {
    expect(productPage).toContain('loading={eagerItemIds.has(item.id) ? "eager" : "lazy"}');
    expect(materialPage).toContain('loading={eager ? "eager" : "lazy"}');
    expect(materialPage).toContain("const PAGE_SIZE = 48");
  });

  it("does not recompute material filter metadata for appended pages", () => {
    expect(materialPage).toContain('params.set("includeOptions", mode === "append" ? "0" : "1")');
    expect(materialRoute).toContain('const includeOptions = searchParams.get("includeOptions") !== "0"');
    expect(materialRoute).toContain("includeOptions ? listMaterialAssetOptionValues() : Promise.resolve(null)");
  });

  it("keeps library entry preloads available without eagerly warming all settings", () => {
    expect(systemTab).toContain("product: loadAdminOssSection");
    expect(systemTab).toMatch(/materialAssets:\s*\(\) =>\s*Promise\.all\(\[/);
    expect(systemTab).toContain("onPrefetch={preloadAdminSystemSection}");
    expect(systemTab).not.toContain("SYSTEM_SECTION_WARMUP_ORDER");
  });
});
