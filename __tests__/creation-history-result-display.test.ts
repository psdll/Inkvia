import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const board = readFileSync("components/ui/canvas-board.tsx", "utf8").replace(/\r\n/g, "\n");
const history = readFileSync("components/history/unified-history-panel.tsx", "utf8").replace(/\r\n/g, "\n");
const displayAssets = readFileSync("lib/generation-display-assets.ts", "utf8").replace(/\r\n/g, "\n");

describe("creation history result display", () => {
  it("renders the preview but downloads the original provider result", () => {
    expect(board).toContain("downloadSrc?: string;");
    expect(board).toContain("const primaryDownloadSrc = downloadSrc || src;");
    expect(board).toContain("triggerDownload(primaryDownloadSrc, primaryFilename);");
    expect(history).toContain("downloadSrc={activeItem.url}");
  });

  it("silently swaps the history preview to the original image when the user zooms in", () => {
    expect(board).toContain("originalSrc?: string;");
    expect(history).toContain("originalSrc={activeItem.url}");
    expect(board).toContain("if (ratio > 1) requestOriginal();");
    expect(board).toContain("if (e.deltaY < 0) requestOriginal();");
    expect(board).toContain("const image = new Image();");
    expect(board).toContain("image.onload = () => {");
    expect(board).toContain("setPrimaryRenderSrc(nextOriginalSrc);");
    expect(board).toContain("setOriginalRequested(false);");
  });

  it("fits the initial result to the available stage instead of forcing 24 percent", () => {
    expect(board).not.toContain("defaultOverallScale = 0.24");
    expect(board).toContain("const [scale, setScale] = React.useState(1);");
    expect(board).toContain("setScale(1);");
  });

  it("keeps the image hidden behind a stable loading state until the current source is ready", () => {
    expect(board).toContain('const primaryReady = primaryLoadState?.src === src && primaryLoadState.status === "loaded";');
    expect(board).toContain('data-canvas-image-loading="true"');
    expect(board).toContain('primaryReady ? "opacity-100" : "pointer-events-none opacity-0"');
    expect(board).toContain("primaryReady && !gridSpec ? (");
  });

  it("waits silently for the generated image preview instead of rendering the original result", () => {
    expect(history).toContain("phase?: string | null;");
    expect(history).toContain('if (item.phase === "saving" && typeGroup(item.type) !== "video") return "";');
    expect(history).toContain("phase: record.phase ? String(record.phase) : null,");
    expect(history).toContain("current.phase !== status.phase");
    expect(history).toContain("const silentlyWaitingForImagePreview = isWaitingForImagePreview(activeItem) && !hasDisplayOutput && !hasGroupDisplay;");
    expect(history).toContain("isGenerating && !hasDisplayOutput && !hasGroupDisplay ? (");
    expect(history).toContain("silentlyWaitingForImagePreview ? null : isVideoTask");
    expect(history).toContain("const groupItemSilentlyWaitingForPreview = isWaitingForImagePreview(groupItem) && !groupDisplayUrl;");
    expect(history).toContain("groupItemSilentlyWaitingForPreview ? null : groupItemGenerating");
    expect(history).not.toContain("getHistoryDisplayUrl(groupItem) || groupItem.url");
    expect(history).toContain("showLoadingIndicator={false}");
  });

  it("creates the active preview and grid thumbnail in parallel before publishing the result", () => {
    expect(displayAssets).toContain("await Promise.all([");
    expect(displayAssets).toContain("createMediaLibraryImagePreview(buffer");
    expect(displayAssets).toContain("createMediaLibraryGridThumbnail(buffer");
    expect(displayAssets).toContain("const thumbUrl = generatedThumbUrl || previewUrl;");
  });

  it("matches the batch video download control and only reveals it while hovering the material", () => {
    expect(board).toContain('className="group relative inline-block"');
    expect(board).toContain("bg-black/45 text-white/80 opacity-0 transition-opacity");
    expect(board).toContain("group-hover:pointer-events-auto group-hover:opacity-100");
    expect(board).toContain("clamp(1 / v, 1 / MAX_CANVAS_ZOOM, 1 / MIN_CANVAS_ZOOM)");
  });
});
