import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const readIfPresent = (path: string) => {
  const absolute = resolve(root, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
};

describe("Studio static media preview isolation", () => {
  it("keeps upload posters opt-in and preserves the existing non-Studio players", () => {
    const dropzone = read("components/ui/multi-upload-dropzone.tsx");
    const imageTool = read("app/image/image-tool.tsx");
    const videoTool = read("app/video/video-tool.tsx");

    expect(dropzone).toContain("staticVideoPreviews?: boolean");
    expect(dropzone).toContain("staticVideoPreviews = false");
    expect(dropzone).toContain("<VideoPosterPreview");
    expect(dropzone).toContain("posterSrc={typeof visualItems[i]?.thumbnailUrl");
    expect(dropzone).toContain("<AppVideoPlayer");
    expect(dropzone).toContain("<video");
    expect(imageTool).toContain("staticVideoPreviews={embeddedInStudioShell}");
    expect(videoTool).toContain("staticVideoPreviews={embeddedInStudioShell}");
  });

  it("keeps history posters and early virtualization opt-in to Studio", () => {
    const panel = read("components/history/unified-history-panel.tsx");
    const studio = read("app/studio/page.tsx");

    expect(panel).toContain("staticVideoPreviews?: boolean");
    expect(panel).toContain("staticVideoPreviews = false");
    expect(panel).toContain("<VideoPosterPreview");
    expect(panel).toContain("posterSrc={it.posterUrl}");
    expect(panel).toContain("virtualizeThreshold={staticVideoPreviews ? 12 : undefined}");
    expect(panel).toContain("<AppVideoPlayer");
    expect(panel).toContain("<video");
    expect(studio).toContain("staticVideoPreviews");
  });

  it("seeks to a meaningful frame with bounded parallel extraction", () => {
    const poster = readIfPresent("components/ui/video-poster-preview.tsx");

    expect(poster).toContain('document.createElement("video")');
    expect(poster).toContain("createVideoPosterScheduler");
    expect(poster).toContain("POSTER_EXTRACTION_CONCURRENCY = 3");
    expect(poster).toContain("POSTER_EXTRACTION_TIMEOUT_MS = 4_000");
    expect(poster).not.toContain("posterExtractionTail");
    expect(poster).not.toContain("waitForPosterExtractionIdle");
    expect(poster).toContain("canvas.toBlob");
    expect(poster).not.toContain("canvas.toDataURL");
    expect(poster).toContain("data-video-poster-preview");
    expect(poster).toContain("video.onloadeddata = captureWhenReady");
    expect(poster).toContain("video.onseeked = capture");
    expect(poster).not.toContain("video.onloadeddata = capture;");
    expect(poster).toContain(".catch(() => finish(null))");
    expect(poster).toContain("data-video-poster-fallback");
    expect(poster).toContain("posterFailed && nearViewport");
  });

  it("continues to render images and playable audio upload cards", () => {
    const dropzone = read("components/ui/multi-upload-dropzone.tsx");

    expect(dropzone).toContain("<MediaImage");
    expect(dropzone).toContain("<CompactAudioPlayback src={src} />");
    expect(dropzone).toContain("data-upload-audio-player");
  });
});
