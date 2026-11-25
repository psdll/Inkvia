import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/billing/admission", () => ({ assertBillingReady: vi.fn(async () => undefined) }));

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  miniMaxGenerateSpeech: vi.fn(),
  saveRemoteFile: vi.fn(),
  syncAdminFeed: vi.fn(async () => undefined),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    generation: {
      findFirst: mocks.findFirst,
      create: mocks.create,
      update: mocks.update,
    },
  },
}));
vi.mock("@/lib/billing-ledger", () => ({
  upsertUsageLedgerForGenerationId: vi.fn(async () => undefined),
}));
vi.mock("@/lib/runtime-generation-budget", () => ({ reserveRuntimeGeneration: vi.fn(async () => undefined) }));
vi.mock("@/lib/admin-asset-feed", () => ({ upsertAdminAssetFeedForGenerationId: mocks.syncAdminFeed }));
vi.mock("@/lib/image-edit-models", () => ({
  isAudioModelVisible: vi.fn(async () => true),
}));
vi.mock("@/lib/providers/registry", () => ({
  getRegisteredProviders: vi.fn(async () => [
    { id: "minimax", enabled: true, audioModels: ["speech-2.8-hd"] },
  ]),
}));
vi.mock("@/lib/providers/model-availability", () => ({
  isProviderModelEnabled: vi.fn(() => true),
}));
vi.mock("@/lib/minimax-speech", () => ({
  miniMaxGenerateSpeech: mocks.miniMaxGenerateSpeech,
}));
vi.mock("@/lib/storage", () => ({ saveRemoteFile: mocks.saveRemoteFile }));

import { createAudioGeneration } from "@/lib/generation/audio-service";

describe("MiniMax audio generation persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockImplementation(async ({data}) => ({ id: 77, ...data }));
    mocks.update.mockResolvedValue({ id: 77 });
    mocks.miniMaxGenerateSpeech.mockResolvedValue({
      audioUrl: "https://cdn.minimax.test/result.mp3",
      audioLengthMs: 2500,
      audioSize: 4096,
      usageCharacters: 8,
      traceId: "trace-77",
    });
    mocks.saveRemoteFile.mockResolvedValue(
      "/uploads/canvas_audio_results/2026-09-04/result.mp3",
    );
  });

  it("downloads the provider URL through the registered MiniMax media channel", async () => {
    await expect(
      createAudioGeneration({
        authUserId: 29,
        requestKey: "00000000-0000-4000-8000-000000000077",
        source: "canvas",
        model: "speech-2.8-hd",
        text: "测试音频",
        voiceId: "female-shaonv",
        speed: 1,
        pitch: 0,
        volume: 1,
        modifyPitch: 0,
        modifyIntensity: 0,
        modifyTimbre: 0,
        soundEffect: "",
      }),
    ).resolves.toMatchObject({
      generationId: 77,
      status: "success",
      outputPath: "/uploads/canvas_audio_results/2026-09-04/result.mp3",
    });

    expect(mocks.saveRemoteFile).toHaveBeenCalledWith(
      "https://cdn.minimax.test/result.mp3",
      "canvas_audio_results",
      false,
      { providerId: "minimax" },
    );
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.saveRemoteFile.mock.invocationCallOrder[0]);
    expect(JSON.parse(mocks.update.mock.calls[0][0].data.templateData).providerUsage.usage_characters).toBe(8);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 77 },
        data: expect.objectContaining({ status: "success", sizeBytes: 4096 }),
      }),
    );
    expect(mocks.syncAdminFeed).toHaveBeenCalledTimes(2);
    expect(mocks.syncAdminFeed).toHaveBeenLastCalledWith(77);
  });

  it("syncs failed audio to the existing administrator feed with the failure reason", async () => {
    mocks.miniMaxGenerateSpeech.mockRejectedValueOnce(new Error("provider failure"));
    await expect(createAudioGeneration({ authUserId: 29, requestKey: "audio-failure", source: "canvas", model: "speech-2.8-hd",
      text: "测试", voiceId: "female-shaonv", speed: 1, pitch: 0, volume: 1,
      modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "" })).rejects.toThrow("provider failure");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", errorMsg: "provider failure" }) }));
    expect(mocks.syncAdminFeed).toHaveBeenCalledTimes(2);
  });

  it("stores a voice preview at its stable cache target", async () => {
    await createAudioGeneration({
      authUserId: 29,
      requestKey: "00000000-0000-4000-8000-000000000078",
      source: "canvas",
      model: "speech-2.8-hd",
      text: "你好，这是音色试听。",
      voiceId: "female-shaonv",
      speed: 1,
      pitch: 0,
      volume: 1,
      modifyPitch: 0,
      modifyIntensity: 0,
      modifyTimbre: 0,
      soundEffect: "",
      outputStorage: {
        folder: "canvas_voice_previews",
        stableKey: "1234567890abcdef1234567890abcdef",
        fallbackExt: "mp3",
      },
    });

    expect(mocks.saveRemoteFile).toHaveBeenCalledWith(
      "https://cdn.minimax.test/result.mp3",
      "canvas_voice_previews",
      false,
      {
        providerId: "minimax",
        stableKey: "1234567890abcdef1234567890abcdef",
        dateSubdirectory: false,
        fallbackExt: "mp3",
      },
    );
  });
});
