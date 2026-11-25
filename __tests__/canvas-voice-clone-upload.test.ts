import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareVoiceCloneUpload } from "@/lib/canvas/voice-clone-upload";
import { CANVAS_CLONE_MAX_BYTES, inspectPcmWav } from "@/lib/canvas/pcm-wav";

const decode = vi.fn();
const close = vi.fn();
function audio(seconds = 12, sampleRate = 16_000) {
  return {
    duration: seconds, sampleRate, length: seconds * sampleRate, numberOfChannels: 2,
    getChannelData: (channel: number) => new Float32Array(seconds * sampleRate).fill(channel ? 0.5 : 0.25),
  };
}
beforeEach(() => {
  decode.mockReset().mockResolvedValue(audio());
  close.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("AudioContext", class { decodeAudioData = decode; close = close; });
});
afterEach(() => vi.unstubAllGlobals());

it.each(["mp3", "m4a", "wav"])("prepares %s as a valid mono clone WAV", async (extension) => {
  const result = await prepareVoiceCloneUpload(new File(["sample"], `voice.${extension}`));
  const buffer = await result.file.arrayBuffer();
  expect(inspectPcmWav(buffer)).toMatchObject({ durationSeconds: 12, sampleRate: 24_000, channels: 1 });
  expect(new DataView(buffer).getInt16(44, true)).toBe(Math.round(0.375 * 32767));
  expect(result.durationSeconds).toBe(12);
  expect(result.file.name).toBe("voice.wav");
  expect(close).toHaveBeenCalledOnce();
});

it.each([9, 301, NaN])("rejects invalid duration %s and closes the decoder", async (seconds) => {
  decode.mockResolvedValue({ ...audio(), duration: seconds });
  await expect(prepareVoiceCloneUpload(new File(["sample"], "voice.mp3"))).rejects.toThrow("10 秒到 5 分钟");
  expect(close).toHaveBeenCalledOnce();
});

it("reports the actual duration of a short audio file", async () => {
  decode.mockResolvedValue({ ...audio(), duration: 5.232 });
  await expect(prepareVoiceCloneUpload(new File(["sample"], "short.mp3"))).rejects.toThrow("5.23 秒");
});

it("rejects unsupported, empty and oversized files before decoding", async () => {
  await expect(prepareVoiceCloneUpload(new File(["sample"], "voice.ogg"))).rejects.toThrow("MP3、M4A 或 WAV");
  await expect(prepareVoiceCloneUpload(new File([], "voice.wav"))).rejects.toThrow("为空");
  const large = new File(["sample"], "voice.wav");
  Object.defineProperty(large, "size", { value: CANVAS_CLONE_MAX_BYTES + 1 });
  await expect(prepareVoiceCloneUpload(large)).rejects.toThrow("20 MB");
  expect(decode).not.toHaveBeenCalled();
});

it("reports corrupt audio without leaking decoder resources", async () => {
  decode.mockRejectedValue(new Error("decode failed"));
  await expect(prepareVoiceCloneUpload(new File(["broken"], "voice.mp3"))).rejects.toThrow("无法读取音频");
  expect(close).toHaveBeenCalledOnce();
});
