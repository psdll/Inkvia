import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const pageSource = readFileSync(resolve(root, "app/admin/page.tsx"), "utf8");
const worksSource = readFileSync(resolve(root, "components/admin/UserWorksPanel.tsx"), "utf8");

describe("admin user assets surgical upgrade", () => {
  it("collects destructive user actions under one neutral menu", () => {
    expect(pageSource).toContain("用户危险操作");
    expect(pageSource).toContain('role="menu"');
    expect(pageSource).toContain("清理用户数据");
    expect(pageSource).toContain("删除当前用户");
    expect(pageSource).toContain('aria-haspopup="menu"');
    expect(pageSource).not.toContain('className="h-[42px] px-[18px] rounded-xl bg-amber-500 text-white');
    expect(pageSource).not.toContain('className="h-[42px] px-[18px] rounded-xl bg-rose-600 text-white');
  });

  it("loads only virtualized mixed asset rows without duplicate image prewarming", () => {
    expect(worksSource).toContain('import { Virtuoso } from "react-virtuoso"');
    expect(worksSource).toContain('loading="eager"');
    expect(worksSource).toContain("warmOnLoad={false}");
    expect(worksSource).toContain("group relative aspect-square");
    expect(worksSource).toContain("group group/media relative aspect-square");
    expect(worksSource).toContain("sticky top-0");
  });
});
