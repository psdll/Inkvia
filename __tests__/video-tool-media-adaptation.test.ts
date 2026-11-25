import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

describe("video tool media adaptation", () => {
  it("uses the compact player for a single uploaded video and keeps enlargement available", () => {
    const source = readFileSync(
      "components/ui/multi-upload-dropzone.tsx",
      "utf8",
    );

    expect(source).toContain("<AppVideoPlayer");
    expect(source).toContain("showCenterControl={false}");
    expect(source).toContain("playOnSurfaceClick={false}");
    expect(source).not.toContain("onClick={() => openZoom(i)}");
    expect(source).toContain("cursor-zoom-in");
    expect(source).not.toContain("data-upload-zoom-trigger");
    expect(source).toContain("compact");
    expect(source).toContain("data-upload-video-preview");
    expect(source).not.toMatch(/<video\b[^>]*\bcontrols(?:=|\s|>)/);
    expect(source).toContain("previewableItems");
    expect(source).toContain('kind: kind as "image" | "video"');
    expect(source).toContain('kind={activePreview?.kind || "image"}');
    expect(source).toContain("<MediaLightbox");
  });

  it("restores the original medium 16:9 result stage while containing the video", () => {
    const source = readFileSync(
      "components/history/unified-history-panel.tsx",
      "utf8",
    );

    expect(source).toContain("relative aspect-[16/9] w-full max-w-[620px]");
    expect(source).toContain("sm:max-w-[700px] lg:max-w-[800px]");
    expect(source).toContain('className="h-full w-full object-contain"');
    expect(source).not.toContain("h-[min(68dvh,720px)]");
  });

  it("keeps every video task state in one shared surface and opens the full prompt in a dialog", () => {
    const source = readFileSync(
      "components/history/unified-history-panel.tsx",
      "utf8",
    );

    expect(source).toContain("function VideoTaskHeader(");
    expect(source).toContain("function VideoTaskSurface(");
    expect(source.match(/data-video-result-stage="shared"/g)).toHaveLength(1);
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-label="视频任务详细信息"');
    expect(source).toContain("完整提示词");
    expect(source).toContain('data-video-prompt-scroll="true"');
    expect(source).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(source).toContain('<section className="shrink-0">');
    expect(source).not.toContain("min-h-0 flex-1 space-y-5 overflow-auto");
    expect(source).not.toContain("videoPromptExpanded");
  });
});
