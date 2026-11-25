import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(path.join(process.cwd(), "app/materials/page.tsx"), "utf8");

describe("material video detail layout", () => {
  it("uses the shared player and the video's natural aspect ratio on desktop and mobile", () => {
    const start = source.indexOf("function MaterialDetail(");
    expect(start).toBeGreaterThanOrEqual(0);
    const detailSource = source.slice(start);

    expect(detailSource).toContain("AppVideoPlayer");
    expect(detailSource).toContain("videoAspectRatio");
    expect(detailSource).toContain("setVideoAspectRatio");
    expect(detailSource).toContain("const isWideVideo = isVideo && videoAspectRatio >= 4 / 3");
    expect(detailSource).toContain("md:h-[72vh] md:max-h-[680px]");
    expect(detailSource).toContain("h-[86vh] max-h-[820px]");
    expect(detailSource).toContain("--media-aspect");
    expect(detailSource).toContain("onNaturalSize");
    expect(detailSource).toContain("aspectRatio: videoAspectRatio");
    expect(detailSource).not.toMatch(/<video\b[^>]*\bcontrols(?:=|\s|>)/);
  });
});
