import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CANVAS_CLONE_MAX_BYTES,
  resampleMono,
  encodeMonoPcm16Wav,
  inspectPcmWav,
} from "@/lib/canvas/pcm-wav";

describe("canvas PCM WAV", () => {
  it.each([8_000, 16_000, 22_050, 24_000, 44_100, 48_000])(
    "preserves ten seconds of audio from a %s Hz microphone in a valid clone WAV",
    async (sampleRate) => {
      const source = new Float32Array(sampleRate * 10).fill(0.25);
      const samples = resampleMono([source], sampleRate);
      expect(samples).toHaveLength(24_000 * 10);
      expect(samples[0]).toBeCloseTo(0.25);
      expect(samples[samples.length - 1]).toBeCloseTo(0.25);
      const buffer = await encodeMonoPcm16Wav(samples).arrayBuffer();
      expect(inspectPcmWav(buffer).durationSeconds).toBe(10);
    },
  );

  it("interpolates low-rate audio across chunk boundaries without changing pitch", () => {
    const samples = resampleMono([
      new Float32Array([0, 1]),
      new Float32Array([0, -1]),
    ], 12_000, 24_000);
    expect(Array.from(samples)).toEqual([0, 0.5, 1, 0.5, 0, -0.5, -1, -1]);
    expect(resampleMono([], 16_000)).toHaveLength(0);
  });

  it("downsamples mono audio deterministically", () => {
    const source = Float32Array.from({ length: 48_000 }, (_, index) =>
      Math.sin(index / 20),
    );
    expect(resampleMono([source], 48_000, 24_000)).toHaveLength(24_000);
  });

  it("writes a 24 kHz mono 16-bit PCM WAV header", async () => {
    const blob = encodeMonoPcm16Wav(new Float32Array(24_000), 24_000);
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(48_000);
    expect(inspectPcmWav(buffer)).toEqual({
      channels: 1,
      sampleRate: 24_000,
      bitsPerSample: 16,
      durationSeconds: 1,
    });
  });

  it("keeps a five-minute recording below the provider limit", () => {
    const blob = encodeMonoPcm16Wav(new Float32Array(24_000 * 300), 24_000);
    expect(blob.size).toBeLessThan(CANVAS_CLONE_MAX_BYTES);
  });

  it("rejects malformed or unsupported WAV data", () => {
    expect(() => inspectPcmWav(new ArrayBuffer(44))).toThrow("WAV");
  });

  it("uses an AudioWorklet and releases browser recording resources", () => {
    const hook = readFileSync(
      "components/canvas/use-pcm-wav-recorder.ts",
      "utf8",
    );
    const processor = readFileSync(
      "public/audio/pcm-capture-processor.js",
      "utf8",
    );
    expect(hook).toContain("audioWorklet.addModule");
    expect(hook).toContain("getUserMedia");
    expect(hook).toContain("track.stop()");
    expect(hook).toContain("CANVAS_CLONE_MAX_SECONDS");
    expect(processor).toContain('registerProcessor("canvas-pcm-capture"');
  });
});
