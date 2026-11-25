import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

describe("video upload section visibility", () => {
  it("removes the redundant upload heading from frame modes and the whole text-to-video placeholder", () => {
    const source = readFileSync("app/video/video-tool.tsx", "utf8");
    const textModeStart = source.indexOf('if (inputMode === "text_to_video")');
    const firstLastStart = source.indexOf('if (inputMode === "first_last_frame")', textModeStart);
    const firstFrameStart = source.indexOf('if (inputMode === "first_frame")', firstLastStart);
    const multimodalStart = source.indexOf("return (", firstFrameStart + 1);
    const firstLastBranch = source.slice(firstLastStart, firstFrameStart);
    const firstFrameBranch = source.slice(firstFrameStart, multimodalStart);

    expect(source).not.toContain("纯文生视频，无需上传素材");
    expect(firstLastBranch).not.toContain(">上传素材</div>");
    expect(firstFrameBranch).not.toContain(">上传素材</div>");
    expect(source).toContain('inputMode !== "text_to_video" ? (');
    expect(source).toContain('title="上传素材"');
  });
});
