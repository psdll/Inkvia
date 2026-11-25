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

describe("history video route return", () => {
  it("keeps the shared poster visible until the remounted video has a frame", () => {
    const completedVideo = sourceBetween(
      historySource,
      'const lastFrameUrl = getVideoLastFrameUrl(activeItem);',
      ') : hasGroupDisplay && activeGroupId ? (',
    );

    expect(historySource).toContain(
      'const [activeVideoReadyUrl, setActiveVideoReadyUrl] = React.useState("");',
    );
    expect(historySource).toContain('{isVideoTask ? (');
    expect(historySource).not.toContain('{inferKind(activeDisplayUrl) === "video" ? (');
    expect(completedVideo).toContain(
      "const activeVideoReady = !!activeVideoUrl && activeVideoReadyUrl === activeVideoUrl;",
    );
    expect(completedVideo).toContain("<AppVideoPlayer");
    expect(completedVideo).toContain("src={activeVideoUrl}");
    expect(completedVideo).not.toContain("src={activeDisplayUrl}");
    expect(historySource).toContain('data-video-result-stage="shared"');
    expect(completedVideo).not.toContain("activeVideoNaturalRatio");
    expect(completedVideo).not.toContain("onNaturalSize");
    expect(completedVideo).toContain("onCanPlay={() => {");
    expect(completedVideo).toContain("onLoadedData={() => {");
    expect(completedVideo).toContain("setActiveVideoReadyUrl(activeVideoUrl);");
    expect(completedVideo).toContain('data-video-ready={activeVideoReady ? "true" : "false"}');
    expect(completedVideo).not.toMatch(/<video\b[^>]*\bcontrols(?:=|\s|>)/);
    expect(completedVideo).toContain("<VideoPosterPreview");
    expect(completedVideo).toContain("posterSrc={activePosterUrl}");
    expect(completedVideo).not.toContain("transition-opacity duration-200");
    expect(completedVideo).toContain('<MediaImage\n');
  });
});
