import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "components/history/unified-history-panel.tsx"),
  "utf8",
);

function sourceBetween(start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe("unified history fixed group gallery", () => {
  it("shows every grouped image in generation order inside a fixed fitted grid", () => {
    const groupSurface = sourceBetween(
      ") : hasGroupDisplay && activeGroupId ? (",
      "<CanvasBoard",
    );

    expect(groupSurface).toContain("data-history-result-grid");
    expect(groupSurface).toContain("gridTemplateColumns");
    expect(groupSurface).toContain("gridTemplateRows");
    expect(groupSurface).toContain("activeGroupItems.map((it, groupIndex) =>");
    expect(groupSurface).toContain('className="h-full w-full object-contain"');
    expect(groupSurface).not.toContain('className="absolute w-[280px]');
    expect(groupSurface).not.toContain("startGroupPan");
    expect(groupSurface).not.toContain("updateGroupTileScale");
  });

  it("opens a grouped image on one click and navigates the whole ordered set", () => {
    const groupSurface = sourceBetween(
      ") : hasGroupDisplay && activeGroupId ? (",
      "<CanvasBoard",
    );
    const lightbox = sourceBetween("<MediaLightbox", "<ConfirmDialog");

    expect(groupSurface).toContain("onClick={() => openGroupResultPreview(it.id)}");
    expect(groupSurface).toContain("aria-label={`放大查看组图第 ${groupIndex + 1} 张`}");
    expect(lightbox).toContain("groupResultPreview?.entries[groupResultPreview.index]?.url");
    expect(lightbox).toContain("count: groupResultPreview.entries.length");
    expect(lightbox).toContain("activeIndex: groupResultPreview.index");
    expect(lightbox).toContain("onPrev={groupResultPreview ?");
    expect(lightbox).toContain("onNext={groupResultPreview ?");
  });

  it("does not show grid-cutting controls inside grouped results", () => {
    const groupSurface = sourceBetween(
      ") : hasGroupDisplay && activeGroupId ? (",
      "<CanvasBoard",
    );

    expect(groupSurface).not.toContain('title="宫格切分"');
    expect(groupSurface).not.toContain("groupCropMenuOpenId");
    expect(groupSurface).not.toContain("toggleGroupCropPreview");
    expect(groupSurface).toContain("onClick={() => openGroupResultPreview(it.id)}");
    expect(groupSurface).toContain("download");
  });

  it("keeps grouped download controls at the top right and reveals them on hover like a single image", () => {
    const groupSurface = sourceBetween(
      ") : hasGroupDisplay && activeGroupId ? (",
      "<CanvasBoard",
    );

    expect(groupSurface).toContain('className="absolute right-2 top-9 z-30"');
    expect(groupSurface).toContain("opacity-0");
    expect(groupSurface).toContain("group-hover:pointer-events-auto");
    expect(groupSurface).toContain("group-hover:opacity-100");
    expect(groupSurface).toContain("href={it.url}");
    expect(groupSurface).toContain("download");
  });

  it("keeps the existing single-image canvas branch", () => {
    expect(source).toContain("<CanvasBoard");
    expect(source).toContain("src={activeDisplayUrl}");
    expect(source).toContain('fitMode="contain"');
  });
});
