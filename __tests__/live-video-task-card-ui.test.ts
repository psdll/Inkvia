import { existsSync } from "node:fs";
import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

describe("live video task card UI", () => {
  it("matches the custom-batch compact result, prompt, and media regions", () => {
    const path = "components/batch-workbench/live-video-task-card.tsx";
    expect(existsSync(path)).toBe(true);
    const source = readFileSync(path, "utf8");
    const result = source.indexOf('data-region="task-result-region"');
    const prompt = source.indexOf('data-region="task-prompt-region"', result + 1);
    const media = source.indexOf('data-region="task-media-region"', prompt + 1);

    expect(result).toBeGreaterThanOrEqual(0);
    expect(prompt).toBeGreaterThan(result);
    expect(media).toBeGreaterThan(prompt);
    expect(source).toContain("aspect-[3/4]");
    expect(source).toContain("createPortal");
    expect(source).toContain("const PROMPT_TOOLTIP_DELAY_MS = 800;");
    expect(source).toContain("resize overflow-auto");
    expect(source).toContain("<AppVideoPlayer");
    expect(source).toContain("<MediaLightbox");
    expect(source).toContain("重试分析");
    expect(source).toContain("重试视频");
    expect(source).toContain("下载 MP4");
  });

  it("keeps a committed prompt visible while the server update is pending", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-task-card.tsx",
      "utf8",
    );

    expect(source).toContain("}, [item.prompt]);");
    expect(source).not.toContain("[item.prompt, promptEditorOpen]");
  });

  it("keeps the prompt hover preview available while video generation is active", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-task-card.tsx",
      "utf8",
    );
    const scheduleStart = source.indexOf("const schedulePromptTooltip");
    const scheduleEnd = source.indexOf("const commitPrompt", scheduleStart);
    const schedule = source.slice(scheduleStart, scheduleEnd);
    const promptSectionRef = source.indexOf("ref={promptEditorRef}");
    const sectionStart = source.lastIndexOf("<section", promptSectionRef);
    const buttonStart = source.indexOf("<button", sectionStart);
    const sectionOpening = source.slice(sectionStart, buttonStart);
    const buttonEnd = source.indexOf("</button>", buttonStart);
    const button = source.slice(buttonStart, buttonEnd);

    expect(schedule).toContain("promptActive");
    expect(schedule).not.toContain("busy");
    expect(sectionOpening).toContain("onMouseEnter");
    expect(sectionOpening).toContain("onMouseLeave");
    expect(button).not.toContain("onMouseEnter");
    expect(button).toContain("disabled={busy}");
  });

  it("uses the custom-batch media gallery for upload, replace, preview, and delete", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-task-card.tsx",
      "utf8",
    );

    expect(source).toContain("BatchMediaGallery");
    expect(source).toContain("liveVideoItemMediaRelations(item)");
    expect(source).toContain("onMediaUpload");
    expect(source).toContain("onMediaRemove");
    expect(source).toContain("multiple={false}");
    expect(source).not.toContain("<ResilientImage");
  });

  it("shows live elapsed seconds while video generation is active", () => {
    const card = readFileSync(
      "components/batch-workbench/live-video-task-card.tsx",
      "utf8",
    ).replace(/\r\n?/g, "\n");
    const workspace = readFileSync(
      "hooks/use-live-video-batch-workspace.ts",
      "utf8",
    );

    expect(workspace).toContain("startedAt?: string | null;");
    expect(card).toContain('import { elapsedSeconds } from "@/lib/image-batch/contracts";');
    expect(card).toContain("window.setInterval(tick, 1000)");
    expect(card).toContain("elapsedSeconds(\n    output?.startedAt,\n    null,\n  )");
    expect(card).toContain("视频生成中 · ${seconds} 秒");
    expect(card).not.toContain("${batch.videoSettings.duration || 4} 秒视频生成中");
  });

  it("shows completed videos in a compact player that opens the shared lightbox", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-task-card.tsx",
      "utf8",
    );

    expect(source).toContain("generation?.templateData");
    expect(source).toContain("posterUrl");
    expect(source).toContain("onCanPlay");
    expect(source).toContain("<AppVideoPlayer");
    expect(source).toContain("controlsOnHover");
    expect(source).toContain("playOnSurfaceClick={false}");
    expect(source).toContain("<MediaLightbox");
    expect(source).not.toMatch(/<video\b[^>]*\bcontrols(?:=|\s|>)/);
    expect(source).toContain("data-video-ready");
    expect(source).not.toContain("src={successful.generation.localPath}");
  });

  it("mounts completed video sources only near the viewport", () => {
    const source = readFileSync(
      "components/batch-workbench/live-video-task-card.tsx",
      "utf8",
    );

    expect(source).toContain("IntersectionObserver");
    expect(source).toContain("mediaInViewport");
    expect(source).toContain('rootMargin: "600px 0px"');
    expect(source).toContain('preload="metadata"');
    expect(source).toContain("mediaInViewport ? (");
    expect(source).not.toContain('loading="eager"');
    expect(source).not.toContain('fetchPriority="high"');
  });
});
