import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn(async (_ms: number, _value: unknown, options: { signal?: AbortSignal }) => { options.signal?.throwIfAborted(); }) }));
vi.mock("@/lib/maintenance", () => ({ assertDurableWorkAdmission: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {}, prisma: {} }));
vi.mock("@/lib/generation/image-service", () => ({ createImageGeneration: vi.fn() }));
vi.mock("@/lib/generation/video-service", () => ({ createVideoGeneration: vi.fn() }));
vi.mock("@/lib/generation/finalize", () => ({ finalizeGeneration: vi.fn() }));
vi.mock("@/lib/canvas/generation-media", () => ({ getOrCreateGenerationMediaAsset: vi.fn() }));
vi.mock("@/lib/image-edit-models", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/image-edit-models")>(), getVisibleImageEditModels: vi.fn(), getVisibleToolboxModels: vi.fn() }));
vi.mock("@/lib/providers/registry", () => ({ getRegisteredProviders: vi.fn() }));
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentCanvas: vi.fn(), requireCreativeAgentEnabled: vi.fn() }));
import { prepareCreativeAgentMedia, executeCreativeAgentMediaTool, assertCreativeAgentMediaApproval, waitForCreativeAgentMedia, type CreativeAgentMediaDependencies } from "@/lib/creative-agent/media-broker";
import { creativeAgentNodeHash, type CreativeAgentToolInput } from "@/lib/creative-agent/canvas-tools";
import type { CanvasNode } from "@/lib/canvas/document";
import { getImageModelParams } from "@/lib/generation/image-model-params";

const image: CanvasNode = { id: "image", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/uploads/reference.png", mediaId: "media-id" } };
const reference = { nodeId: "image", semanticHash: creativeAgentNodeHash(image), mediaId: "media-id" };
const input = (args?: unknown): CreativeAgentToolInput => ({ actorUserId: 1, canvasId: 57, runId: "run", actionId: "action", epoch: 1, kind: "image.generate", args: args ?? { model: "test-image", prompt: "角色肖像", references: [reference], params: { count: 1 } }, mediaApproval: { decisionId: "decision", proposalHash: "proposal" } });
let deps: CreativeAgentMediaDependencies, records: Map<string, any>;
beforeEach(() => {
 records = new Map();
 deps = {
  readCanvas: vi.fn(async () => ({ revision: "1", nodes: structuredClone([image]), edgeIds: [] })),
  catalog: vi.fn<CreativeAgentMediaDependencies["catalog"]>(async () => ({ image: [{ id: "test-image", label: "测试图片", params: { aspectRatios: [{ value: "1:1", label: "1:1" }], resolutions: [{ value: "2K", label: "2K" }], qualities: [{ value: "medium", label: "medium" }], defaultAspectRatio: "1:1", defaultResolution: "2K", defaultQuality: "medium" } }], video: [{ id: "test-video", label: "测试视频", supportedInputModes: ["text_to_video", "first_frame"], supportedResolutions: ["720p"], minDurationSeconds: 5, maxDurationSeconds: 10, supportsGenerateAudio: false, supportedRatios: ["16:9"] }] })),
  claimApproval: vi.fn(async () => ({ fresh: true })),
  findGeneration: vi.fn(async query => query.requestKey ? records.get(query.requestKey) ?? null : [...records.values()].find(row => row.id === query.id) ?? null),
  createImage: vi.fn<CreativeAgentMediaDependencies["createImage"]>(async request => { const row = { id: records.size + 10, authUserId: request.authUserId, canvasId: request.canvasId, type: "image_edit", source: "agent", model: request.model, requestKey: request.requestKey, status: "running", localPath: null, templateData: JSON.stringify({ skill: request.skill }) }; records.set(request.requestKey!, row); return { generationId: row.id, taskId: "external", status: "running" }; }),
  createVideo: vi.fn<CreativeAgentMediaDependencies["createVideo"]>(async request => { const row = { id: 30, authUserId: request.authUserId, canvasId: request.canvasId, type: "video_gen", source: "agent", model: request.model, requestKey: request.requestKey, status: "running", localPath: null, templateData: JSON.stringify({ skill: request.skill }) }; records.set(request.requestKey!, row); return { generationId: row.id, taskId: "video", status: "running" }; }),
  finalize: vi.fn<CreativeAgentMediaDependencies["finalize"]>(async () => "pending"),
  attach: vi.fn(async () => ({ revision: "2", nodeIds: ["output-node"] })),
 };
});
describe("Agent media broker", () => {
 it("looks up guidance only for the actual catalog and keeps current channel limits authoritative", async () => {
  const catalog = await deps.catalog();
  catalog.video[0].id = "doubao-seedance-2.5";
  vi.mocked(deps.catalog).mockResolvedValue(catalog);
  const result = await executeCreativeAgentMediaTool({ ...input(), kind: "model.guidance", args: { model: "doubao-seedance-2.5", mediaType: "video" } }, deps);
  expect(result).toMatchObject({ profileId: "seedance_2_5", currentCapabilities: { maxDurationSeconds: 10, supportsGenerateAudio: false } });
  await expect(executeCreativeAgentMediaTool({ ...input(), kind: "model.guidance", args: { model: "unavailable", mediaType: "image" } }, deps)).rejects.toMatchObject({ code: "MEDIA_MODEL_UNAVAILABLE" });
  expect(deps.createImage).not.toHaveBeenCalled(); expect(deps.createVideo).not.toHaveBeenCalled();
 });
 it("returns unknown evidence instead of inventing traits for an available unprofiled model", async () => {
  const result = await executeCreativeAgentMediaTool({ ...input(), kind: "model.guidance", args: { model: "test-image", mediaType: "image" } }, deps);
  expect(result).toMatchObject({ basis: "unverified", sources: [], localComparativeEvidence: [], currentCapabilities: { id: "test-image" } });
 });
 it("prepares exact references and budget without any paid dispatch", async () => {
  const proposal = await prepareCreativeAgentMedia(input(), deps);
  expect(proposal.binding).toMatchObject({ kind: "image.generate", units: 1 });
  expect(proposal.binding!.argsHash).toMatch(/^[a-f0-9]{64}$/);
  expect(proposal.question).toContain("1 次");
  expect(deps.createImage).not.toHaveBeenCalled(); expect(deps.claimApproval).not.toHaveBeenCalled();
 });
 it("offers only live models compatible with exact references and parameters without reading repeatedly", async () => {
  const catalog = await deps.catalog();
  catalog.image.push({ ...catalog.image[0], id: "wrong-size", label: "尺寸不匹配", params: { ...catalog.image[0].params, resolutions: [{ value: "1K", label: "1K" }] } });
  catalog.image.push({ ...catalog.image[0], id: "second-image", label: "第二个图片模型" });
  vi.mocked(deps.catalog).mockResolvedValue(catalog).mockClear();
  const choice = await prepareCreativeAgentMedia(input({ prompt: "角色肖像", references: [reference], params: { resolution: "2K" } }), deps);
  expect(choice.fields).toMatchObject([{ id: "imageModel", type: "select", required: true, options: [{ value: "test-image", label: "测试图片" }, { value: "second-image", label: "第二个图片模型" }] }]);
  expect(choice.binding).toBeUndefined(); expect(choice.options).toEqual([]);
  expect(deps.catalog).toHaveBeenCalledTimes(1); expect(deps.readCanvas).toHaveBeenCalledTimes(1);
  expect(deps.createImage).not.toHaveBeenCalled(); expect(deps.claimApproval).not.toHaveBeenCalled();
 });
 it("validates reference identity before allowing a model choice", async () => {
  await expect(prepareCreativeAgentMedia(input({ prompt: "x", references: [{ ...reference, semanticHash: "0".repeat(64) }] }), deps)).rejects.toMatchObject({ code: "REFERENCE_CHANGED" });
 });
 it("filters video input modes and audio capability before offering a model", async () => {
  const catalog = await deps.catalog();
  catalog.video.push({ ...catalog.video[0], id: "audio-video", label: "支持声音的视频模型", supportsGenerateAudio: true });
  vi.mocked(deps.catalog).mockResolvedValue(catalog);
  const choice = await prepareCreativeAgentMedia({ ...input(), kind: "video.generate", args: { prompt: "人物说话", references: [reference], params: { inputMode: "first_frame", generateAudio: true } } }, deps);
  expect(choice.fields?.[0]).toMatchObject({ id: "videoModel", options: [{ value: "audio-video", label: "支持声音的视频模型" }] });
  expect(deps.createVideo).not.toHaveBeenCalled();
 });
 it("keeps the full live model directory selectable beyond twelve entries", async () => {
  const catalog = await deps.catalog();
  catalog.image = Array.from({ length: 20 }, (_, index) => ({ ...catalog.image[0], id: `image-${index}`, label: `图片模型 ${index}` }));
  vi.mocked(deps.catalog).mockResolvedValue(catalog);
  const choice = await prepareCreativeAgentMedia(input({ prompt: "角色肖像" }), deps);
  expect(choice.fields?.[0].options).toHaveLength(20);
 });
 it("shows readable approval metadata while preserving the full prompt and exact binding", async () => {
  const prompt = "完整提示词".repeat(2000);
  const proposal = await prepareCreativeAgentMedia(input({ model: "test-image", prompt, references: [reference], params: { count: 2 } }), deps);
  expect(proposal).toMatchObject({ media: { mediaType: "image", model: { id: "test-image", label: "测试图片" }, prompt, units: 2, params: { count: 2, aspectRatio: "1:1", resolution: "2K" }, references: [{ nodeId: "image", kind: "image", url: "/uploads/reference.png" }] } });
  expect(proposal.question).toContain("测试图片"); expect(proposal.question).toContain("1:1"); expect(proposal.question.length).toBeLessThan(4000);
  expect(proposal.question).not.toContain('{"count"'); expect(proposal.binding).toMatchObject({ units: 2 });
 });
 it("rejects caller supplied reference URLs", async () => {
  await expect(prepareCreativeAgentMedia(input({ model: "test-image", prompt: "x", references: [{ ...reference, url: "https://attacker.test/x.png" }] }), deps)).rejects.toThrow();
  expect(deps.createImage).not.toHaveBeenCalled();
 });
 it("requires concrete image batch and output identities and preserves reference order", async () => {
  const task: CanvasNode = { id: "task", type: "imageTask", position: { x: 0, y: 0 }, data: { kind: "imageTask", task: { references: [], settings: {} as any, batches: [{ id: "batch", createdAt: 1, settings: {} as any, outputs: [{ id: "one", status: "success", url: "/uploads/one.png" }, { id: "two", status: "success", url: "/uploads/two.png", mediaId: "two-media" }] }] } } };
  vi.mocked(deps.readCanvas).mockResolvedValue({ revision: "1", nodes: [image, task], edgeIds: [] });
  const taskRef = { nodeId: "task", semanticHash: creativeAgentNodeHash(task), batchId: "batch", outputId: "two", mediaId: "two-media" };
  await executeCreativeAgentMediaTool(input({ model: "test-image", prompt: "x", references: [taskRef, reference] }), deps);
  expect(deps.createImage).toHaveBeenCalledWith(expect.objectContaining({ imagePaths: ["/uploads/two.png", "/uploads/reference.png"] }));
  await expect(prepareCreativeAgentMedia(input({ model: "test-image", prompt: "x", references: [{ nodeId: "task", semanticHash: creativeAgentNodeHash(task) }] }), deps)).rejects.toThrow();
 });
 it("binds approvals to changed parameters and references", async () => {
  const first = await prepareCreativeAgentMedia(input(), deps);
  const changed = await prepareCreativeAgentMedia(input({ model: "test-image", prompt: "新提示词", references: [reference], params: { count: 2 } }), deps);
  expect(first.binding!.argsHash).not.toBe(changed.binding!.argsHash);
  vi.mocked(deps.readCanvas).mockResolvedValue({ revision: "2", nodes: [{ ...image, data: { ...image.data, url: "/uploads/changed.png" } as any }], edgeIds: [] });
  await expect(prepareCreativeAgentMedia(input(), deps)).rejects.toThrow();
 });
 it("changes the exact approval binding when the selected model changes", async () => {
  const catalog = await deps.catalog();
  catalog.image.push({ ...catalog.image[0], id: "second-image", label: "第二个图片模型" });
  vi.mocked(deps.catalog).mockResolvedValue(catalog);
  const first = await prepareCreativeAgentMedia(input(), deps);
  const changed = await prepareCreativeAgentMedia(input({ model: "second-image", prompt: "角色肖像", references: [reference], params: { count: 1 } }), deps);
  expect(first.binding!.argsHash).not.toBe(changed.binding!.argsHash);
  expect(changed.media?.model).toEqual({ id: "second-image", label: "第二个图片模型" });
 });
 it("excludes Qwen Image 3.0 when four references exceed the shared input limit", async () => {
  const catalog = await deps.catalog();
  catalog.image.push({ id: "qwen-image-3.0", label: "Qwen Image 3.0", params: getImageModelParams("qwen-image-3.0") });
  vi.mocked(deps.catalog).mockResolvedValue(catalog);
  const images = Array.from({ length: 4 }, (_, index) => ({ ...image, id: `ref-${index}` }));
  vi.mocked(deps.readCanvas).mockResolvedValue({ revision: "1", nodes: images, edgeIds: [] });
  const references = images.map(node => ({ nodeId: node.id, semanticHash: creativeAgentNodeHash(node) }));
  const choice = await prepareCreativeAgentMedia(input({ prompt: "合成角色", references }), deps);
  expect(choice.fields?.[0].options).toEqual([{ value: "test-image", label: "测试图片" }]);
  const request = input({ model: "qwen-image-3.0", prompt: "合成角色", references });
  await expect(prepareCreativeAgentMedia(request, deps)).rejects.toMatchObject({ code: "MEDIA_PARAMS_INVALID" });
  await expect(executeCreativeAgentMediaTool(request, deps)).rejects.toMatchObject({ code: "MEDIA_PARAMS_INVALID" });
  expect(deps.claimApproval).not.toHaveBeenCalled(); expect(deps.createImage).not.toHaveBeenCalled();
 });
 it("accepts the Qwen three-reference boundary and dispatches the same approved parameters", async () => {
  vi.mocked(deps.catalog).mockResolvedValue({ image: [{ id: "qwen-image-3.0", label: "Qwen Image 3.0", params: getImageModelParams("qwen-image-3.0") }], video: [] });
  const images = Array.from({ length: 3 }, (_, index) => ({ ...image, id: `ref-${index}` }));
  vi.mocked(deps.readCanvas).mockResolvedValue({ revision: "1", nodes: images, edgeIds: [] });
  const references = images.map(node => ({ nodeId: node.id, semanticHash: creativeAgentNodeHash(node) }));
  const request = input({ model: "qwen-image-3.0", prompt: "合成角色", references });
  const approval = await prepareCreativeAgentMedia(request, deps);
  await executeCreativeAgentMediaTool(request, deps);
  expect(deps.claimApproval).toHaveBeenCalledWith(request, approval.binding, expect.any(Array));
  expect(deps.createImage).toHaveBeenCalledWith(expect.objectContaining({ model: "qwen-image-3.0", imagePaths: Array(3).fill("/uploads/reference.png"), aspectRatio: "1:1", resolution: "2K", quality: "standard" }));
 });
 it("honors reference limits exposed by OpenRouter image capabilities", async () => {
  const catalog = await deps.catalog();
  catalog.image.push({ id: "gemini-3-pro-image-openrouter", label: "Gemini OpenRouter", params: getImageModelParams("gemini-3-pro-image-openrouter") });
  vi.mocked(deps.catalog).mockResolvedValue(catalog);
  const images = Array.from({ length: 15 }, (_, index) => ({ ...image, id: `ref-${index}` }));
  vi.mocked(deps.readCanvas).mockResolvedValue({ revision: "1", nodes: images, edgeIds: [] });
  const references = images.map(node => ({ nodeId: node.id, semanticHash: creativeAgentNodeHash(node) }));
  const choice = await prepareCreativeAgentMedia(input({ prompt: "合成角色", references }), deps);
  expect(choice.fields?.[0].options).toEqual([{ value: "test-image", label: "测试图片" }]);
  await expect(executeCreativeAgentMediaTool(input({ model: "gemini-3-pro-image-openrouter", prompt: "合成角色", references }), deps)).rejects.toMatchObject({ code: "MEDIA_PARAMS_INVALID" });
  expect(deps.claimApproval).not.toHaveBeenCalled(); expect(deps.createImage).not.toHaveBeenCalled();
 });
 it("excludes invalid resolution and aspect-ratio combinations and rejects direct approval and execution", async () => {
  const catalog = await deps.catalog();
  catalog.image[0].params.resolutions.push({ value: "4K", label: "4K" });
  catalog.image.push({ id: "gpt-image-2-jiekou", label: "GPT Image 接口", params: getImageModelParams("gpt-image-2-jiekou") });
  vi.mocked(deps.catalog).mockResolvedValue(catalog);
  const args = { prompt: "角色肖像", references: [reference], params: { aspectRatio: "1:1", resolution: "4K" } };
  const choice = await prepareCreativeAgentMedia(input(args), deps);
  expect(choice.fields?.[0].options).toEqual([{ value: "test-image", label: "测试图片" }]);
  const request = input({ ...args, model: "gpt-image-2-jiekou" });
  await expect(prepareCreativeAgentMedia(request, deps)).rejects.toMatchObject({ code: "MEDIA_PARAMS_INVALID" });
  await expect(executeCreativeAgentMediaTool(request, deps)).rejects.toMatchObject({ code: "MEDIA_PARAMS_INVALID" });
  expect(deps.claimApproval).not.toHaveBeenCalled(); expect(deps.createImage).not.toHaveBeenCalled();
 });
 it("keeps a supported linked size combination selectable with identical approval and execution binding", async () => {
  vi.mocked(deps.catalog).mockResolvedValue({ image: [{ id: "gpt-image-2-jiekou", label: "GPT Image 接口", params: getImageModelParams("gpt-image-2-jiekou") }], video: [] });
  const args = { prompt: "角色肖像", references: [reference], params: { aspectRatio: "16:9", resolution: "4K" } };
  const choice = await prepareCreativeAgentMedia(input(args), deps);
  expect(choice.fields?.[0].options).toEqual([{ value: "gpt-image-2-jiekou", label: "GPT Image 接口" }]);
  const request = input({ ...args, model: "gpt-image-2-jiekou" });
  const approval = await prepareCreativeAgentMedia(request, deps);
  await executeCreativeAgentMediaTool(request, deps);
  expect(deps.claimApproval).toHaveBeenCalledWith(request, approval.binding, expect.any(Array));
  expect(deps.createImage).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: "16:9", resolution: "4K" }));
 });
 it("blocks unavailable models and invalid configured parameters", async () => {
  await expect(prepareCreativeAgentMedia(input({ model: "disabled", prompt: "x" }), deps)).rejects.toThrow();
  await expect(prepareCreativeAgentMedia(input({ model: "test-image", prompt: "x", params: { resolution: "8K" } }), deps)).rejects.toThrow();
  expect(deps.createImage).not.toHaveBeenCalled();
 });
 it("dispatches through existing services with real owner/canvas and stable UUID keys", async () => {
  const result = await executeCreativeAgentMediaTool(input(), deps);
  const request = vi.mocked(deps.createImage).mock.calls[0][0];
  expect(request).toMatchObject({ source: "agent", authUserId: 1, canvasId: 57, n: 1, imagePaths: ["/uploads/reference.png"] });
  expect(request.requestKey).toMatch(/^[a-f0-9-]{36}$/);
  expect(request.skill?.id).toMatch(/^creative-agent:[a-f0-9]{64}$/);
  expect(result).toMatchObject({ generationId: 10, status: "running" });
  expect(deps.attach).not.toHaveBeenCalled();
 });
 it("reads a verified duplicate key instead of submitting again", async () => {
  const first = await executeCreativeAgentMediaTool(input(), deps);
  vi.mocked(deps.claimApproval).mockResolvedValue({ fresh: false });
  const second = await executeCreativeAgentMediaTool(input(), deps);
  expect(second.generationId).toBe(first.generationId);
  expect(deps.createImage).toHaveBeenCalledTimes(1);
 });
 it("rejects duplicate keys for another owner or changed payload", async () => {
  await executeCreativeAgentMediaTool(input(), deps);
  const existing = [...records.values()][0]; existing.authUserId = 2;
  await expect(executeCreativeAgentMediaTool(input(), deps)).rejects.toThrow();
  existing.authUserId = 1; existing.templateData = JSON.stringify({ skill: { id: "creative-agent:changed" } });
  await expect(executeCreativeAgentMediaTool(input(), deps)).rejects.toThrow();
  expect(deps.createImage).toHaveBeenCalledTimes(1);
 });
 it("never retries an unknown submission or starts the remaining paid calls", async () => {
  vi.mocked(deps.createImage).mockRejectedValue(new Error("timeout after dispatch"));
  await expect(executeCreativeAgentMediaTool(input({ model: "test-image", prompt: "x", params: { count: 3 } }), deps)).rejects.toMatchObject({ code: "MEDIA_DISPATCH_UNKNOWN" });
  expect(deps.createImage).toHaveBeenCalledTimes(1);
  vi.mocked(deps.claimApproval).mockResolvedValue({ fresh: false });
  await expect(executeCreativeAgentMediaTool(input(), deps)).rejects.toMatchObject({ code: "MEDIA_DISPATCH_UNKNOWN" });
  expect(deps.createImage).toHaveBeenCalledTimes(1);
 });
 it.each([false, true])("continues the approved batch after a durable synchronous failure (throws=%s)", async throws => {
  const originalCreate = vi.mocked(deps.createImage).getMockImplementation()!;
  vi.mocked(deps.createImage).mockImplementationOnce(async request => {
   const created = await originalCreate(request);
   const row = records.get(request.requestKey!); row.status = "failed"; row.errorMsg = "429 Too Many Requests";
   if (throws) throw Object.assign(new Error("429 Too Many Requests"), { generationId: row.id, friendlyError: { code: "RATE_LIMIT" } });
   return created;
  });
  const result = await executeCreativeAgentMediaTool(input({ model: "test-image", prompt: "x", params: { count: 3 } }), deps);
  expect(deps.createImage).toHaveBeenCalledTimes(3);
  expect(result.generationIds).toHaveLength(3);
  expect(result.generations).toMatchObject([{ status: "failed" }, { status: "running" }, { status: "running" }]);
 });
 it("keeps a persisted network exception unknown and stops the rest of the batch", async () => {
  const originalCreate = vi.mocked(deps.createImage).getMockImplementation()!;
  vi.mocked(deps.createImage).mockImplementationOnce(async request => {
   const created = await originalCreate(request);
   const row = records.get(request.requestKey!); row.status = "failed"; row.errorMsg = "ECONNRESET";
   throw Object.assign(new Error("ECONNRESET"), { generationId: created.generationId, friendlyError: { code: "NETWORK_ERROR" } });
  });
  await expect(executeCreativeAgentMediaTool(input({ model: "test-image", prompt: "x", params: { count: 3 } }), deps)).rejects.toMatchObject({ code: "MEDIA_DISPATCH_UNKNOWN" });
  expect(deps.createImage).toHaveBeenCalledTimes(1);
 });
 it.each([
  ["TIMEOUT", "任务处理超时"],
  ["UNKNOWN", "海牙 GPT-Image-2.5 连接中断，生成结果未知；请先核对海牙调用记录，避免重复提交计费"],
  ["UNKNOWN", "ENOSPC: no space left on device, write '/uploads/generated/image.png'"],
  ["RESULT_DOWNLOAD_FAILED", "远程结果已返回，但下载保存失败"],
 ])("keeps ambiguous persisted %s submission errors unknown and never replays them", async (code, message) => {
  const originalCreate = vi.mocked(deps.createImage).getMockImplementation()!;
  vi.mocked(deps.createImage).mockImplementationOnce(async request => {
   const created = await originalCreate(request);
   const row = records.get(request.requestKey!); row.status = "failed"; row.errorMsg = message;
   throw Object.assign(new Error(message), { generationId: created.generationId, friendlyError: { code } });
  });
  const request = input({ model: "test-image", prompt: "x", params: { count: 3 } });
  await expect(executeCreativeAgentMediaTool(request, deps)).rejects.toMatchObject({ code: "MEDIA_DISPATCH_UNKNOWN" });
  expect(deps.createImage).toHaveBeenCalledTimes(1);
  vi.mocked(deps.claimApproval).mockResolvedValue({ fresh: false });
  await expect(executeCreativeAgentMediaTool(request, deps)).rejects.toMatchObject({ code: "MEDIA_DISPATCH_UNKNOWN" });
  expect(deps.createImage).toHaveBeenCalledTimes(1);
 });
 it("queries the existing finalizer and attaches only durable successful outputs", async () => {
  await executeCreativeAgentMediaTool(input(), deps);
  const row = [...records.values()][0];
  vi.mocked(deps.finalize).mockImplementation(async () => { row.status = "success"; row.localPath = "/uploads/final.png"; return "done"; });
  const result = await executeCreativeAgentMediaTool({ ...input(), kind: "generation.read", args: { generationId: row.id } }, deps);
  expect(result).toMatchObject({ generationId: row.id, status: "success", revision: "2", nodeIds: ["output-node"] });
  expect(result.outputs).toMatchObject([{ url: "/uploads/final.png", generationId: row.id }]);
  expect(deps.finalize).toHaveBeenCalledWith(row.id); expect(deps.createImage).toHaveBeenCalledTimes(1);
 });
 it("does not treat provider success without saved media as delivery", async () => {
  await executeCreativeAgentMediaTool(input(), deps); const row = [...records.values()][0]; row.status = "success";
  const result = await executeCreativeAgentMediaTool({ ...input(), kind: "generation.read", args: { generationId: row.id } }, deps);
  expect(result.status).not.toBe("success"); expect(deps.attach).not.toHaveBeenCalled();
 });
 it("enforces video capabilities and submits using the same service", async () => {
  const request = { ...input({ model: "test-video", prompt: "运动", references: [reference], params: { inputMode: "first_frame", resolution: "720p", duration: 5, ratio: "16:9" } }), kind: "video.generate" };
  await executeCreativeAgentMediaTool(request, deps);
  expect(deps.createVideo).toHaveBeenCalledWith(expect.objectContaining({ authUserId: 1, canvasId: 57, source: "agent", mediaPaths: ["/uploads/reference.png"], inputMode: "first_frame", duration: 5 }));
  await expect(prepareCreativeAgentMedia({ ...request, args: { ...(request.args as any), params: { inputMode: "first_frame", generateAudio: true } } }, deps)).rejects.toThrow();
 });
});
describe("automatic media settlement", () => {
 it("continues polling after submission and awaits committed output delivery without another paid call", async () => {
  const submitted = await executeCreativeAgentMediaTool(input(), deps);
  const row = [...records.values()][0];
  let polls = 0;
  vi.mocked(deps.finalize).mockImplementation(async () => { if (++polls === 2) { row.status = "success"; row.localPath = "/uploads/ready.png"; return "done"; } return "pending"; });
  const progress = vi.fn(async () => {}), commit = vi.fn(async () => {});
  const result = await waitForCreativeAgentMedia(input(), { generationIds: [Number(submitted.generationId)], onCommitted: commit, onProgress: progress }, deps);
  expect(result.generations).toMatchObject([{ generationId: row.id, status: "success" }]);
  expect(commit).toHaveBeenCalledWith({ generationId: row.id, revision: "2", nodeIds: ["output-node"] });
  expect(progress.mock.calls).toHaveLength(2);
  expect(deps.createImage).toHaveBeenCalledTimes(1);
 });
 it("yields after one pending poll so the worker can release its lease", async () => {
  await executeCreativeAgentMediaTool(input(), deps); const row = [...records.values()][0];
  const commit = vi.fn(async () => {});
  const result = await waitForCreativeAgentMedia(input(), { generationIds: [row.id], pollOnce: true, onCommitted: commit }, deps);
  expect(result.pendingGenerationIds).toEqual([row.id]); expect(result.generations).toMatchObject([{ status: "running" }]);
  expect(deps.finalize).toHaveBeenCalledTimes(1); expect(commit).not.toHaveBeenCalled(); expect(deps.createImage).toHaveBeenCalledTimes(1);
 });
 it("retains a failed receipt across worker yields while other outputs are still pending", async () => {
  await executeCreativeAgentMediaTool(input({ model: "test-image", prompt: "x", params: { count: 2 } }), deps);
  const [failed, pending] = [...records.values()]; failed.status = "failed";
  const commit = vi.fn(async () => {}), options = { generationIds: [failed.id, pending.id], pollOnce: true, onCommitted: commit };
  const first = await waitForCreativeAgentMedia(input(), options, deps);
  expect(first.pendingGenerationIds).toEqual([pending.id]); expect(first.generations).toMatchObject([{ status: "failed" }, { status: "running" }]);
  pending.status = "success"; pending.localPath = "/uploads/ready.png";
  await expect(waitForCreativeAgentMedia(input(), options, deps)).rejects.toMatchObject({ code: "MEDIA_GENERATION_FAILED", generationIds: [failed.id] });
  expect(commit).toHaveBeenCalledTimes(1); expect(deps.createImage).toHaveBeenCalledTimes(2);
 });
 it("recovers a persisted generation identity after restart and attaches it automatically", async () => {
  await executeCreativeAgentMediaTool(input(), deps); const row = [...records.values()][0]; row.status = "success"; row.localPath = "/uploads/ready.png";
  const commit = vi.fn(async () => {});
  await waitForCreativeAgentMedia(input(), { generationIds: [row.id, row.id], onCommitted: commit }, deps);
  expect(commit).toHaveBeenCalledTimes(1); expect(deps.createImage).toHaveBeenCalledTimes(1);
 });
 it("reports generation failure and never marks the batch complete", async () => {
  await executeCreativeAgentMediaTool(input(), deps); const row = [...records.values()][0]; row.status = "failed";
  await expect(waitForCreativeAgentMedia(input(), { generationIds: [row.id], onCommitted: async () => {} }, deps)).rejects.toMatchObject({ code: "MEDIA_GENERATION_FAILED" });
  expect(deps.attach).not.toHaveBeenCalled();
 });
 it("delivers other confirmed outputs even when one generation fails", async () => {
  const submitted = await executeCreativeAgentMediaTool(input({ model: "test-image", prompt: "x", params: { count: 2 } }), deps);
  const [failed, successful] = [...records.values()]; failed.status = "failed"; successful.status = "success"; successful.localPath = "/uploads/second.png";
  const commit = vi.fn(async () => {});
  await expect(waitForCreativeAgentMedia(input(), { generationIds: submitted.generationIds as number[], onCommitted: commit }, deps)).rejects.toMatchObject({ code: "MEDIA_GENERATION_FAILED", generationIds: [failed.id] });
  expect(commit).toHaveBeenCalledWith(expect.objectContaining({ generationId: successful.id }));
  expect(deps.createImage).toHaveBeenCalledTimes(2);
 });
 it("retries only result attachment after a concurrent canvas edit", async () => {
  await executeCreativeAgentMediaTool(input(), deps); const row = [...records.values()][0]; row.status = "success"; row.localPath = "/uploads/ready.png";
  vi.mocked(deps.attach).mockRejectedValueOnce(Object.assign(new Error("canvas changed"), { code: "CANVAS_REVISION_CONFLICT" }));
  await waitForCreativeAgentMedia(input(), { generationIds: [row.id], onCommitted: async () => {} }, deps);
  expect(deps.attach).toHaveBeenCalledTimes(2); expect(deps.createImage).toHaveBeenCalledTimes(1);
 });
 it("does not finish until the canvas commit event has been persisted", async () => {
  await executeCreativeAgentMediaTool(input(), deps); const row = [...records.values()][0]; row.status = "success"; row.localPath = "/uploads/ready.png";
  let release!: () => void, settled = false;
  const commit = vi.fn(async () => new Promise<void>(resolve => { release = resolve; }));
  const completion = waitForCreativeAgentMedia(input(), { generationIds: [row.id], onCommitted: commit }, deps).then(result => { settled = true; return result; });
  await vi.waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  expect(settled).toBe(false); release(); await completion; expect(settled).toBe(true);
 });
 it("stops polling when paused or stopped and leaves submission receipts available", async () => {
  await executeCreativeAgentMediaTool(input(), deps); const row = [...records.values()][0], abort = new AbortController();
  await expect(waitForCreativeAgentMedia({ ...input(), signal: abort.signal }, { generationIds: [row.id], onCommitted: async () => {}, onProgress: async () => { abort.abort(); } }, deps)).rejects.toThrow();
  expect(records.size).toBe(1); expect(deps.createImage).toHaveBeenCalledTimes(1); expect(deps.attach).not.toHaveBeenCalled();
 });
});
describe("durable media approval evidence", () => {
 it("accepts only same actor/canvas/action and the exact approved proposal", () => {
  const binding = { kind: "image.generate", argsHash: "hash", units: 1 };
  const evidence = { decision: { id: "decision", runId: "run", actionId: "action", proposalHash: "proposal", state: "answered", answer: "approve", binding }, run: { id: "run", actorUserId: 1, canvasId: 57, epoch: 1, status: "running", leaseExpiresAt: new Date(Date.now() + 10000) }, action: { id: "action", runId: "run", actorUserId: 1, canvasId: 57, epoch: 1, kind: "image.generate", state: "claimed" } };
  expect(() => assertCreativeAgentMediaApproval(input(), binding, evidence)).not.toThrow();
  expect(() => assertCreativeAgentMediaApproval({ ...input(), actorUserId: 2 }, binding, evidence)).toThrow();
  expect(() => assertCreativeAgentMediaApproval(input(), { ...binding, units: 2 }, evidence)).toThrow();
  expect(() => assertCreativeAgentMediaApproval(input(), binding, { ...evidence, decision: { ...evidence.decision, answer: "cancel" } })).toThrow();
  expect(() => assertCreativeAgentMediaApproval(input(), binding, { ...evidence, run: { ...evidence.run, epoch: 2 } })).toThrow();
  expect(() => assertCreativeAgentMediaApproval(input(), binding, { ...evidence, action: { ...evidence.action, state: "unknown" } })).toThrow();
 });
});

it.each(["image", "video"] as const)("binds fixed %s preferences through actual broker approval and mock dispatch exactly once", async mediaType => {
 const { createCreativeTools } = await import("@/lib/creative-agent/tools");
 const { hash, HttpError } = await import("@/lib/creative-agent/store-types");
 const decisions = new Map<string, any>(), actions = new Map<string, any>();
 const store = {
  assertFence: vi.fn(async () => undefined), appendEvent: vi.fn(async () => undefined), defer: vi.fn(async () => true),
  getModelChoice: vi.fn(),
  getAction: vi.fn(async (id: string) => { if (!actions.has(id)) throw new HttpError(404, "action_not_found", "missing"); return actions.get(id); }),
  ask: vi.fn(async (_run: unknown, id: string, prompt: any) => {
   const prior = decisions.get(id);
   if (prior) { expect(prior.proposalHash).toBe(hash(prompt)); return prior; }
   const decision = { ...prompt, id, proposalHash: hash(prompt), state: "pending", answer: null }; decisions.set(id, decision); return decision;
  }),
  claimAction: vi.fn(async (args: any) => { const receipt = { ...args, id: args.actionId, state: "claimed", claimed: true }; actions.set(args.actionId, receipt); return receipt; }),
  completeAction: vi.fn(async (id: string, result: any) => { actions.set(id, { ...actions.get(id), ...result }); }),
 };
 const preference = mediaType === "image"
  ? { mode: "explicit", model: "test-image", params: { resolution: "2K", aspectRatio: "1:1", quality: "medium" } }
  : { mode: "auto", params: { resolution: "720p", duration: 5, generateAudio: false, ratio: "16:9" } };
 const run = { id: "run", actorUserId: 1, canvasId: 57, epoch: 1, input: { preferences: { [mediaType]: preference } } } as any;
 const execute = vi.fn((request: any) => executeCreativeAgentMediaTool(request, deps));
 const tool = createCreativeTools(run, store as any, execute, request => prepareCreativeAgentMedia(request, deps)).find(tool => tool.name === `${mediaType}_generate`)!;
 const args = mediaType === "image"
  ? { model: "test-image", prompt: "肖像", references: [reference], params: { count: 1, resolution: "8K", aspectRatio: "9:16", quality: "bad" } }
  : { model: "test-video", prompt: "肖像", references: [reference], params: { inputMode: "first_frame", resolution: "8K", duration: 100, generateAudio: true, ratio: "1:1" } };
 await expect(tool.execute("first", args)).rejects.toMatchObject({ code: "run_deferred" });
 expect(deps.createImage).not.toHaveBeenCalled(); expect(deps.createVideo).not.toHaveBeenCalled();
 expect(decisions.size).toBe(1); const approval = [...decisions.values()][0];
 expect(approval.fields).toBeUndefined(); expect(approval.media.params).toMatchObject(preference.params);
 // Later UI/preferences mutations cannot change this tool's captured run snapshot.
 preference.params.resolution = "8K";
 approval.state = "answered"; approval.answer = "approve";
 await tool.execute("approved", args); await tool.execute("replayed", args);
 expect(store.getModelChoice).not.toHaveBeenCalled(); expect(execute).toHaveBeenCalledOnce();
 expect(deps.claimApproval).toHaveBeenCalledWith(expect.objectContaining({ mediaApproval: { decisionId: approval.id, proposalHash: approval.proposalHash } }), approval.binding, expect.any(Array));
 const dispatch = mediaType === "image" ? deps.createImage : deps.createVideo;
 const { count: _count, ...expectedParams } = approval.media.params;
 expect(dispatch).toHaveBeenCalledOnce(); expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ model: mediaType === "image" ? "test-image" : "test-video", ...expectedParams }));
});

it('v2 matches internally, probes each reference once and binds actual selection to dispatch', async () => {
 const { getImageModelParams } = await import('@/lib/generation/image-model-params');
 const catalog = { image: ['nano-banana-pro', 'gpt-image-2-apimart'].map(id => ({ id, label: id, params: getImageModelParams(id), aliases: [id], qualification: { available: true, reasons: [], entitlement: 'unverified' as const, providerId: id === 'nano-banana-pro' ? 'kie' : 'apimart', adapterId: id, routeConfigFingerprint: 'config' } })), video: [] };
 vi.mocked(deps.catalog).mockResolvedValue(catalog);
 const bindReference = vi.fn(async (_input: any, _node: any, reference: any) => ({ ...reference, facts: { state: 'verified', kind: 'image', contentVersion: 'b'.repeat(64), width: 1024, height: 1024, sizeBytes: 1000, detectedMime: 'image/png' } }));
 const v2deps = { ...deps, bindReference };
 const request: any = { ...input({ model: 'assistant-invention', prompt: 'character', references: [reference], params: { count: 1, resolution: '2K', aspectRatio: '1:1' } }), matching: { policyVersion: 2, preferences: { image: { mode: 'auto' } } } };
 const prompt = await prepareCreativeAgentMedia(request, v2deps);
 expect(prompt.fields).toBeUndefined();
 expect(prompt.media?.model.id).toBe('gpt-image-2-apimart');
 expect((prompt.media as any)?.selectionReceipt.request.model).toBe('gpt-image-2-apimart');
 expect(bindReference).toHaveBeenCalledOnce();
 request.args = (prompt.media as any).selectionReceipt.request;
 request.matching.receipt = (prompt.media as any).selectionReceipt;
 await executeCreativeAgentMediaTool(request, v2deps);
 expect(deps.createImage).toHaveBeenCalledWith(expect.objectContaining({ model: prompt.media!.model.id, resolution: prompt.media!.params.resolution, n: 1 }));
});

it('v2 refuses stale qualification and receipt parameter drift before dispatch', async () => {
 const { getImageModelParams } = await import('@/lib/generation/image-model-params');
 const model = { id: 'nano-banana-pro', label: 'nano', params: getImageModelParams('nano-banana-pro'), qualification: { available: true, reasons: [] as string[], entitlement: 'unverified' as const, providerId: 'kie', adapterId: 'nano-banana-pro', routeConfigFingerprint: 'one' } };
 vi.mocked(deps.catalog).mockResolvedValue({ image: [model], video: [] });
 const request: any = { ...input({ prompt: 'character', references: [], params: { count: 1 } }), matching: { policyVersion: 2, preferences: { image: { mode: 'auto' } } } };
 const prompt = await prepareCreativeAgentMedia(request, deps);
 request.args = (prompt.media as any).selectionReceipt.request; request.matching.receipt = (prompt.media as any).selectionReceipt;
 model.qualification.routeConfigFingerprint = 'two';
 await expect(executeCreativeAgentMediaTool(request, deps)).rejects.toMatchObject({ code: 'SELECTION_RECEIPT_STALE' });
 expect(deps.createImage).not.toHaveBeenCalled();
});

it.each(['hidden', 'removed-param', 'drift'] as const)('v2 blocks %s changes between approval and dispatch', async change => {
 const model = { id: 'nano-banana-pro', label: 'nano', params: getImageModelParams('nano-banana-pro'), qualification: { available: true, reasons: [] as string[], entitlement: 'unverified' as const, providerId: 'kie', adapterId: 'nano-banana-pro', routeConfigFingerprint: 'one' } };
 vi.mocked(deps.catalog).mockResolvedValue({ image: [model], video: [] });
 const request: any = { ...input({ prompt: 'x', params: { resolution: '2K' }, references: [] }), matching: { policyVersion: 2 } };
 const prompt = await prepareCreativeAgentMedia(request, deps);
 request.args = (prompt.media as any).selectionReceipt.request; request.matching.receipt = (prompt.media as any).selectionReceipt;
 if (change === 'hidden') vi.mocked(deps.catalog).mockResolvedValue({ image: [], video: [] });
 if (change === 'removed-param') model.params.resolutions = model.params.resolutions.filter(p => p.value !== '2K');
 if (change === 'drift') request.args = { ...request.args, prompt: 'different' };
 await expect(executeCreativeAgentMediaTool(request, deps)).rejects.toBeDefined();
 expect(deps.createImage).not.toHaveBeenCalled(); expect(deps.claimApproval).not.toHaveBeenCalled();
});
it('v2 dispatch requires a server receipt even if a generic approval was supplied', async () => {
 const request: any = { ...input({ prompt: 'x', references: [] }), matching: { policyVersion: 2 } };
 await expect(executeCreativeAgentMediaTool(request, deps)).rejects.toMatchObject({ code: 'SELECTION_RECEIPT_REQUIRED' });
 expect(deps.createImage).not.toHaveBeenCalled();
});

it('uses only server comparative evidence and preserves the selection policy through receipt replay', async () => {
 const catalog = { image: ['nano-banana-pro', 'gpt-image-2-apimart'].map(id => ({ id, label: id, params: getImageModelParams(id), qualification: { available: true, reasons: [], entitlement: 'unverified' as const, providerId: id === 'nano-banana-pro' ? 'kie' : 'apimart', adapterId: id, routeConfigFingerprint: 'config' } })), video: [] };
 vi.mocked(deps.catalog).mockResolvedValue(catalog);
 const evidence = vi.fn(async () => catalog.image.map(m => ({ version: 1, id: m.id, modelId: m.id, providerId: m.qualification.providerId, task: 'product', metric: 'quality', value: m.id === 'nano-banana-pro' ? 0.9 : 0.5, higherIsBetter: true, sampleCount: 10, measuredAt: '2020-01-01', expiresAt: '2099-01-01', source: 'verified local comparison', cohort: 'same', params: {}, referenceKinds: [] })));
 const request: any = { ...input({ prompt: 'x', references: [] }), matching: { policyVersion: 2, task: 'product', priorities: ['quality'] } };
 const v2deps: any = { ...deps, evidence };
 const prompt = await prepareCreativeAgentMedia(request, v2deps); const receipt = (prompt.media as any).selectionReceipt;
 expect(receipt.request.model).toBe('nano-banana-pro');
 request.args = receipt.request; request.matching = { policyVersion: 2, receipt };
 await executeCreativeAgentMediaTool(request, v2deps);
 expect(deps.createImage).toHaveBeenCalledWith(expect.objectContaining({ model: 'nano-banana-pro' }));
 expect(evidence).toHaveBeenCalledTimes(3);
});

it('rechecks the current visible catalog after the dispatch fence and before the provider call', async () => {
 const model = { id: 'nano-banana-pro', label: 'nano', params: getImageModelParams('nano-banana-pro'), qualification: { available: true, reasons: [] as string[], entitlement: 'unverified' as const, providerId: 'kie', adapterId: 'nano-banana-pro', routeConfigFingerprint: 'one' } };
 vi.mocked(deps.catalog).mockResolvedValue({ image: [model], video: [] });
 const request: any = { ...input({ prompt: 'x', references: [] }), matching: { policyVersion: 2 } };
 const prompt = await prepareCreativeAgentMedia(request, deps); const receipt = (prompt.media as any).selectionReceipt;
 request.args = receipt.request; request.matching.receipt = receipt;
 deps.beforeDispatch = async () => { vi.mocked(deps.catalog).mockResolvedValue({ image: [], video: [] }); };
 await expect(executeCreativeAgentMediaTool(request, deps)).rejects.toMatchObject({ code: 'MEDIA_MODEL_UNAVAILABLE' });
 expect(deps.createImage).not.toHaveBeenCalled();
});
it('v2 never accepts legacy binding fallback, omitted limits or an expired receipt', async () => {
 const execution: any={planId:'p',stepId:'s',receiptId:'r',requestHash:'h',expiresAt:'2099-01-01T00:00:00.000Z',limits:{finalOutputs:1,intermediateOutputs:0,initialCalls:1,retryCalls:0}};
 const request:any={...input(),matching:{policyVersion:2,execution}};
 const binding:any={kind:request.kind,argsHash:'h',units:1,retryLimit:0,version:2,...execution};
 const evidence:any={decision:{id:'decision',runId:'run',actionId:'action',proposalHash:'proposal',state:'answered',answer:'approve',binding},run:{id:'run',actorUserId:1,canvasId:57,epoch:1,status:'running',leaseExpiresAt:new Date(Date.now()+60000),input:{matchingPolicyVersion:2}},action:{id:'action',runId:'run',actorUserId:1,canvasId:57,epoch:1,kind:'image.generate',state:'claimed'}};
 expect(()=>assertCreativeAgentMediaApproval(request,binding,evidence)).not.toThrow();
 for(const field of ['retryLimit','planId','stepId','receiptId','limits','requestHash','expiresAt']) {
  const stripped={...binding};delete stripped[field];
  expect(()=>assertCreativeAgentMediaApproval(request,stripped,{...evidence,decision:{...evidence.decision,binding:stripped}})).toThrow();
 }
 const expired={...binding,expiresAt:'2000-01-01T00:00:00.000Z'};
 expect(()=>assertCreativeAgentMediaApproval(request,expired,{...evidence,decision:{...evidence.decision,binding:expired}})).toThrow();
 const legacy={kind:request.kind,argsHash:'h',units:1,retryLimit:1};
 expect(()=>assertCreativeAgentMediaApproval({...request,matching:undefined},legacy,{...evidence,decision:{...evidence.decision,binding:legacy}})).toThrow();
});
it('marks dispatch immediately before provider and releases only known unused requests', async () => {
 const order:string[]=[];
 deps.markDispatchStarted=vi.fn(async()=>{order.push('started');});
 deps.releaseUnused=vi.fn(async()=>{order.push('released');});
 deps.startTask=vi.fn(async()=>{throw new Error('canvas write failed before provider');});
 await expect(executeCreativeAgentMediaTool(input(),deps)).rejects.toMatchObject({code:'MEDIA_NOT_DISPATCHED'});
 expect(order).toEqual(['released']);expect(deps.createImage).not.toHaveBeenCalled();
 deps.startTask=vi.fn(async()=>{order.push('task');});
 vi.mocked(deps.createImage).mockImplementation(async()=>{order.push('provider');throw new Error('lost response');});
 await expect(executeCreativeAgentMediaTool(input(),deps)).rejects.toMatchObject({code:'MEDIA_DISPATCH_UNKNOWN'});
 expect(order).toEqual(['released','task','started','provider']);
 expect(deps.releaseUnused).toHaveBeenCalledTimes(1);
});

it.each([['flare','fast','当前普通模式'],['sunburst','pro','当前高级模式']])('identifies the executed visible GPT2.5 variant in persisted confirmation: %s',async(mode,suffix,label)=>{
 const model='gpt-image-2.5-reapi';
 vi.mocked(deps.catalog).mockResolvedValue({image:[{id:model,label:'Base image',params:getImageModelParams(model),variants:[{mode:'flare',selectionId:model+':fast',label:'当前普通模式'},{mode:'sunburst',selectionId:model+':pro',label:'当前高级模式'}],qualification:{available:true,reasons:[],entitlement:'unverified',providerId:'reapi',adapterId:model,routeConfigFingerprint:'fixture'}}],video:[]});
 const proposal=await prepareCreativeAgentMedia({...input({prompt:'海报',references:[]}),matching:{policyVersion:2,preferences:{image:{mode:'explicit',model:model+':'+suffix}}}} as any,deps);
 expect(proposal.media?.selectionReceipt?.request.params.gptImage25Mode).toBe(mode);
 expect(proposal.media?.model.label).toBe(label);expect(proposal.question).toContain(label);
 expect(JSON.parse(JSON.stringify(proposal)).media.model.label).toBe(label);
});
