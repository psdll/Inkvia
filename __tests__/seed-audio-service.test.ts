vi.mock("@/lib/billing/admission", () => ({ assertBillingReady: vi.fn(async () => undefined) }));
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), generate: vi.fn(), prepare: vi.fn(), save: vi.fn(), remote: vi.fn(), visible: vi.fn(), enabled: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { generation: { findFirst: mocks.findFirst, create: mocks.create, update: mocks.update } } }));
vi.mock("@/lib/runtime-generation-budget", () => ({ reserveRuntimeGeneration: vi.fn() }));
vi.mock("@/lib/billing-ledger", () => ({ upsertUsageLedgerForGenerationId: vi.fn(async () => undefined) }));
vi.mock("@/lib/admin-asset-feed", () => ({ upsertAdminAssetFeedForGenerationId: vi.fn(async () => undefined) }));
vi.mock("@/lib/image-edit-models", () => ({ isAudioModelVisible: mocks.visible }));
vi.mock("@/lib/providers/registry", () => ({ getRegisteredProviders: vi.fn(async () => []) }));
vi.mock("@/lib/providers/model-availability", () => ({ isProviderModelEnabled: mocks.enabled }));
vi.mock("@/lib/minimax-speech", () => ({ miniMaxGenerateSpeech: vi.fn() }));
vi.mock("@/lib/seed-audio", () => ({ seedAudioGenerate: mocks.generate, prepareSeedAudioReferences: mocks.prepare }));
vi.mock("@/lib/storage", () => ({ saveBufferFile: mocks.save, saveRemoteFile: mocks.remote }));
import { createAudioGeneration } from "@/lib/generation/audio-service";
const input = { authUserId: 29, requestKey: "seed-audio-test-1", source: "canvas" as const, model: "seed-audio-1.0" as const, text: "雨声", speed: 1, volume: 1, pitch: 0 };
describe("Seed Audio persistence and idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockImplementation(async ({data}) => ({ id: 900, ...data })); mocks.update.mockResolvedValue({ id: 900 });
    mocks.visible.mockResolvedValue(true); mocks.enabled.mockReturnValue(true); mocks.prepare.mockResolvedValue([]);
    mocks.generate.mockResolvedValue({ audioBuffer: Buffer.from("ID3"), durationSeconds: 15, originalDurationSeconds: 30, traceId: "trace-900" });
    mocks.save.mockResolvedValue("/uploads/canvas_audio_results/seed.mp3");
  });
  it("saves audio before marking success and retains original billing duration", async () => {
    expect(await createAudioGeneration(input)).toMatchObject({ status: "success", outputPath: "/uploads/canvas_audio_results/seed.mp3", durationSeconds: 15 });
    const created = mocks.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ externalProvider: "volcengine-speech", model: "seed-audio-1.0", status: "running" });
    expect(JSON.parse(mocks.update.mock.calls[0][0].data.templateData)).toMatchObject({ billing: { unitType: "second" }, providerUsage: { original_duration: 30, duration: 15 }, usageCapture: { providerCompleted: true } });
    expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(mocks.save.mock.invocationCallOrder[0]);
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[1]);
    expect(JSON.parse(mocks.update.mock.calls[1][0].data.templateData).durationSeconds).toBe(15);
    expect(mocks.generate).toHaveBeenCalledWith(input, input.requestKey, []);
  });
  it("reuses a completed request without a second upstream call", async () => {
    mocks.findFirst.mockResolvedValue({ id: 900, status: "success", localPath: "/uploads/seed.mp3", templateData: JSON.stringify({ durationSeconds: 15 }) });
    expect(await createAudioGeneration(input)).toMatchObject({ generationId: 900, status: "success" });
    expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not submit disabled or invalid inputs", async () => {
    mocks.enabled.mockReturnValue(false);
    await expect(createAudioGeneration(input)).rejects.toThrow("不可用");
    expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("records storage failures as failures", async () => {
    mocks.save.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(createAudioGeneration(input)).rejects.toThrow("storage unavailable");
    expect(JSON.parse(mocks.update.mock.calls[0][0].data.templateData).providerUsage.original_duration).toBe(30);
    expect(mocks.update.mock.calls[1][0].data).toMatchObject({ status: "failed", errorMsg: "storage unavailable" });
  });
  it.each([["wav", "wav"], ["mp3", "mp3"], ["pcm", "pcm"], ["ogg_opus", "ogg"]] as const)("stores %s with the correct file extension", async (audioFormat, extension) => {
    await createAudioGeneration({ ...input, audioFormat, sampleRate: 48000 });
    expect(mocks.save).toHaveBeenCalledWith(expect.any(Buffer), expect.any(String), expect.objectContaining({ fileName: `audio.${extension}`, fallbackExt: extension }));
    expect(JSON.parse(mocks.create.mock.calls[0][0].data.templateData).audioConfig).toMatchObject({ format: audioFormat, sample_rate: 48000 });
  });
});
