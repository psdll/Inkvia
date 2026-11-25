import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const historySource = readFileSync(
  resolve(process.cwd(), "components/history/unified-history-panel.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("history result video sound", () => {
  it("starts the completed result player with sound enabled", () => {
    const videoSectionStart = historySource.indexOf(
      "const lastFrameUrl = getVideoLastFrameUrl(activeItem);",
    );
    const playerStart = historySource.indexOf("<AppVideoPlayer", videoSectionStart);
    const playerEnd = historySource.indexOf("/>", playerStart);

    expect(videoSectionStart).toBeGreaterThanOrEqual(0);
    expect(playerStart).toBeGreaterThan(videoSectionStart);
    expect(playerEnd).toBeGreaterThan(playerStart);

    const resultPlayer = historySource.slice(playerStart, playerEnd);
    expect(resultPlayer).toContain("src={activeVideoUrl}");
    expect(resultPlayer).toContain("muted={false}");
  });
});
