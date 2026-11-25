import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithProviderEgress: vi.fn(),
}));

vi.mock("@/lib/providers/transport", () => ({
  fetchWithProviderEgress: mocks.fetchWithProviderEgress,
  resolveProviderRequestContext: vi.fn(async () => ({
    provider: { baseUrl: "https://api.minimax.test", apiKey: "test-key" },
    decision: { providerId: "minimax", mode: "direct", cacheKey: "direct" },
  })),
}));

vi.mock("@/lib/providers/resolve", () => ({
  resolvedProviderApiKey: vi.fn(() => "test-key"),
}));

import {
  miniMaxCloneVoice,
  miniMaxGenerateSpeech,
  miniMaxListVoices,
  resolveMiniMaxVoiceCatalogSource,
} from "@/lib/minimax-speech";

const input = {
  model: "speech-2.8-hd" as const,
  text: "测试",
  voiceId: "female-shaonv",
  speed: 1,
  pitch: 0,
  volume: 1,
  modifyPitch: 0,
  modifyIntensity: 0,
  modifyTimbre: 0,
  soundEffect: "" as const,
};

describe("MiniMax speech runtime response", () => {
  beforeEach(() => mocks.fetchWithProviderEgress.mockReset());

  it("uses the documented URL response without decoding a large hex string", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            audio: "https://cdn.minimax.test/audio/result.mp3",
            status: 2,
          },
          extra_info: {
            audio_length: 1234,
            audio_size: 5678,
            usage_characters: 2,
          },
          trace_id: "trace-1",
          base_resp: { status_code: 0, status_msg: "success" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(miniMaxGenerateSpeech({ ...input, emotion: "happy", text: "你好<#0.25#>世界(laughs)" })).resolves.toEqual({
      audioUrl: "https://cdn.minimax.test/audio/result.mp3",
      traceId: "trace-1",
      audioLengthMs: 1234,
      usageCharacters: 2,
      audioSize: 5678,
    });
    const request = mocks.fetchWithProviderEgress.mock.calls[0]?.[2];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      output_format: "url",
      stream: false,
      voice_setting: { emotion: "happy" },
      text: "你好<#0.25#>世界(laughs)",
    });
  });

  it("rejects an invalid provider media address", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { audio: "not-a-url", status: 2 },
          base_resp: { status_code: 0, status_msg: "success" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(miniMaxGenerateSpeech(input)).rejects.toThrow("有效音频地址");
  });

  it("uploads a clone sample and submits the documented clone options", async () => {
    mocks.fetchWithProviderEgress
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            file: { file_id: "123" },
            base_resp: { status_code: 0, status_msg: "success" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            demo_audio: "https://cdn.minimax.test/audio/clone.mp3",
            base_resp: { status_code: 0, status_msg: "success" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    await expect(
      miniMaxCloneVoice(
        new File([new Uint8Array([1, 2, 3])], "voice.mp3", {
          type: "audio/mpeg",
        }),
        {
          model: "speech-2.8-turbo",
          voiceId: "CanvasVoice01",
          previewText: "试听",
          needNoiseReduction: true,
          needVolumeNormalization: false,
        },
      ),
    ).resolves.toEqual({
      voiceId: "CanvasVoice01",
      demoAudioUrl: "https://cdn.minimax.test/audio/clone.mp3",
    });

    expect(mocks.fetchWithProviderEgress).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(
        String(mocks.fetchWithProviderEgress.mock.calls[1]?.[2]?.body),
      ),
    ).toEqual({
      file_id: 123,
      voice_id: "CanvasVoice01",
      text: "试听",
      model: "speech-2.8-turbo",
      language_boost: "auto",
      need_noise_reduction: true,
      need_volume_normalization: false,
    });
  });

  it("normalizes catalog metadata without inventing unknown account fields", async () => {
    mocks.fetchWithProviderEgress.mockResolvedValue(
      new Response(
        JSON.stringify({
          system_voice: [
            {
              voice_id: "male-qn-qingse",
              voice_name: "青涩青年音色",
              description: ["中文", "普通话", "男声"],
            },
          ],
          voice_cloning: [
            {
              voice_id: "CanvasVoice_1700000000000_ab12cd34",
              voice_name: "我的克隆音色",
            },
          ],
          voice_generation: [],
          base_resp: { status_code: 0, status_msg: "success" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(miniMaxListVoices()).resolves.toEqual([
      expect.objectContaining({
        id: "male-qn-qingse",
        source: "system",
        language: "zh",
        accent: "mandarin",
        gender: "male",
        age: "youth",
      }),
      expect.objectContaining({
        id: "CanvasVoice_1700000000000_ab12cd34",
        source: "cloned",
        gender: "unknown",
        age: "unknown",
      }),
    ]);
  });
});

it("deletes a cloned voice through the resolved provider endpoint", async () => {
  mocks.fetchWithProviderEgress.mockReset().mockResolvedValue(new Response(JSON.stringify({ base_resp: { status_code: 0 } })));
  const source = await resolveMiniMaxVoiceCatalogSource();
  await source.deleteClonedVoice("owned-clone");
  const [, url, request] = mocks.fetchWithProviderEgress.mock.calls[0];
  expect(url).toBe("https://api.minimax.test/v1/delete_voice");
  expect(request.method).toBe("POST");
  expect(JSON.parse(request.body)).toEqual({ voice_type: "voice_cloning", voice_id: "owned-clone" });
});
it.each([{ base_resp: { status_code: 1000, status_msg: "failed" } }, {}])("rejects failed or unconfirmed provider deletions", async payload => {
  mocks.fetchWithProviderEgress.mockReset().mockResolvedValue(new Response(JSON.stringify(payload)));
  const source = await resolveMiniMaxVoiceCatalogSource();
  await expect(source.deleteClonedVoice("owned-clone")).rejects.toThrow();
});
