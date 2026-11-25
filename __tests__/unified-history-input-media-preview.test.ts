import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VideoInputAssetStrip } from "@/components/history/unified-history-panel";

const historyApiSource = readFileSync(
  resolve(process.cwd(), "app/api/history/route.ts"),
  "utf8",
);
const historyPanelSource = readFileSync(
  resolve(process.cwd(), "components/history/unified-history-panel.tsx"),
  "utf8",
);

function renderAssetStrip(item: Record<string, unknown>) {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    return renderToStaticMarkup(React.createElement(VideoInputAssetStrip as any, {
      item,
      onOpen: () => undefined,
    }));
  } finally {
    consoleError.mockRestore();
  }
}

describe("unified history input media previews", () => {
  it("opens video task references as one framed collection with previous and next navigation", () => {
    expect(historyPanelSource).toContain("const openReferenceZoom = React.useCallback");
    expect(historyPanelSource).toContain("previewableAssets");
    expect(historyPanelSource).toContain("onOpen(previewableAssets, previewIndex)");
    expect(historyPanelSource.match(/onOpen=\{openReferenceZoom\}/g) || []).toHaveLength(3);
    expect(historyPanelSource).toContain("const [referencePreview, setReferencePreview]");
    expect(historyPanelSource).toContain('layout={referencePreview || groupResultPreview ? "floating" : "content"}');
    expect(historyPanelSource).toContain("counter={referencePreview");
    expect(historyPanelSource).toContain("counterAlwaysVisible={Boolean(referencePreview || groupResultPreview)}");
    expect(historyPanelSource).toContain("onPrev={groupResultPreview ?");
    expect(historyPanelSource).toContain("onNext={groupResultPreview ?");
    expect(historyPanelSource).toContain("setReferencePreview((current) => current");
    expect(historyPanelSource).not.toContain("zoomLayout");
    expect(historyPanelSource).not.toContain("zoomTitle");
  });

  it("renders persisted image, video, and audio inputs from the history API shape", () => {
    expect(historyApiSource).toContain("localPreviewUrl,");
    expect(historyApiSource).toContain("kind: input.media.kind");
    const markup = renderAssetStrip({
      params: {
        inputMedia: [
          { localPreviewUrl: "/uploads/tool_inputs/reference.jpg", kind: "image", role: "reference_image" },
          { localPreviewUrl: "/uploads/tool_inputs/reference.mp4", kind: "video", role: "reference_video" },
          { localPreviewUrl: "/uploads/tool_inputs/reference.mp3", kind: "audio", role: "reference_audio" },
        ],
      },
    });

    expect(markup.match(/<img\b/g) || []).toHaveLength(1);
    expect(markup.match(/<video\b/g) || []).toHaveLength(1);
    expect(markup).toContain("<audio");
    expect(markup).toContain('src="/uploads/tool_inputs/reference.mp4"');
    expect(markup).not.toContain('src="/uploads/tool_inputs/reference.mp3"');
    expect(markup).toContain('title="参考音频 3/3"');
    expect(markup).not.toContain("预览加载失败");
  });

  it("keeps rendering legacy url and type input media", () => {
    const markup = renderAssetStrip({
      params: {
        inputMedia: [
          { url: "/uploads/imports/legacy.webp", type: "image", role: "reference_image" },
          { url: "/uploads/imports/legacy.webm", type: "video", role: "reference_video" },
          { url: "/uploads/imports/legacy.wav", type: "audio", role: "reference_audio" },
        ],
      },
    });

    expect(markup.match(/<img\b/g) || []).toHaveLength(1);
    expect(markup.match(/<video\b/g) || []).toHaveLength(1);
    expect(markup).toContain("<audio");
    expect(markup).toContain('src="/uploads/imports/legacy.webm"');
    expect(markup).not.toContain('src="/uploads/imports/legacy.wav"');
    expect(markup).toContain('title="参考音频 3/3"');
  });

  it("renders every ordered reference asset when only some inputs have persisted media", () => {
    const markup = renderAssetStrip({
      params: {
        referenceAssets: [
          { kind: "video", url: "/uploads/imports/reference.mp4", role: "reference_video" },
          { kind: "audio", url: "/uploads/imports/reference.mp3", role: "reference_audio" },
        ],
        imagePaths: [
          "/uploads/imports/reference.mp4",
          "/uploads/imports/reference.mp3",
        ],
        inputMedia: [
          {
            localPreviewUrl: "/uploads/imports/reference.mp4",
            kind: "video",
            role: "reference_video",
            position: 0,
          },
        ],
      },
    });

    expect(markup.match(/<button\b/g) || []).toHaveLength(2);
    expect(markup).toContain('title="参考视频 1/2"');
    expect(markup).toContain('title="参考音频 2/2"');
    expect(markup).toContain('src="/uploads/imports/reference.mp4"');
    expect(markup).not.toContain('src="/uploads/imports/reference.mp3"');
  });
});
