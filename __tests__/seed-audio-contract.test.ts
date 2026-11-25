import { describe, expect, it } from "vitest";
import { buildSeedAudioRequest, validateSeedAudioMedia, SEED_AUDIO_MODEL_ID, SEED_AUDIO_SAMPLE_RATES } from "@/lib/seed-audio-models";

const input = { model: SEED_AUDIO_MODEL_ID, text: "雨声中两个人轻声交谈", speed: 1, volume: 1, pitch: 0 };

describe("Seed Audio HTTP contract", () => {
  it("builds the exact synchronous text request without MiniMax or duration fields", () => {
    expect(buildSeedAudioRequest({ ...input, voiceId: "minimax-voice", seedSpeaker: "removed-voice", language: "en", duration: 10, emotion: "happy" } as any)).toEqual({
      endpoint: "/api/v3/tts/create",
      body: { model: "seed-audio-1.0", text_prompt: input.text, audio_config: { format: "wav", sample_rate: 24000, speech_rate: 0, loudness_rate: 0, pitch_rate: 0 } },
    });
  });
  it("preserves reference order", () => {
    const request = buildSeedAudioRequest({ ...input, text: "@音频1 与 @音频2 对话", references: [{ kind: "audio", url: "https://media.test/b.mp3" }, { kind: "audio", url: "https://media.test/a.mp3" }] });
    expect(request.body.references).toEqual([{ audio_url: "https://media.test/b.mp3" }, { audio_url: "https://media.test/a.mp3" }]);
    expect(buildSeedAudioRequest({ ...input, references: [{ kind: "image", url: "https://media.test/a.png" }] }).body.references).toEqual([{ image_url: "https://media.test/a.png" }]);
  });
  it("maps rate boundaries to the documented percentage scale", () => {
    expect(buildSeedAudioRequest({ ...input, speed: 0.5, volume: 2, pitch: -12 }).body.audio_config).toMatchObject({ speech_rate: -50, loudness_rate: 100, pitch_rate: -12 });
    for (const patch of [{ speed: 2.01 }, { volume: 0.49 }, { pitch: 12.1 }]) expect(() => buildSeedAudioRequest({ ...input, ...patch })).toThrow();
  });
  it("enforces prompt, count and mutually exclusive reference modes", () => {
    expect(() => buildSeedAudioRequest({ ...input, text: "字".repeat(3000) })).not.toThrow();
    expect(() => buildSeedAudioRequest({ ...input, text: "字".repeat(3001) })).toThrow("3000");
    const audio = { kind: "audio" as const, url: "https://media.test/a.wav", durationSeconds: 30 };
    expect(() => buildSeedAudioRequest({ ...input, references: [audio, audio, audio] })).not.toThrow();
    expect(() => buildSeedAudioRequest({ ...input, references: [audio, audio, audio, audio] })).toThrow("3");
    expect(() => buildSeedAudioRequest({ ...input, references: [{ ...audio, durationSeconds: 30.01 }] })).toThrow("30");
    expect(() => buildSeedAudioRequest({ ...input, references: [audio, { kind: "image", url: "/uploads/a.png" }] })).toThrow("混用");
  });
  it("passes every documented format/rate pair and rejects incompatible selections", () => {
    for (const [audioFormat, rates] of Object.entries(SEED_AUDIO_SAMPLE_RATES)) {
      for (const sampleRate of rates) {
        expect(buildSeedAudioRequest({ ...input, audioFormat, sampleRate } as any).body.audio_config).toMatchObject({ format: audioFormat, sample_rate: sampleRate });
      }
    }
    expect(() => buildSeedAudioRequest({ ...input, audioFormat: "ogg_opus", sampleRate: 24000 })).toThrow("48k");
    expect(() => buildSeedAudioRequest({ ...input, audioFormat: "mp3", sampleRate: 40000 })).toThrow("采样率");
    expect(() => buildSeedAudioRequest({ ...input, audioFormat: "aac" } as any)).toThrow("格式");
  });
  it("validates actual reference bytes, format and audio duration", () => {
    const media = { kind: "audio" as const, byteSize: 10 * 1024 * 1024, mime: "audio/mpeg", durationSeconds: 30 };
    expect(() => validateSeedAudioMedia(media)).not.toThrow();
    expect(() => validateSeedAudioMedia({ ...media, byteSize: media.byteSize + 1 })).toThrow("10 MB");
    expect(() => validateSeedAudioMedia({ ...media, durationSeconds: 30.001 })).toThrow("30");
    expect(() => validateSeedAudioMedia({ ...media, mime: "audio/mp4" })).toThrow("MP3");
    expect(() => validateSeedAudioMedia({ ...media, mime: "audio/ogg", audioCodecs: ["vorbis"] })).toThrow("Opus");
  });
});
