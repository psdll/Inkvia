import { describe, expect, it } from "vitest";
import { encodeCanvasAudioClip, getCanvasAudioClipName } from "@/lib/canvas/audio-trim";

describe("canvas audio clipping", () => {
  it("writes only the selected samples and preserves stereo channels", async () => {
    const channels = [new Float32Array([0, .25, .5, .75]), new Float32Array([0, -.25, -.5, -.75])];
    const result = encodeCanvasAudioClip(channels, 4, .25, .75);
    const view = new DataView(await result.blob.arrayBuffer());
    expect(result.blob.type).toBe("audio/wav");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(4);
    expect(view.getUint32(40, true)).toBe(8);
    expect([44, 46, 48, 50].map(offset => view.getInt16(offset, true))).toEqual([8192, -8192, 16384, -16384]);
    expect(result.durationSeconds).toBe(.5);
    expect(result.waveformPeaks).toHaveLength(80);
    expect(channels[0]).toEqual(new Float32Array([0, .25, .5, .75]));
  });

  it.each([[0, 0], [1, .5], [-1, .5], [0, 2], [NaN, .5]])("rejects invalid ranges %s to %s", (start, end) => {
    expect(() => encodeCanvasAudioClip([new Float32Array(4)], 4, start, end)).toThrow();
  });

  it("keeps the source name and replaces its audio extension with a clip suffix", () => {
    expect(getCanvasAudioClipName("周承远，39岁.mp3")).toBe("周承远，39岁_截取");
    expect(getCanvasAudioClipName("林度，28岁")).toBe("林度，28岁_截取");
  });
});
