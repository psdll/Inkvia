import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const historySource = readFileSync(
  resolve(process.cwd(), "components/history/unified-history-panel.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe("history group selection sync", () => {
  it("selects the matching history item when a result tile is pressed", () => {
    const previewHandler = sourceBetween(
      historySource,
      "const openGroupResultPreview = React.useCallback",
      "  const metaHoverPortal =",
    );

    expect(previewHandler).toContain("userPinnedActiveRef.current = true");
    expect(previewHandler).toContain("setActiveId(itemId)");
    expect(previewHandler).toContain("setGroupResultPreview({ entries, index })");
    expect(historySource).toContain("onClick={() => openGroupResultPreview(it.id)}");
  });

  it("shows every item in a batch without an inner horizontal scroller", () => {
    const groupedHistoryItem = sourceBetween(
      historySource,
      "if (thumb.groupCount > 1) {",
      "              return (\n                <div key={thumb.groupCount",
    );

    expect(groupedHistoryItem).toContain('className="flex gap-1"');
    expect(groupedHistoryItem).not.toContain("max-w-[260px]");
    expect(groupedHistoryItem).not.toContain("overflow-x-auto");
  });

  it("highlights the matching result tile when a history item is clicked", () => {
    const groupedHistoryItem = sourceBetween(
      historySource,
      "if (thumb.groupCount > 1) {",
      "              return (\n                <div key={thumb.groupCount",
    );
    const historyClickHandler = sourceBetween(
      groupedHistoryItem,
      "onClick={() => {",
      "onDoubleClick={() => {",
    );

    expect(historyClickHandler).toContain("userPinnedActiveRef.current = true");
    expect(historyClickHandler).toContain("setActiveId(groupItem.id)");
    expect(groupedHistoryItem).toContain("const groupItemActive = groupItem.id === activeId");
  });

  it("renders an independent regenerate action for every completed group item", () => {
    const groupedHistoryItem = sourceBetween(
      historySource,
      "if (thumb.groupCount > 1) {",
      "              return (\n                <div key={thumb.groupCount",
    );
    const groupedItemMap = sourceBetween(
      groupedHistoryItem,
      "thumb.groupItems.map((groupItem, groupIndex) => {",
      "                    </div>\n                    {active ? (",
    );

    expect(groupedItemMap).toContain("const groupItemHasOutput = !!groupItem.url");
    expect(groupedItemMap).toContain(
      "groupItemHasOutput && !groupItemGenerating && !groupItemFailed",
    );
    expect(groupedItemMap).toContain("void applyTemplate(groupItem)");
    expect(groupedItemMap).toContain("applyingVideoTemplateId === groupItem.id");
    expect(groupedHistoryItem).not.toContain(
      "activeItem && getHistoryDisplayGroupKey(activeItem) === thumb.groupId ? activeItem : it",
    );
  });

  it("lays out every selected group as a fixed fitted grid", () => {
    const groupGrid = sourceBetween(
      historySource,
      "const activeGroupGrid = React.useMemo",
      "  const thumbItems = React.useMemo",
    );

    expect(groupGrid).toContain("const columns = count <= 2 ? count : count <= 4 ? 2 : count <= 9 ? 3 : 4");
    expect(groupGrid).toContain("rows: Math.ceil(count / columns)");
    expect(historySource).toContain("data-history-result-grid");
    expect(historySource).toContain("activeGroupItems.map((it, groupIndex) => {");
    expect(historySource).toContain('className="h-full w-full object-contain"');
    expect(historySource).not.toContain("activeGroupTileId");
    expect(historySource).not.toContain("setGroupTileScale");
  });
});
