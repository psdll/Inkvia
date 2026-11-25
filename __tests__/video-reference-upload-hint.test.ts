import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

describe("video reference upload hint", () => {
  it("uses model-specific media kinds and @ reference examples", () => {
    const source = readFileSync("app/video/video-tool.tsx", "utf8");

    expect(source).toContain(
      "const showsReferenceAudioHint = modelSupportsReferenceAudio(model);",
    );
    expect(source).toContain(
      'const referenceMediaKindsHint = showsReferenceAudioHint ? "图片、音频、视频" : "图片、视频";',
    );
    expect(source).toContain(
      'const referenceMentionExamples = locale === "en" ? "@" : showsReferenceAudioHint ? "@图片1 @视频1 @音频1" : "@图片1 @视频1";',
    );
    expect(source).toContain(
      "在提示词中使用 ${referenceMentionExamples} 引用",
    );
    expect(source).toContain('accept="image/*,video/*,audio/*"');
    expect(source).not.toContain("人像库");
  });
});
