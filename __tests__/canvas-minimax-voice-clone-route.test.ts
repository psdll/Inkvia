import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { encodeMonoPcm16Wav } from "@/lib/canvas/pcm-wav";

const mocks = vi.hoisted(() => ({
  requireCanvasEntryEnabled: vi.fn(),
  getUserId: vi.fn(),
  isAudioModelVisible: vi.fn(),
  isProviderModelEnabled: vi.fn(),
  getRegisteredProviders: vi.fn(),
  miniMaxCloneVoice: vi.fn(),
  resolveMiniMaxVoiceCatalogSource: vi.fn(),
  invalidateMiniMaxVoiceCache: vi.fn(),
  saveCanvasClonedVoice: vi.fn(),
}));

vi.mock("@/lib/canvas/cloned-voices", () => ({ saveCanvasClonedVoice: mocks.saveCanvasClonedVoice }));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/image-edit-models", () => ({
  isAudioModelVisible: mocks.isAudioModelVisible,
}));
vi.mock("@/lib/providers/model-availability", () => ({
  isProviderModelEnabled: mocks.isProviderModelEnabled,
}));
vi.mock("@/lib/providers/registry", () => ({
  getRegisteredProviders: mocks.getRegisteredProviders,
}));
vi.mock("@/lib/minimax-speech", () => ({
  miniMaxCloneVoice: mocks.miniMaxCloneVoice,
  resolveMiniMaxVoiceCatalogSource: mocks.resolveMiniMaxVoiceCatalogSource,
}));
vi.mock("@/lib/minimax-voice-cache", () => ({
  invalidateMiniMaxVoiceCache: mocks.invalidateMiniMaxVoiceCache,
}));

function cloneRequest(seconds: number, options?: { name?: string; type?: string }) {
  const blob = encodeMonoPcm16Wav(new Float32Array(24_000 * seconds), 24_000);
  const file = new File([blob], options?.name || "voice.wav", {
    type: options?.type || "audio/wav",
  });
  const form = new FormData();
  form.append("file", file);
  form.append("model", "speech-2.8-hd");
  return new NextRequest("http://localhost/api/canvas/speech/clone", {
    method: "POST",
    body: form,
  });
}

describe("canvas MiniMax recorded voice clone route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveCanvasClonedVoice.mockResolvedValue(undefined);
    mocks.requireCanvasEntryEnabled.mockResolvedValue(null);
    mocks.getUserId.mockResolvedValue(42);
    mocks.isAudioModelVisible.mockResolvedValue(true);
    mocks.isProviderModelEnabled.mockReturnValue(true);
    mocks.getRegisteredProviders.mockResolvedValue([]);
    mocks.resolveMiniMaxVoiceCatalogSource.mockResolvedValue({
      scopeKey: "scope-a",
      load: vi.fn(),
    });
    mocks.miniMaxCloneVoice.mockImplementation(
      async (_file: File, settings: { voiceId: string }) => ({
        voiceId: settings.voiceId,
      }),
    );
  });

  it("rejects unauthenticated recording uploads", async () => {
    mocks.getUserId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/canvas/speech/clone/route");
    const response = await POST(cloneRequest(10));
    expect(response.status).toBe(401);
  });

  it("rejects a non-WAV recording", async () => {
    const { POST } = await import("@/app/api/canvas/speech/clone/route");
    const response = await POST(
      cloneRequest(10, { name: "voice.mp3", type: "audio/mpeg" }),
    );
    expect(response.status).toBe(400);
  });

  it.each([9, 301])("rejects a %s-second recording", async (seconds) => {
    const { POST } = await import("@/app/api/canvas/speech/clone/route");
    const response = await POST(cloneRequest(seconds));
    expect(response.status).toBe(400);
    expect(mocks.miniMaxCloneVoice).not.toHaveBeenCalled();
  });

  it("clones valid WAV without a paid preview and invalidates its scope", async () => {
    const { POST } = await import("@/app/api/canvas/speech/clone/route");
    const response = await POST(cloneRequest(10));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.voiceId).toMatch(
      /^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$/,
    );
    expect(mocks.miniMaxCloneVoice).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        model: "speech-2.8-hd",
        voiceId: payload.voiceId,
        previewText: "",
        needNoiseReduction: false,
        needVolumeNormalization: false,
      }),
    );
    expect(mocks.invalidateMiniMaxVoiceCache).toHaveBeenCalledWith("scope-a");
    expect(mocks.saveCanvasClonedVoice).toHaveBeenCalledWith({
      userId: 42, providerScope: "scope-a", voiceId: payload.voiceId, name: "voice",
    });
    expect(payload).not.toHaveProperty("demoAudioUrl");
  });

  it("returns the created voice ID with a warning if local persistence fails", async () => {
    mocks.saveCanvasClonedVoice.mockRejectedValue(new Error("database unavailable"));
    const { POST } = await import("@/app/api/canvas/speech/clone/route");
    const response = await POST(cloneRequest(10));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.warning).toContain(payload.voiceId);
    expect(payload.warning).toContain("保存失败");
    expect(mocks.miniMaxCloneVoice).toHaveBeenCalledTimes(1);
  });
});
