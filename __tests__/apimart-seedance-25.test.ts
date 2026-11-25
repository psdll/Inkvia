import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/apimart-image", () => ({
  requestJsonViaProxy: mocks.request,
  resolveApimartEndpoint: mocks.resolve,
}));
vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));

import { apimartSubmitVideo, buildApimartVideoRequest } from "@/lib/apimart-video";
import { getVideoModelSpec, isApimartVideoModel, isVolcengineVideoModel } from "@/lib/sora2";
import { mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { getSeedanceMediaPolicy } from "@/lib/seedance-media-policy";
import { getLiveVideoBatchModelSpec } from "@/lib/live-video-batch/video-models";
import { buildGenerationPrompt } from "@/lib/generation/prompt-references";
import { createVideoTaskSchema } from "@/lib/generation/task-input-schema";
import { has30SecondControl } from "@/lib/video-duration-visibility";

const model = "seedance-2.5-apimart";

describe("APIMart Seedance 2.5", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolve.mockResolvedValue({ base: "https://api.apimart.ai/v1", apiKey: "saved-test-key", decision: { providerId: "apimart" } });
    mocks.request.mockResolvedValue({ code: 200, data: [{ status: "submitted", task_id: "am-25-task" }] });
  });

  it("keeps official capabilities while routing the new local ID to APIMart", () => {
    const { id, label, provider, ...official } = getVideoModelSpec("doubao-seedance-2-5-260628");
    expect(getVideoModelSpec(model)).toEqual({ ...official, id: model, label: "Seedance 2.5（am）", provider: "apimart", upstreamModelId: "seedance-2.5" });
    expect(isApimartVideoModel(model)).toBe(true);
    expect(isVolcengineVideoModel(model)).toBe(false);
    expect(getSeedanceMediaPolicy(model)).toEqual(getSeedanceMediaPolicy(id));
    expect(getLiveVideoBatchModelSpec(model)?.id).toBe(model);
    expect(has30SecondControl(model)).toBe(true);
  });

  it("adds the upstream capability to saved providers without enabling a disabled provider", () => {
    const providers = mergeSavedProvidersWithBuiltins([{ id: "apimart", enabled: false, videoModels: ["doubao-seedance-2.0-face"], imageModels: [], chatModels: [], baseUrl: "https://saved.example/v1", apiKey: "saved", egressMode: "direct" } as any]);
    const provider = providers.find(p => p.id === "apimart")!;
    expect(provider.videoModels).toEqual(["doubao-seedance-2.0-face", "seedance-2.5"]);
    expect(provider).toMatchObject({ enabled: false, baseUrl: "https://saved.example/v1", apiKey: "saved", egressMode: "direct" });
    expect(isProviderModelEnabled(providers, "video", model)).toBe(false);
    expect(isProviderModelEnabled([{ ...provider, enabled: true }], "video", model)).toBe(true);
  });

  it("uses the documented endpoint, task ID and JSON fields for text generation", async () => {
    const result = await apimartSubmitVideo({ model, prompt: "云海", resolution: "1080p", size: "21:9", duration: 30, generateAudio: false, outputFormat: "mov", watermark: true, seed: 42, cameraFixed: true } as any);
    expect(result.taskId).toBe("am-25-task");
    expect(result.request).toEqual({ model: "seedance-2.5", prompt: "云海", resolution: "1080p", size: "21:9", duration: 30, generate_audio: false, output_format: "mov", watermark: true });
    expect(mocks.request).toHaveBeenCalledWith({ providerId: "apimart" }, "https://api.apimart.ai/v1/videos/generations", expect.objectContaining({ method: "POST", headers: { Authorization: "Bearer saved-test-key", "Content-Type": "application/json" }, body: JSON.stringify(result.request) }));
  });

  it("preserves all 30 images, 10 videos and 10 audios in per-kind order", () => {
    const files = ["image", "video", "audio"].flatMap(type => Array.from({ length: type === "image" ? 30 : 10 }, (_, i) => ({ type, url: `https://cdn.example/${type}-${i}` })));
    const request = buildApimartVideoRequest({ model, prompt: "@图片2 参考 @视频1 配 @音频1", size: "adaptive", duration: -1, mediaFiles: files, omniReferenceTaskType: "edit", outputFormat: "mov", returnLastFrame: true, webSearch: true } as any);
    expect(request).toMatchObject({ model: "seedance-2.5", duration: -1, omni_reference_task_type: "edit", output_format: "mov", return_last_frame: true, tools: [{ type: "web_search" }] });
    expect(request.image_with_roles).toEqual(files.filter(f=>f.type === "image").map(f=>({ url: f.url, role: "reference_image" })));
    expect(request.video_urls).toEqual(files.filter(f=>f.type === "video").map(f=>f.url));
    expect(request.audio_urls).toEqual(files.filter(f=>f.type === "audio").map(f=>f.url));
    for (const field of ["content", "ratio", "n", "seed", "camera_fixed", "draft", "service_tier", "image_urls"]) expect(request).not.toHaveProperty(field);
  });

  it("preserves first and last frame roles and standalone audio", () => {
    expect(buildApimartVideoRequest({ model, prompt: "过渡", size: "adaptive", mediaFiles: [{ type: "image", role: "first_frame", url: "https://cdn.example/first.png" }, { type: "image", role: "last_frame", url: "https://cdn.example/last.png" }] } as any).image_with_roles).toEqual([{ url: "https://cdn.example/first.png", role: "first_frame" }, { url: "https://cdn.example/last.png", role: "last_frame" }]);
    const audio = buildApimartVideoRequest({ model, prompt: "音乐", mediaFiles: [{ type: "audio", url: "https://cdn.example/a.mp3" }] } as any);
    expect(audio.audio_urls).toEqual(["https://cdn.example/a.mp3"]);
    expect(audio).not.toHaveProperty("image_with_roles");
  });

  it("uses APIMart's Chinese mentions, without changing the official format", () => {
    const input = { kind: "video" as const, prompt: "@图片1 参考 @视频1", media: [{ kind: "image" as const, url: "a" }, { kind: "video" as const, url: "b" }] };
    expect(buildGenerationPrompt({ ...input, model }).modelPrompt).toBe(input.prompt);
    expect(buildGenerationPrompt({ ...input, model: "doubao-seedance-2-5-260628" }).modelPrompt).toBe("@image1 参考 @video1");
  });

  it("exposes edit and MOV through the agent schema", () => {
    expect(createVideoTaskSchema.safeParse({ model, prompt: "编辑视频", inputMode: "multimodal", mediaPaths: ["/uploads/a.mp4"], ratio: "adaptive", duration: -1, resolution: "1080p", omniReferenceTaskType: "edit", outputFormat: "mov" }).success).toBe(true);
  });
});
