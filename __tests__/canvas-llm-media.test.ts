import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ image: vi.fn(), external: vi.fn(), fetch: vi.fn(), platform: vi.fn(), providerContext: vi.fn(), providerFetch: vi.fn() }));
vi.mock("@/lib/prompt-reverse-media-url", () => ({ resolvePromptReverseMediaUrl: mocks.image }));
vi.mock("@/lib/external-assets", () => ({ resolveAssetUrlForExternalApi: mocks.external }));
vi.mock("@/lib/ssrf-guard", () => ({ safeFetch: mocks.fetch }));
vi.mock("@/lib/media-delivery/deliver", () => ({ resolveMediaForPlatform: mocks.platform }));
vi.mock("@/lib/providers/transport", () => ({
  resolveProviderRequestContext: mocks.providerContext,
  fetchWithProviderEgress: mocks.providerFetch,
}));
import { buildCanvasLlmContent, normalizeCanvasLlmMedia } from "@/lib/canvas/llm-media";
import { buildCanvasRunStepSubmission } from "@/lib/canvas/run-worker-contract";
import type { CanvasNode } from "@/lib/canvas/document";
import { DOUBAO_SEED_EVOLVING_MODEL_ID } from "@/lib/volcengine-llm-models";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MEDIA_DELIVERY_MODE", "oss");
  mocks.image.mockResolvedValue("https://relay.example/image.jpg");
  mocks.external.mockImplementation(async (url: string) => url.replace("/uploads/", "https://relay.example/"));
});

afterEach(() => vi.unstubAllEnvs());

async function withLocalMedia(run: (clip: string, audio: string) => Promise<void>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "llm-media-"));
  vi.stubEnv("UPLOADS_DIR", directory);
  await fs.writeFile(path.join(directory, "clip.mp4"), "video");
  await fs.writeFile(path.join(directory, "audio.wav"), "audio");
  try { await run("/uploads/clip.mp4", "/uploads/audio.wav"); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

it.each(["http://localhost:3100", "https://inkvia.test"])("sends local Qwen Omni video and audio inline from %s in platform-first mode", async origin => {
  vi.stubEnv("MEDIA_DELIVERY_MODE", "platform");
  await withLocalMedia(async (clip, audio) => {
    const content = await buildCanvasLlmContent({ providerId: "bailian", modelId: "qwen3.8-omni-flash", prompt: "compare", origin, mediaReferences: [
      { kind: "video", url: clip }, { kind: "audio", url: audio },
    ] });
    expect(content).toEqual([
      { type: "text", text: "compare" },
      { type: "video_url", video_url: { url: `data:;base64,${Buffer.from("video").toString("base64")}` } },
      { type: "input_audio", input_audio: { data: `data:;base64,${Buffer.from("audio").toString("base64")}`, format: "wav" } },
    ]);
    expect(mocks.external).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

it("uses the existing public URL resolver when Qwen local video exceeds the inline size", async () => {
  vi.stubEnv("MEDIA_DELIVERY_MODE", "platform");
  await withLocalMedia(async (clip) => {
    await fs.truncate(path.join(process.env.UPLOADS_DIR!, "clip.mp4"), 8 * 1024 * 1024);
    const content = await buildCanvasLlmContent({ providerId: "bailian", modelId: "qwen3.8-flash", prompt: "watch", mediaReferences: [{ kind: "video", url: clip }] });
    expect(content).toEqual([
      { type: "text", text: "watch" }, { type: "video_url", video_url: { url: "https://relay.example/clip.mp4" } },
    ]);
    expect(mocks.external).toHaveBeenCalledWith(clip, "canvas-llm-inputs");
  });
});

it("sends Ark's native file ID for a local video above the inline recommendation", async () => {
  vi.stubEnv("MEDIA_DELIVERY_MODE", "platform");
  const decision = { mode: "direct" };
  const baseUrl = "https://ark.example/api/v3";
  mocks.providerContext.mockResolvedValueOnce({ decision, provider: { baseUrl, apiKey: "test-key" } });
  mocks.providerFetch.mockResolvedValueOnce(Response.json({ id: "file-ark-test", status: "active" }));
  await withLocalMedia(async clip => {
    await fs.truncate(path.join(process.env.UPLOADS_DIR!, "clip.mp4"), 11 * 1024 * 1024);
    const content = await buildCanvasLlmContent({ providerId: "volcengine", modelId: DOUBAO_SEED_EVOLVING_MODEL_ID, prompt: "watch", mediaReferences: [{ kind: "video", url: clip }] });
    expect(content).toEqual([{ type: "text", text: "watch" }, { type: "video_url", video_url: { file_id: "file-ark-test" } }]);
    expect(mocks.providerContext).toHaveBeenCalledWith("volcengine");
    expect(mocks.providerFetch).toHaveBeenCalledWith(decision, `${baseUrl}/files`, expect.objectContaining({ method: "POST" }));
    const form = mocks.providerFetch.mock.calls[0][2].body;
    expect(form.get("purpose")).toBe("user_data");
    expect(form.get("preprocess_configs[video][model]")).toBe(DOUBAO_SEED_EVOLVING_MODEL_ID);
    expect(form.get("file").type).toBe("video/mp4");
    expect(mocks.external).not.toHaveBeenCalled();
  });
});

it("skips Ark Files and Base64 for a format absent from the Ark video contract", async () => {
  vi.stubEnv("MEDIA_DELIVERY_MODE", "platform");
  await withLocalMedia(async () => {
    await fs.writeFile(path.join(process.env.UPLOADS_DIR!, "clip.webm"), "video");
    const clip = "/uploads/clip.webm";
    const content = await buildCanvasLlmContent({ providerId: "volcengine", modelId: DOUBAO_SEED_EVOLVING_MODEL_ID, prompt: "watch", mediaReferences: [{ kind: "video", url: clip }] });
    expect(content).toEqual([{ type: "text", text: "watch" }, { type: "video_url", video_url: { url: "https://relay.example/clip.webm" } }]);
    expect(mocks.providerContext).not.toHaveBeenCalled();
    expect(mocks.external).toHaveBeenCalledWith(clip, "canvas-llm-inputs");
  });
});

it("falls back to the existing relay after Ark Files fails beyond the inline budget", async () => {
  vi.stubEnv("MEDIA_DELIVERY_MODE", "platform");
  mocks.providerContext.mockResolvedValueOnce({ decision: { mode: "direct" }, provider: { baseUrl: "https://ark.example/api/v3", apiKey: "test-key" } });
  mocks.providerFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await withLocalMedia(async clip => {
    await fs.truncate(path.join(process.env.UPLOADS_DIR!, "clip.mp4"), 51 * 1024 * 1024);
    const content = await buildCanvasLlmContent({ providerId: "volcengine", modelId: DOUBAO_SEED_EVOLVING_MODEL_ID, prompt: "watch", mediaReferences: [{ kind: "video", url: clip }] });
    expect(content).toEqual([{ type: "text", text: "watch" }, { type: "video_url", video_url: { url: "https://relay.example/clip.mp4" } }]);
    expect(mocks.providerFetch).toHaveBeenCalledTimes(1);
    expect(mocks.external).toHaveBeenCalledWith(clip, "canvas-llm-inputs");
  });
});

it("uses KIE's own uploader and unified media blocks for its Gemini chat endpoint", async () => {
  vi.stubEnv("MEDIA_DELIVERY_MODE", "platform");
  mocks.platform.mockResolvedValueOnce("https://kie.test/clip.mp4").mockResolvedValueOnce("https://kie.test/audio.wav");
  const content = await buildCanvasLlmContent({ providerId: "kie", modelId: "gemini-3-8-flash-openai", prompt: "watch", mediaReferences: [
    { kind: "video", url: "/uploads/clip.mp4" }, { kind: "audio", url: "/uploads/audio.wav" },
  ] });
  expect(content).toEqual([
    { type: "text", text: "watch" },
    { type: "image_url", image_url: { url: "https://kie.test/clip.mp4" } },
    { type: "image_url", image_url: { url: "https://kie.test/audio.wav" } },
  ]);
  expect(mocks.platform).toHaveBeenNthCalledWith(1, "/uploads/clip.mp4", "canvas-llm-inputs", { platform: "kie" }, "video");
  expect(mocks.platform).toHaveBeenNthCalledWith(2, "/uploads/audio.wav", "canvas-llm-inputs", { platform: "kie" }, "audio");
  expect(mocks.external).not.toHaveBeenCalled();
});

it("reads standard audio input directly from local storage in platform-first mode", async () => {
  vi.stubEnv("MEDIA_DELIVERY_MODE", "platform");
  await withLocalMedia(async (_clip, audio) => {
    const content = await buildCanvasLlmContent({ providerId: "openrouter", modelId: "custom-audio-model", prompt: "listen", mediaReferences: [{ kind: "audio", url: audio }] });
    expect(content).toEqual([
      { type: "text", text: "listen" },
      { type: "input_audio", input_audio: { data: Buffer.from("audio").toString("base64"), format: "wav" } },
    ]);
    expect(mocks.external).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

it("retains the OSS configuration error for a URL-only video model", async () => {
  vi.stubEnv("MEDIA_DELIVERY_MODE", "platform");
  await withLocalMedia(async (clip) => {
    const error = Object.assign(new Error("请在系统设置里配置阿里云 OSS"), { name: "MissingExternalAssetStorageError" });
    mocks.external.mockRejectedValueOnce(error);
    await expect(buildCanvasLlmContent({ providerId: "bigmodel", modelId: "glm-5.3-flash", prompt: "watch", mediaReferences: [{ kind: "video", url: clip }] }))
      .rejects.toThrow("请在系统设置里配置阿里云 OSS");
    expect(mocks.external).toHaveBeenCalledWith(clip, "canvas-llm-inputs");
  });
});

it("relays local images through the working role-prompt path for DeepSeek vision", async () => {
  const content = await buildCanvasLlmContent({ providerId: "deepseek", modelId: "deepseek-v4-flash-vision-exp", prompt: "describe", mediaReferences: [{ kind: "image", url: "/uploads/test.png" }] });
  expect(mocks.image).toHaveBeenCalledWith("/uploads/test.png", "http://localhost", "deepseek");
  expect(content).toEqual([{ type: "text", text: "describe" }, { type: "image_url", image_url: { url: "https://relay.example/image.jpg" } }]);
});

it("preserves ordered mixed media and submits real video and audio to Qwen Omni", async () => {
  const content = await buildCanvasLlmContent({ providerId: "bailian", modelId: "qwen3.8-omni-flash", prompt: "compare", mediaReferences: [
    { kind: "video", url: "/uploads/clip.mp4" }, { kind: "image", url: "/uploads/test.png" }, { kind: "audio", url: "/uploads/speech.wav" },
  ] });
  expect(content).toEqual([
    { type: "text", text: "compare" }, { type: "video_url", video_url: { url: "https://relay.example/clip.mp4" } },
    { type: "image_url", image_url: { url: "https://relay.example/image.jpg" } }, { type: "input_audio", input_audio: { data: "https://relay.example/speech.wav" } },
  ]);
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("uses Base64 audio for standard OpenAI-compatible audio endpoints", async () => {
  mocks.fetch.mockResolvedValue(new Response("audio", { headers: { "content-type": "audio/mpeg" } }));
  const content = await buildCanvasLlmContent({ providerId: "openai", modelId: "gpt-audio", prompt: "listen", mediaReferences: [{ kind: "audio", url: "https://cdn.example/speech.mp3" }] });
  expect(content).toEqual([{ type: "text", text: "listen" }, { type: "input_audio", input_audio: { data: Buffer.from("audio").toString("base64"), format: "mp3" } }]);
});

it.each(["audio", "video"] as const)("rejects unsupported DeepSeek %s before preparing any media", async (kind) => {
  await expect(buildCanvasLlmContent({ providerId: "deepseek", modelId: "deepseek-v4-flash-vision-exp", prompt: "describe", mediaReferences: [{ kind, url: "/uploads/file.mp4" }] })).rejects.toThrow("不支持");
  expect(mocks.image).not.toHaveBeenCalled();
  expect(mocks.external).not.toHaveBeenCalled();
});

it("gives a media preparation error without leaking storage internals", async () => {
  mocks.image.mockRejectedValueOnce(new Error("private-storage-credentials"));
  await expect(buildCanvasLlmContent({ providerId: "deepseek", modelId: "deepseek-v4-flash-vision-exp", prompt: "describe", mediaReferences: [{ kind: "image", url: "/uploads/test.png" }] })).rejects.toThrow("参考图片无法读取或转存");
});

it.each([null, {}, [{ kind: "file", url: "https://cdn.example/a" }], [{ kind: "image", url: "file:///a" }], [{ kind: "video", url: "blob:local" }], [{ kind: "audio", url: "https://user:password@cdn.example/a" }]])("rejects invalid media references %j", (value) => {
  expect(() => normalizeCanvasLlmMedia(value)).toThrow();
});

it("deduplicates media while retaining ordering", () => {
  const a = { kind: "image", url: "/uploads/a.png" };
  expect(normalizeCanvasLlmMedia([a, { kind: "video", url: "/uploads/b.mp4" }, a])).toHaveLength(2);
});

it("retains all connected media in the durable worker submission", () => {
  const node: CanvasNode = { id: "llm", type: "llm", position: { x: 0, y: 0 }, data: { kind: "llm", providerId: "bailian", model: "qwen3.8-omni-flash", prompt: "describe", status: "idle" } };
  const incomingNodes: CanvasNode[] = (["video", "image", "audio"] as const).map(kind => ({ id: kind, type: kind, position: { x: 0, y: 0 }, data: { kind, url: `/uploads/${kind}` } }));
  expect(buildCanvasRunStepSubmission({ nodeKind: "llm", node, incomingNodes, incomingEdges: incomingNodes.map(n => ({ id: n.id, source: n.id, target: node.id })) })).toMatchObject({
    mediaReferences: incomingNodes.map(n => ({ kind: n.data.kind, url: `/uploads/${n.data.kind}` })),
  });
});
