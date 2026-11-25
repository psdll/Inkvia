import { describe, expect, it } from "vitest";
import {
  MINIMAX_SPEECH_HD_MODEL_ID,
  MINIMAX_SPEECH_TURBO_MODEL_ID,
  buildMiniMaxSpeechRequest,
  createMiniMaxCloneVoiceId,
} from "@/lib/minimax-speech-models";

describe("MiniMax speech 2.8 request contract", () => {
  it("builds the documented synchronous T2A request", () => {
    expect(buildMiniMaxSpeechRequest({
      model: MINIMAX_SPEECH_HD_MODEL_ID,
      text: "今天很开心(laughs)。",
      voiceId: "female-shaonv",
      speed: 1.2,
      pitch: -2,
      volume: 1.5,
      modifyPitch: 12,
      modifyIntensity: -8,
      modifyTimbre: 4,
      soundEffect: "spacious_echo",
    })).toEqual({
      endpoint: "/v1/t2a_v2",
      body: {
        model: "speech-2.8-hd",
        text: "今天很开心(laughs)。",
        stream: false,
        language_boost: "auto",
        output_format: "url",
        voice_setting: {
          voice_id: "female-shaonv",
          speed: 1.2,
          vol: 1.5,
          pitch: -2,
        },
        audio_setting: {
          sample_rate: 32000,
          bitrate: 128000,
          format: "mp3",
          channel: 1,
        },
        voice_modify: {
          pitch: 12,
          intensity: -8,
          timbre: 4,
          sound_effects: "spacious_echo",
        },
        subtitle_enable: false,
      },
    });
  });

  it("supports both requested models and omits an empty sound effect", () => {
    const request = buildMiniMaxSpeechRequest({
      model: MINIMAX_SPEECH_TURBO_MODEL_ID,
      text: "测试文本",
      voiceId: "male-qn-qingse",
      speed: 1,
      pitch: 0,
      volume: 1,
      modifyPitch: 0,
      modifyIntensity: 0,
      modifyTimbre: 0,
      soundEffect: "",
    });

    expect(request.body.model).toBe("speech-2.8-turbo");
    expect(request.body.voice_modify).not.toHaveProperty("sound_effects");
  });

  it("enforces the provider ranges and the under-10000 text limit", () => {
    expect(() => buildMiniMaxSpeechRequest({
      model: MINIMAX_SPEECH_HD_MODEL_ID,
      text: "x".repeat(10_000),
      voiceId: "female-shaonv",
      speed: 1,
      pitch: 0,
      volume: 1,
      modifyPitch: 0,
      modifyIntensity: 0,
      modifyTimbre: 0,
      soundEffect: "",
    })).toThrow("9999");

    expect(() => buildMiniMaxSpeechRequest({
      model: MINIMAX_SPEECH_HD_MODEL_ID,
      text: "测试",
      voiceId: "female-shaonv",
      speed: 2.01,
      pitch: 0,
      volume: 1,
      modifyPitch: 0,
      modifyIntensity: 0,
      modifyTimbre: 0,
      soundEffect: "",
    })).toThrow("语速");
  });

  it("validates the documented voice-clone fields", async () => {
    const { buildMiniMaxVoiceCloneRequest } = await import("@/lib/minimax-speech-models");
    expect(buildMiniMaxVoiceCloneRequest({
      fileId: 123,
      model: MINIMAX_SPEECH_HD_MODEL_ID,
      voiceId: "CanvasVoice01",
      previewText: "你好，这是克隆音色试听。",
      needNoiseReduction: true,
      needVolumeNormalization: true,
    })).toEqual({
      filePurpose: "voice_clone",
      endpoint: "/v1/voice_clone",
      body: {
        file_id: 123,
        voice_id: "CanvasVoice01",
        text: "你好，这是克隆音色试听。",
        model: MINIMAX_SPEECH_HD_MODEL_ID,
        language_boost: "auto",
        need_noise_reduction: true,
        need_volume_normalization: true,
      },
    });
    expect(() => buildMiniMaxVoiceCloneRequest({
      fileId: 123,
      model: MINIMAX_SPEECH_HD_MODEL_ID,
      voiceId: "bad",
      previewText: "",
      needNoiseReduction: false,
      needVolumeNormalization: false,
    })).toThrow("音色 ID");
  });

  it("builds a clone request without an implicit paid preview", async () => {
    const { buildMiniMaxVoiceCloneRequest } = await import(
      "@/lib/minimax-speech-models"
    );
    expect(
      buildMiniMaxVoiceCloneRequest({
        fileId: 123,
        model: MINIMAX_SPEECH_HD_MODEL_ID,
        voiceId: "CanvasVoice_1700000000000_ab12cd34",
        previewText: "",
        needNoiseReduction: false,
        needVolumeNormalization: false,
      }),
    ).toEqual({
      filePurpose: "voice_clone",
      endpoint: "/v1/voice_clone",
      body: {
        file_id: 123,
        voice_id: "CanvasVoice_1700000000000_ab12cd34",
        need_noise_reduction: false,
        need_volume_normalization: false,
      },
    });
  });

  it("generates a valid deterministic clone voice id", () => {
    expect(createMiniMaxCloneVoiceId(1_700_000_000_000, "ab12cd34")).toBe(
      "CanvasVoice_1700000000000_ab12cd34",
    );
    expect(
      createMiniMaxCloneVoiceId(1_700_000_000_000, "-bad_tail-"),
    ).toMatch(/^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$/);
  });
});
