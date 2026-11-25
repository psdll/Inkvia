import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), context: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));
vi.mock("@/lib/providers/transport", () => ({ fetchWithProviderEgress: mocks.fetch, resolveProviderRequestContext: mocks.context }));

import { buildWanVideoRequest, getWanApiBase, getWanVideoPollPath, wanSubmitVideo, wanGetVideoTask, type WanVideoInput } from "@/lib/wan-video";
import { getVideoModelSpec, normalizeVideoModelId, sora2Models } from "@/lib/sora2";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins, toResolvedProvider } from "@/lib/providers/registry";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { supportsProviderModelFetch } from "@/lib/providers/model-fetch";
import { validateWanMediaSet } from "@/lib/wan-media-policy";
import { WAN_VIDEO_DEFAULT_PRICE_RULES } from "@/lib/wan-models";
import { upsertUsageLedgerForGeneration } from "@/lib/billing-ledger";
import { createVideoTaskSchema } from "@/lib/generation/task-input-schema";

const base: WanVideoInput = { prompt: "一只猫", inputMode: "text_to_video", resolution: "720p", ratio: "16:9", duration: 5, media: [] };
const image = { type: "image" as const, url: "https://example.com/cat.png" };

describe("Wan3.0 request contract", () => {
  it("accepts the Agent defaults without requesting an unsupported last frame", () => {
    expect(createVideoTaskSchema.parse({ model: "wan3.0-video", prompt: "test", ratio: "adaptive", duration: -1 })).toMatchObject({ model: "wan3.0-video", returnLastFrame: false, inputMode: "text_to_video" });
  });
  it("maps text generation without image or OpenAI fields", () => {
    expect(buildWanVideoRequest(base)).toEqual({ endpoint: "/api/v1/services/aigc/video-generation/video-synthesis", body: {
      model: "wan3.0-video", input: { prompt: "一只猫" },
      parameters: { resolution: "720P", ratio: "16:9", duration: 5, audio: true, watermark: false },
    } });
  });
  it.each(["first_frame", "first_last_frame"] as const)("maps %s with strict roles", (inputMode) => {
    const media = inputMode === "first_frame" ? [image] : [image, { ...image, url: "https://example.com/end.png" }];
    const result = buildWanVideoRequest({ ...base, inputMode, media }).body;
    expect(result.input.media?.map((m) => m.type)).toEqual(inputMode === "first_frame" ? ["first_frame"] : ["first_frame", "last_frame"]);
    expect(result).not.toHaveProperty("content");
    expect(result.parameters).not.toHaveProperty("generate_audio");
    expect(result.parameters).not.toHaveProperty("return_last_frame");
  });
  it("preserves interleaved reference order and independent media numbering", () => {
    expect(buildWanVideoRequest({ ...base, inputMode: "multimodal", media: [
      image, { type: "video", url: "https://example.com/v.mp4" }, image, { type: "audio", url: "https://example.com/a.mp3" },
    ] }).body.input.media?.map((m) => m.type)).toEqual(["reference_image", "reference_video", "reference_image", "reference_audio"]);
  });
  it("accepts standalone audio, smart duration, explicit silence, and seed boundary", () => {
    const request = buildWanVideoRequest({ ...base, inputMode: "multimodal", duration: -1, ratio: "adaptive", generateAudio: false, seed: 2147483647,
      media: [{ type: "audio", url: "https://example.com/a.mp3" }] });
    expect(request.body.parameters).toMatchObject({ audio: false, duration: -1, seed: 2147483647 });
  });
  it.each([1, 31, 2.5, 0])("rejects invalid duration %s", (duration) => expect(() => buildWanVideoRequest({ ...base, duration })).toThrow());
  it.each([2, 30, -1])("accepts duration boundary %s", (duration) => expect(buildWanVideoRequest({ ...base, duration }).body.parameters.duration).toBe(duration));
  it("rejects unsupported resolutions, ratios, seed, frame/reference mixing and text media", () => {
    for (const patch of [{ resolution: "4k" }, { ratio: "21:9" }, { seed: 2147483648 }, { media: [image] },
      { inputMode: "first_frame", media: [image, image] }, { inputMode: "first_last_frame", media: [image, { type: "audio", url: "https://example.com/a.mp3" }] }]) {
      expect(() => buildWanVideoRequest({ ...base, ...patch } as WanVideoInput)).toThrow();
    }
  });
  it("accepts 10 images and rejects 11", () => {
    expect(buildWanVideoRequest({ ...base, inputMode: "multimodal", media: Array(10).fill(image) }).body.input.media).toHaveLength(10);
    expect(() => buildWanVideoRequest({ ...base, inputMode: "multimodal", media: Array(11).fill(image) })).toThrow();
  });
  it("normalizes the configured base path and rejects placeholders", () => {
    expect(getWanApiBase("https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/")).toBe("https://workspace.cn-beijing.maas.aliyuncs.com");
    expect(() => getWanApiBase("https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com")).toThrow();
    expect(getWanVideoPollPath("a/b")).toBe("/api/v1/tasks/a%2Fb");
  });
  it.each(["/compatible-mode/v1", "/compatible-mode/v1/", "/api/v1/services/aigc/video-generation/video-synthesis", "/api/v1/services/aigc/video-generation/video-synthesis/"])("accepts the copied Bailian base suffix %s", (suffix) => {
    expect(getWanApiBase(`https://workspace.cn-beijing.maas.aliyuncs.com${suffix}`)).toBe("https://workspace.cn-beijing.maas.aliyuncs.com");
  });
  it.each(["http://workspace.example.com", "https://user:secret@workspace.example.com", "https://workspace.example.com/other/v1", "https://workspace.example.com/compatible-mode/v1?key=secret", "https://workspace.example.com/compatible-mode/v1#fragment"])("rejects ambiguous or unsafe base %s", (address) => {
    expect(() => getWanApiBase(address)).toThrow();
  });
});

describe("Wan3.0 transport and registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({ provider: { baseUrl: "https://space.cn-beijing.maas.aliyuncs.com", apiKey: "test-saved-key", name: "百炼" }, decision: { providerId: "bailian", mode: "direct" } });
  });
  it("uses saved credentials, JSON and required async header, then polls the task", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ output: { task_id: "wan-task", task_status: "PENDING" } })));
    expect((await wanSubmitVideo(base)).taskId).toBe("wan-task");
    expect(mocks.context).toHaveBeenCalledWith("bailian");
    expect(mocks.fetch.mock.calls[0][2]).toMatchObject({ method: "POST", headers: { Authorization: "Bearer test-saved-key", "X-DashScope-Async": "enable", "Content-Type": "application/json" } });
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ output: { task_status: "RUNNING" } })));
    await wanGetVideoTask("wan-task");
    expect(mocks.fetch.mock.calls[1][1]).toBe("https://space.cn-beijing.maas.aliyuncs.com/api/v1/tasks/wan-task");
    expect(mocks.fetch.mock.calls[1][2]).not.toHaveProperty("body");
  });
  it("does not repeat an ambiguous submission and sanitizes credentials", async () => {
    mocks.fetch.mockRejectedValue(new Error("failed test-saved-key https://space.cn-beijing.maas.aliyuncs.com"));
    const error = await wanSubmitVideo(base).catch((e) => e);
    expect(error.message).not.toContain("test-saved-key");
    expect(error.message).not.toContain("space.cn-beijing.maas.aliyuncs.com");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["/compatible-mode/v1", "/api/v1/services/aigc/video-generation/video-synthesis"])("submits and polls native video endpoints when configuration uses %s", async (suffix) => {
    mocks.context.mockResolvedValue({ provider: { baseUrl: `https://space.cn-beijing.maas.aliyuncs.com${suffix}`, apiKey: "test-saved-key", name: "百炼" }, decision: { providerId: "bailian", mode: "direct" } });
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ output: { task_id: "wan-task" } })));
    await wanSubmitVideo(base);
    expect(mocks.fetch.mock.calls[0][1]).toBe("https://space.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis");
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ output: { task_status: "RUNNING" } })));
    await wanGetVideoTask("wan-task");
    expect(mocks.fetch.mock.calls[1][1]).toBe("https://space.cn-beijing.maas.aliyuncs.com/api/v1/tasks/wan-task");
  });
  it("registers the model without changing the existing default or bypassing provider enablement", () => {
    expect(sora2Models[0].id).toBe("doubao-seedance-2-0-260128");
    expect(normalizeVideoModelId("wan3.0-video")).toBe("wan3.0-video");
    expect(getVideoModelSpec("wan3.0-video")).toMatchObject({ label: "Wan3.0", provider: "bailian", maxDurationSeconds: 30 });
    const provider = getBuiltinProviders().find((p) => p.id === "bailian")!;
    expect(provider).toMatchObject({ enabled: false, videoModels: ["wan3.0-video"], egressMode: "direct" });
    expect(mergeSavedProvidersWithBuiltins([]).some((p) => p.id === "bailian")).toBe(true);
    expect(isProviderModelEnabled([provider], "video", "wan3.0-video")).toBe(false);
    expect(isProviderModelEnabled([{ ...provider, enabled: true }], "video", "wan3.0-video")).toBe(true);
    expect(supportsProviderModelFetch(provider)).toBe(true);
    expect(toResolvedProvider(provider).hasKey).toBe(false);
  });
});

describe("Wan3.0 media and billing", () => {
  const video = (seconds: number) => ({ byteSize: 1024, probe: { version: 1 as const, kind: "video" as const, detectedMime: "video/mp4", width: 720, height: 1280, frameRate: 30, durationSeconds: seconds } });
  it("checks reference totals and input plus output duration", () => {
    expect(validateWanMediaSet({ duration: 15, media: [video(15)] })).toEqual([]);
    expect(validateWanMediaSet({ duration: 16, media: [video(15)] })[0].code).toBe("WAN_TOTAL_DURATION");
    expect(validateWanMediaSet({ duration: -1, media: [video(15)] })).toEqual([]);
    expect(validateWanMediaSet({ media: [video(8), video(8)] })[0].code).toBe("WAN_VIDEO_DURATION");
  });
  it("checks model-specific image byte and dimension boundaries", () => {
    const image = { byteSize: 20 * 1024 * 1024, probe: { version: 1 as const, kind: "image" as const, detectedMime: "image/png", width: 8000, height: 1000 } };
    expect(validateWanMediaSet({ media: [image] })).toEqual([]);
    expect(validateWanMediaSet({ media: [{ ...image, byteSize: image.byteSize + 1 }] })).not.toEqual([]);
    expect(validateWanMediaSet({ media: [{ ...image, probe: { ...image.probe, width: 8001 } }] })).not.toEqual([]);
  });
  it("bills actual input plus output seconds for smart duration", async () => {
    const db = { billingPriceRule: { findMany: vi.fn(async () => WAN_VIDEO_DEFAULT_PRICE_RULES.map((r, i) => ({ ...r, id: i + 1, effectiveFrom: new Date(0), effectiveTo: null }))) },
      usageLedger: { upsert: vi.fn(async ({ create }) => create) } };
    const ledger = await upsertUsageLedgerForGeneration({ id: 991, userId: "7", authUserId: 7, type: "video_gen", source: "tool", prompt: "cat", model: "wan3.0-video", status: "success",
      externalProvider: "bailian", externalTaskId: "wan-task", errorMsg: null, createdAt: new Date(), finishedAt: new Date(),
      templateData: JSON.stringify({ model: "wan3.0-video", resolution: "720p", duration: -1, providerUsage: { input_video_duration: 3.5, output_video_duration: 6 } }),
    }, db);
    expect(ledger.unitCount.toNumber()).toBe(9.5);
    expect(ledger.amount.toNumber()).toBeCloseTo(5.7);
  });
});
