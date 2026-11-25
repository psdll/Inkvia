import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

describe("video upload audio playback", () => {
  it("shows only a compact play-pause control in the video multimodal upload area", () => {
    const dropzone = readFileSync("components/ui/multi-upload-dropzone.tsx", "utf8");
    const videoTool = readFileSync("app/video/video-tool.tsx", "utf8");
    const audioStart = dropzone.indexOf("<audio");
    const audioEnd = dropzone.indexOf("</audio>", audioStart);
    const audioMarkup = dropzone.slice(audioStart, audioEnd);

    expect(dropzone).toContain("audioPlayback?: boolean;");
    expect(dropzone).toContain("audioPlayback = false");
    expect(dropzone).toContain("function CompactAudioPlayback");
    expect(dropzone).toContain('<CompactAudioPlayback src={src} />');
    expect(dropzone).toContain('aria-label={playing ? "暂停音频" : "播放音频"}');
    expect(audioStart).toBeGreaterThan(-1);
    expect(audioEnd).toBeGreaterThan(audioStart);
    expect(audioMarkup).toContain("data-upload-audio-player");
    expect(audioMarkup).not.toContain("controls");
    expect(videoTool.match(/\baudioPlayback\b/g)).toHaveLength(1);
  });
});
