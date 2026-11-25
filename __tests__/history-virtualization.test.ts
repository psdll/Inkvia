import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("large history strip virtualization", () => {
  it("uses a horizontal Virtuoso window above the threshold and a direct fallback below it", () => {
    const strip = read("components/history/history-thumbnail-strip.tsx");

    expect(strip).toContain("export const HISTORY_VIRTUALIZE_THRESHOLD = 40");
    expect(strip).toContain("<Virtuoso");
    expect(strip).toContain("horizontalDirection");
    expect(strip).toContain("computeItemKey");
    expect(strip).toContain("endReached");
    expect(strip).toContain("increaseViewportBy");
    expect(strip).toContain("minOverscanItemCount");
    expect(strip).toContain("virtualizeThreshold?: number");
    expect(strip).toContain("const resolvedVirtualizeThreshold = virtualizeThreshold ?? HISTORY_VIRTUALIZE_THRESHOLD");
    expect(strip).toContain("!hasMore && items.length <= resolvedVirtualizeThreshold");
    expect(strip).toContain('behavior: "auto"');
  });

  it("connects stable thumbnail keys, cursor loading, focus scrolling, and small previews", () => {
    const panel = read("components/history/unified-history-panel.tsx");

    expect(panel).toContain("<HistoryThumbnailStrip");
    expect(panel).toContain("onEndReached={loadNextPage}");
    expect(panel).toContain("hasMore={hasMorePages}");
    expect(panel).toContain('url.searchParams.set("source", "tool")');
    expect(panel).toContain('url.searchParams.set("excludeImport", "1")');
    expect(panel).toContain('thumb.groupCount > 1 ? `group_${thumb.groupId}` : (thumb.item.renderKey || thumb.item.id)');
    expect(panel).toContain("thumbnailStripRef.current?.scrollToIndex(index)");
    expect(panel).toContain("data-history-thumbnail={thumb.groupId}");
    expect(panel).toContain("const HISTORY_THUMB_PREVIEW_SIZE = { width: 192, height: 192 } as const");
    expect(panel).not.toContain("previewSize={{ width: 1280, height: 1280 }}");
  });

  it("vertically centers history thumbnails in every state and list mode", () => {
    const strip = read("components/history/history-thumbnail-strip.tsx");
    const panel = read("components/history/unified-history-panel.tsx");

    expect(strip).toContain('className="no-scrollbar flex h-[78px] box-border items-center');
    expect(strip).toContain("CenteredVirtuosoItem");
    expect(strip).toContain('alignItems: "center"');
    expect(strip).not.toContain("TopAlignedVirtuosoItem");
    expect(panel).not.toContain("-translate-y-[1px]");
    expect(panel).toContain('"block h-[60px] w-[60px]');
    expect(panel).toContain('className="flex shrink-0 items-center gap-1');
    expect(panel).toContain('className="shrink-0 rounded-2xl border border-[var(--border)]');
  });

  it("keeps the same thumbnail node when an optimistic task receives its real id", () => {
    const panel = read("components/history/unified-history-panel.tsx");

    expect(panel).toContain("renderKey?: string");
    expect(panel).toContain("renderKey: tempId");
    expect(panel).toContain("renderKey: stableRenderKey");
    expect(panel).toContain('key={thumb.groupCount > 1 ? `group_${thumb.groupId}` : (it.renderKey || it.id)}');
    expect(panel).toContain('border !transition-none relative"');
    expect(panel).toContain('shadow-[var(--shadow-2)] !transition-none"');
    expect(panel).not.toContain('bg-[var(--panel-bg)] p-1 shadow-[var(--shadow-2)] transition-all"');
  });

  it("scrolls each external focus request only once while history reloads", () => {
    const panel = read("components/history/unified-history-panel.tsx");

    expect(panel).toContain("const lastScrolledFocusIdRef = React.useRef<string | null>(null)");
    expect(panel).toContain("if (lastScrolledFocusIdRef.current === focusId) return");
    expect(panel).toContain("lastScrolledFocusIdRef.current = focusId");
  });
});
