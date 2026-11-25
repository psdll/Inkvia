import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), resolve: vi.fn(), stat: vi.fn(), readFile: vi.fn(), probe: vi.fn() }));
vi.mock("node:fs/promises", () => ({ default: { stat: mocks.stat, readFile: mocks.readFile } }));
vi.mock("@/lib/tool-media/media-probe", () => ({ resolveLocalUploadPath: (url: string) => `/safe${url}`, probeLocalMedia: mocks.probe }));
vi.mock("@/lib/providers/transport", () => ({ fetchWithProviderEgress: mocks.fetch, resolveProviderRequestContext: mocks.resolve }));
vi.mock("@/lib/providers/resolve", () => ({ resolvedProviderApiKey: (provider: { apiKey: string }) => provider.apiKey }));
import { prepareSeedAudioReferences, seedAudioGenerate } from "@/lib/seed-audio";
import { SEED_AUDIO_MODEL_ID } from "@/lib/seed-audio-models";

const input = { model: SEED_AUDIO_MODEL_ID, text: "雨声", speed: 1, volume: 1, pitch: 0 };
describe("Seed Audio transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockResolvedValue({ provider: { apiKey: "saved-speech-key", baseUrl: "https://speech.test" }, decision: { providerId: "volcengine-speech", mode: "direct", cacheKey: "direct" } });
  });
  it.each([undefined, 0])("handles synchronous audio and original duration (code %s)", async (code) => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ code, audio: "SUQz", duration: 15, original_duration: 30 }), { headers: { "X-Tt-Logid": "log-1" } }));
    const result = await seedAudioGenerate(input, "request-1");
    expect(result).toMatchObject({ durationSeconds: 15, originalDurationSeconds: 30, traceId: "log-1" });
    expect(result.audioBuffer?.toString()).toBe("ID3");
    expect(mocks.resolve).toHaveBeenCalledWith("volcengine-speech");
    expect(mocks.fetch).toHaveBeenCalledWith(expect.objectContaining({ mode: "direct" }), "https://speech.test/api/v3/tts/create", expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json", "X-Api-Key": "saved-speech-key", "X-Api-Request-Id": "request-1" } }));
    expect(JSON.parse(mocks.fetch.mock.calls[0][2].body)).not.toHaveProperty("voice_setting");
    expect(JSON.parse(mocks.fetch.mock.calls[0][2].body)).not.toHaveProperty("duration");
  });
  it("supports the temporary URL result when Base64 is absent", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ url: "https://media.test/result.mp3", duration: 5, original_duration: 5 })));
    expect(await seedAudioGenerate(input)).toMatchObject({ audioUrl: "https://media.test/result.mp3" });
  });
  it("rejects errors without disclosing saved credentials", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ code: 45000030, message: "saved-speech-key at https://speech.test unauthorized" }), { status: 403 }));
    await expect(seedAudioGenerate(input)).rejects.toThrow();
    try { await seedAudioGenerate(input); } catch (error) { expect((error as Error).message).not.toContain("saved-speech-key"); }
  });
  it("refuses missing usage or invalid results", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ audio: "SUQz", duration: 5 })));
    await expect(seedAudioGenerate(input)).rejects.toThrow("时长");
  });
  it("sends original local bytes after checking actual media metadata", async () => {
    mocks.stat.mockResolvedValue({ size: 3 });
    mocks.readFile.mockResolvedValue(Buffer.from("abc"));
    mocks.probe.mockResolvedValue({ detectedMime: "audio/mpeg", durationSeconds: 30 });
    expect(await prepareSeedAudioReferences({ ...input, references: [{ kind: "audio", url: "/uploads/test.mp3" }] })).toEqual([{ audio_data: "YWJj" }]);
    mocks.probe.mockResolvedValue({ detectedMime: "audio/mpeg", durationSeconds: 30.01 });
    await expect(prepareSeedAudioReferences({ ...input, references: [{ kind: "audio", url: "/uploads/test.mp3", durationSeconds: 1 }] })).rejects.toThrow("30");
  });
});
