import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "app/video/video-tool.tsx"), "utf8");

describe("video error overlay layout", () => {
  it("floats failure messages above the footer without shrinking the prompt editor", () => {
    const footerStart = source.indexOf("const footerContent = (");
    const footerEnd = source.indexOf("if (sharedHistory) {", footerStart);

    expect(footerStart).toBeGreaterThanOrEqual(0);
    expect(footerEnd).toBeGreaterThan(footerStart);

    const footer = source.slice(footerStart, footerEnd);
    const overlayStart = footer.indexOf("data-video-error-overlay");
    const controlsStart = footer.indexOf("requiresFaceAcknowledgement");

    expect(overlayStart).toBeGreaterThanOrEqual(0);
    expect(controlsStart).toBeGreaterThan(overlayStart);

    const overlay = footer.slice(overlayStart, controlsStart);
    expect(footer).toContain(
      'className="pointer-events-none absolute bottom-[calc(100%+12px)] left-0 right-0 z-30 flex flex-col gap-3"',
    );
    expect(overlay).toContain("mediaIssueMessage");
    expect(overlay).toContain("<FriendlyErrorBlock error={error} />");
  });

  it("keeps long failure details inside a vertically scrollable overlay", () => {
    const overlayStart = source.indexOf("data-video-error-overlay");
    const overlayEnd = source.indexOf("{requiresFaceAcknowledgement", overlayStart);

    expect(overlayStart).toBeGreaterThanOrEqual(0);
    expect(overlayEnd).toBeGreaterThan(overlayStart);

    const overlay = source.slice(overlayStart, overlayEnd);
    for (const className of [
      "max-h-[min(32dvh,240px)]",
      "max-w-full",
      "min-w-0",
      "overflow-x-hidden",
      "overflow-y-auto",
      "overscroll-contain",
      "break-all",
    ]) {
      expect(overlay).toContain(className);
    }
  });

  it("drops a deleted material error while preserving any remaining failed material", () => {
    const itemChangeStart = source.indexOf("const setFrameItems = React.useCallback");
    const itemChangeEnd = source.indexOf("useIsoLayoutEffect(() => {", itemChangeStart);

    expect(source).toContain("const materialErrorRef = React.useRef<FriendlyUiError | null>(null)");
    expect(source).toContain("const syncMaterialErrorAfterItemsChange = React.useCallback");
    expect(source).toContain("const removedFailedItem = previousItems.some");
    expect(source).toContain("const remainingUploadError = nextItems");
    expect(source).toContain("current === currentMaterialError ? null : current");
    expect(itemChangeStart).toBeGreaterThanOrEqual(0);
    expect(itemChangeEnd).toBeGreaterThan(itemChangeStart);

    const itemChanges = source.slice(itemChangeStart, itemChangeEnd);
    expect(itemChanges.match(/syncMaterialErrorAfterItemsChange\(/g)).toHaveLength(2);
    expect(source.match(/setMaterialError\(normalizeApiFriendlyError\(/g)).toHaveLength(5);
  });
});
