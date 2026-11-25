import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("works asset scalability", () => {
  it("virtualizes date-grouped asset rows against the page scroll container", () => {
    const source = read("app/works/page.tsx");

    expect(source).toContain('from "react-virtuoso";');
    expect(source).toContain("<Virtuoso");
    expect(source).toContain("buildVirtualAssetRows");
    expect(source).toContain("customScrollParent={scrollRootElement}");
    expect(source).toContain("increaseViewportBy={{ top: Math.min(480, viewportHeight), bottom: Math.min(960, viewportHeight) }}");
    expect(source).not.toContain("disableVirtualization");
    expect(source).not.toContain("VirtualizedMediaGrid");
  });

  it("keeps video posters lazy until their rows approach the viewport", () => {
    const source = read("components/ui/hover-preview-video.tsx");

    expect(source).toContain('loading={eager ? "eager" : "lazy"}');
    expect(source).not.toContain('loading="eager"');
  });

  it("shows explicit localized paging and completion states", () => {
    const source = read("app/works/page.tsx");

    expect(source).toContain("正在加载更多资产");
    expect(source).toContain("加载失败，点击重试");
    expect(source).toContain("已展示全部资产");
  });
});
