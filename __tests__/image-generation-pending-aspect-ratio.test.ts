import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const imageToolSource = readFileSync(resolve(process.cwd(), "app/image/image-tool.tsx"), "utf8");
const historySource = readFileSync(resolve(process.cwd(), "components/history/unified-history-panel.tsx"), "utf8");

function sourceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe("image generation pending aspect ratio", () => {
  it("carries the submitted aspect ratio into optimistic history items", () => {
    const pendingCall = sourceBetween(
      imageToolSource,
      "historyRef.current?.addPendingItems(",
      ") || []",
    );
    const pendingBuilder = sourceBetween(
      historySource,
      "const addPendingItems = React.useCallback",
      "const removePendingItem = React.useCallback",
    );

    expect(pendingCall).toContain("params: { aspectRatio,");
    expect(historySource).toContain("params?: Record<string, unknown>");
    expect(pendingBuilder).toContain("params: input.params || null");
  });

  it("uses the submitted ratio for generating and failed group frames", () => {
    const groupRenderer = sourceBetween(
      historySource,
      "activeGroupItems.map((it, groupIndex) => {",
      "<CanvasBoard",
    );
    const failedFrame = sourceBetween(
      groupRenderer,
      ") : groupItemFailed && !groupDisplayUrl ? (",
      ") : (",
    );

    expect(groupRenderer).toContain("getHistoryItemAspectRatio(it, natural)");
    expect(groupRenderer).toContain("style={{ aspectRatio: ratio }}");
    expect(groupRenderer).not.toContain(
      'groupItemGenerating && !groupDisplayUrl ? (\n                                      <div className="flex aspect-square',
    );
    expect(groupRenderer).toContain(
      'className="h-full w-full object-contain"',
    );
    expect(failedFrame).toContain("style={{ aspectRatio: ratio }}");
    expect(failedFrame).not.toContain("aspect-square");
  });

  it("shows each failed task's friendly failure reason on its frame", () => {
    const groupRenderer = sourceBetween(
      historySource,
      "activeGroupItems.map((it, groupIndex) => {",
      "<CanvasBoard",
    );
    const failedFrame = sourceBetween(
      groupRenderer,
      ") : groupItemFailed && !groupDisplayUrl ? (",
      ") : (",
    );

    expect(groupRenderer).toContain("const failureReason =");
    expect(groupRenderer).toContain("friendlyErrorPrimaryText(it.errorMsg)");
    expect(groupRenderer).toContain('"未返回失败原因"');
    expect(failedFrame).toContain("{failureReason}");
    expect(failedFrame).toContain("title={failureReason}");
  });
});
