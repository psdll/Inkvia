import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ direct: false, visible: true, transition: vi.fn(), observe: vi.fn(), gptModes: ["flare", "sunburst"] as string[], action: null as any, retryActions: new Map<string, any>(), decision: null as any, rows: new Map<string, any>(), nodes: [] as any[], edges: [] as any[], mutations: new Map<string, any>(), submit: vi.fn(), create: vi.fn(), createVideo: vi.fn(), fence: vi.fn(), delivery: vi.fn(), finalize: vi.fn(), recover: vi.fn(), raw: vi.fn(), txTail: Promise.resolve() as Promise<any> }));
vi.mock("@/lib/prisma", () => {
 const prisma: any = { $queryRaw: db.raw,
  creativeAgentAction: { findUnique: async ({ where }: any) => where.id === db.action.id ? db.action : db.retryActions.get(where.id) ?? null, create: async ({ data }: any) => { db.retryActions.set(data.id, data); return data; }, update: async ({ where, data }: any) => Object.assign(where.id === db.action.id ? db.action : db.retryActions.get(where.id), data) },
  creativeAgentRun: {findUnique: async()=>db.decision?.run, update: async ({data}:any) => Object.assign(db.decision.run,data)},
  creativeAgentDecision: { findUnique: async () => db.direct ? null : db.decision, findMany:async()=>db.direct?[]:db.decision?[db.decision]:[] },
  generation: { findUnique: async ({ where }: any) => where.requestKey ? db.rows.get(where.requestKey) ?? null : [...db.rows.values()].find(row => row.id === where.id) ?? null },
  canvasMutation: { findFirst: async ({ where }: any) => db.mutations.get(where.clientMutationId) ?? null },
 };
 prisma.$transaction = (callback: any) => { const result = db.txTail.then(() => callback(prisma)); db.txTail = result.catch(() => undefined); return result; };
 return { default: prisma, prisma };
});
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentCanvas: vi.fn(), requireCreativeAgentEnabled: vi.fn() }));
vi.mock("@/lib/creative-agent/store", () => ({ creativeAgentStore: { assertFence: db.fence, transitionGenerationStep: db.transition, observeGenerationOutput: db.observe, completeAction: async (id: string, data: any) => Object.assign(db.retryActions.get(id), data), assertMediaDelivery: db.delivery, appendEvent: vi.fn() } }));
vi.mock("@/lib/creative-agent/canvas-tools", () => ({ readCreativeAgentCanvas: async () => ({ revision: "1", nodes: db.nodes, edgeIds: [] }) }));
vi.mock("@/lib/generation/image-service", () => ({ createImageGeneration: db.create }));
vi.mock("@/lib/generation/video-service", () => ({ createVideoGeneration: db.createVideo }));
vi.mock("@/lib/generation/finalize", () => ({ finalizeGeneration: db.finalize, recoverStaleProcessingGeneration: db.recover }));
vi.mock("@/lib/image-edit-models", () => ({ IMAGE_EDIT_MODEL_DEFINITIONS: [], getVisibleImageEditModels: async () => !db.visible ? [] : [{ id: "nano-banana-pro", label: "测试模型" }, { id: "gpt-image-2.5-reapi", label: "GPT2.5", gptImage25Variants: db.gptModes.map(mode => ({ mode, label: mode })) }], getVisibleToolboxModels: async () => [{ id: "doubao-seedance-2-0-fast-260128", label: "Video" }] }));
vi.mock("@/lib/providers/registry", () => ({ getRegisteredProviders: async () => [{ id: "reapi", apiKey: "configured", enabled: true, egressMode: "direct" }, { id: "kie", apiKey: "configured", enabled: true, egressMode: "direct" }, { id: "volcengine", apiKey: "configured", enabled: true, egressMode: "direct" }] }));
vi.mock("@/lib/providers/model-availability", () => ({ isProviderModelEnabled: () => true }));
vi.mock("@/lib/canvas/generation-media", () => ({ getOrCreateGenerationMediaAsset: async (_client: any, row: any) => ({ mediaId: "ffffffff-ffff-4fff-8fff-ffffffffffff", url: row.localPath }) }));
vi.mock("@/lib/creative-agent/media-output", () => ({ readCreativeAgentMediaSize: async (url: string) => ({ size: { width: 350, height: 467 }, original: { url, width: 1728, height: 2304 } }) }));
vi.mock("@/lib/canvas/mutation-service", () => ({ submitCanvasMutation: db.submit }));
vi.mock("@/lib/canvas/prisma-mutation-store", () => ({ createPrismaCanvasMutationStore: () => ({}) }));
import { prepareCreativeAgentMedia, executeCreativeAgentMediaTool, executeCreativeAgentMediaRetry, readCreativeAgentMediaDelivery } from "@/lib/creative-agent/media-broker";
import { resumeCompletedCreativeAgentTurn } from "@/lib/creative-agent/runner";
import { hashCanvasMutationPayload } from "@/lib/canvas/mutation-contract";
import { applyCanvasOperations } from "@/lib/canvas/operations";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";
import { collectCanvasTaskAssets } from "@/lib/canvas/task-references";
import type { CreativeAgentToolInput } from "@/lib/creative-agent/canvas-tools";
const input = (): CreativeAgentToolInput => ({ actorUserId: 1, canvasId: 57, runId: "run", actionId: "action", epoch: 1, kind: "image.generate", args: { model: "nano-banana-pro", prompt: "肖像", params: { count: 1 } }, mediaApproval: { decisionId: "decision", proposalHash: "proposal" } });
beforeEach(() => {
 db.direct=false; db.visible = true; db.gptModes = ["flare", "sunburst"]; db.rows.clear(); db.retryActions.clear(); db.nodes = []; db.edges = []; db.mutations.clear(); db.txTail = Promise.resolve(); db.raw.mockReset().mockResolvedValue([]);
 db.fence.mockReset().mockResolvedValue({ actorUserId: 1, canvasId: 57 });
 db.finalize.mockReset().mockResolvedValue("skipped"); db.recover.mockReset().mockResolvedValue(0);
 db.action = { id: "action", runId: "run", actorUserId: 1, canvasId: 57, epoch: 1, kind: "image.generate", state: "claimed", inputHash: hashCanvasMutationPayload(input().args), result: null };
 db.decision = null; db.delivery.mockReset().mockResolvedValue(undefined);
 db.createVideo.mockReset().mockImplementation(async (request: any) => { db.rows.set(request.requestKey, { id: 20, authUserId: 1, canvasId: 57, source: "agent", type: "video_gen", model: request.model, prompt: request.prompt, requestKey: request.requestKey, status: "running", localPath: null, templateData: JSON.stringify(request) }); return { generationId: 20, status: "running" }; });
 db.create.mockReset().mockImplementation(async (request: any) => { const row = { id: 10, authUserId: 1, canvasId: 57, source: "agent", type: "image_edit", model: request.model, requestKey: request.requestKey, status: "running", localPath: null, templateData: JSON.stringify({ skill: request.skill }) }; db.rows.set(request.requestKey, row); return { generationId: 10, taskId: "task", status: "running" }; });
 db.submit.mockReset().mockImplementation(async ({ input }: any) => { const doc = applyCanvasOperations({ ...createEmptyCanvasDocumentV2(), nodes: db.nodes, edges: db.edges }, input.operations); db.nodes = doc.nodes; db.edges = doc.edges; const revision = String(db.mutations.size + 2); const receipt = { revision: BigInt(revision), operations: input.operations }; db.mutations.set(input.clientMutationId, receipt); return { revision }; });
});
async function approve(request = input()) {
 db.action.kind = request.kind; db.action.inputHash = hashCanvasMutationPayload(request.args);
 const proposal = await prepareCreativeAgentMedia(request);
 db.decision = { id: "decision", runId: "run", actionId: "action", proposalHash: "proposal", state: "answered", answer: "approve", binding: proposal.binding,
  run: { id: "run", actorUserId: 1, canvasId: 57, epoch: 1, status: "running", leaseExpiresAt: new Date(Date.now() + 10000) } };
}
describe("media broker durable boundaries", () => {
 it("creates the native running task before the provider responds and updates that same node", async () => {
  await approve();
  db.create.mockImplementationOnce(async (request: any) => {
   expect(db.nodes).toHaveLength(1);
   expect(db.nodes[0]).toMatchObject({ type: "imageTask", data: { task: { settings: { model: request.model, prompt: request.prompt }, batches: [{ outputs: [{ status: "running", requestKey: request.requestKey }] }] } } });
   expect(db.nodes[0].data.task.batches[0].outputs[0].generationId).toBeUndefined();
   db.rows.set(request.requestKey, { id: 10, authUserId: 1, canvasId: 57, source: "agent", type: "image_edit", model: request.model, requestKey: request.requestKey, status: "running", localPath: null, prompt: request.prompt, templateData: JSON.stringify({ ...request, skill: request.skill }) });
   return { generationId: 10, status: "running" };
  });
  await executeCreativeAgentMediaTool(input());
  const nodeId = db.nodes[0].id;
  db.nodes[0].position = { x: 100, y: 200 };
  const row = [...db.rows.values()][0]; row.status = "success"; row.localPath = "/uploads/completed.png";
  await executeCreativeAgentMediaTool({ ...input(), kind: "generation.read", args: { generationId: 10 } });
  expect(db.nodes).toHaveLength(1);
  expect(db.nodes[0]).toMatchObject({ id: nodeId, position: { x: 100, y: 200 }, data: { task: { batches: [{ outputs: [{ generationId: 10, status: "success", url: "/uploads/completed.png" }] }] } } });
  expect(db.create).toHaveBeenCalledTimes(1);
 });
 it("connects only the exact approved source and pins its selected non-primary output", async () => {
  const settings = { model: "nano-banana-pro", prompt: "source", aspectRatio: "1:1", resolution: "2K", quality: "auto", count: 2 };
  const source = { id: "source", type: "imageTask", position: { x: 0, y: 0 }, data: { kind: "imageTask", task: { settings, references: [], batches: [{ id: "batch", createdAt: 1, settings, primaryOutputId: "primary", outputs: [{ id: "primary", status: "success", url: "/uploads/primary.png" }, { id: "chosen", status: "success", url: "/uploads/chosen.png" }] }] } } };
  db.nodes = [source, { id: "unrelated", type: "image", position: { x: 0, y: 500 }, data: { kind: "image", url: "/uploads/unrelated.png" } }];
  const request = input(); (request.args as Record<string, unknown>).references = [{ nodeId: "source", semanticHash: hashCanvasMutationPayload({ id: source.id, data: source.data }), batchId: "batch", outputId: "chosen" }];
  await approve(request); await executeCreativeAgentMediaTool(request);
  const target = db.nodes.at(-1);
  expect(db.edges).toHaveLength(1); expect(db.edges[0]).toMatchObject({ source: "source", target: target.id });
  expect(db.create.mock.calls[0][0].imagePaths).toEqual(["/uploads/chosen.png"]);
  expect(collectCanvasTaskAssets({ nodes: db.nodes, edges: db.edges }, target.id).map(asset => asset.url)).toEqual(["/uploads/chosen.png"]);
 });
 it("settles a failed task in place with its actual error", async () => {
  await approve(); await executeCreativeAgentMediaTool(input());
  const nodeId = db.nodes[0].id, row = [...db.rows.values()][0]; row.status = "failed"; row.errorMsg = "服务超时";
  await executeCreativeAgentMediaTool({ ...input(), kind: "generation.read", args: { generationId: 10 } });
  expect(db.nodes).toHaveLength(1);
  expect(db.nodes[0]).toMatchObject({ id: nodeId, data: { task: { batches: [{ outputs: [{ status: "failed", error: "服务超时" }] }] } } });
 });
 it("preserves edited settings and does not resurrect a deleted pending task", async () => {
  await approve(); await executeCreativeAgentMediaTool(input());
  db.nodes[0].data.task.settings.prompt = "user changed prompt";
  const row = [...db.rows.values()][0]; row.status = "success"; row.localPath = "/uploads/done.png";
  await executeCreativeAgentMediaTool({ ...input(), kind: "generation.read", args: { generationId: 10 } });
  expect(db.nodes[0].data.task.settings.prompt).toBe("user changed prompt");
  db.nodes = []; db.submit.mockClear();
  await executeCreativeAgentMediaTool({ ...input(), kind: "generation.read", args: { generationId: 10 } });
  expect(db.nodes).toEqual([]); expect(db.submit).not.toHaveBeenCalled();
 });
 it("creates a connected video task before submission and settles into the same node", async () => {
  const source = { id: "source", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/uploads/source.png" } }; db.nodes = [source];
  const request = { ...input(), kind: "video.generate", args: { model: "doubao-seedance-2-0-fast-260128", prompt: "缓慢推进", params: { inputMode: "first_frame", duration: 5, resolution: "720p", ratio: "16:9" }, references: [{ nodeId: source.id, semanticHash: hashCanvasMutationPayload({ id: source.id, data: source.data }) }] } };
  await approve(request); await executeCreativeAgentMediaTool(request);
  const task = db.nodes[1];
  expect(task).toMatchObject({ type: "videoTask", data: { status: "running", prompt: "缓慢推进", mediaPaths: ["/uploads/source.png"], duration: 5, resolution: "720p" } });
  expect(task.data.generationId).toBeUndefined();
  expect(db.edges[0]).toMatchObject({ source: source.id, target: task.id });
  const row = [...db.rows.values()][0]; row.status = "success"; row.localPath = "/uploads/video.mp4";
  await executeCreativeAgentMediaTool({ ...request, kind: "generation.read", args: { generationId: 20 } });
  expect(db.nodes).toHaveLength(2);
  expect(db.nodes[1]).toMatchObject({ id: task.id, data: { status: "success", generationId: 20, outputUrl: "/uploads/video.mp4" } });
  expect(db.createVideo).toHaveBeenCalledTimes(1);
 });
 it("retries a canvas revision race before submitting exactly once", async () => {
  await approve();
  db.submit.mockRejectedValueOnce(Object.assign(new Error("changed"), { code: "CANVAS_REVISION_CONFLICT" }));
  await executeCreativeAgentMediaTool(input());
  expect(db.nodes).toHaveLength(1); expect(db.create).toHaveBeenCalledTimes(1);
 });
 it("locks and consumes one approved dispatch permit before calling the shared service", async () => {
  await approve();
  db.create.mockImplementationOnce(async (request: any) => { expect(db.action.result).toMatchObject({ mediaDispatch: { decisionId: "decision", units: 1, argsHash: db.decision.binding.argsHash } }); const row = { id: 10, authUserId: 1, canvasId: 57, source: "agent", type: "image_edit", model: request.model, requestKey: request.requestKey, status: "running", localPath: null, templateData: JSON.stringify({ skill: request.skill }) }; db.rows.set(request.requestKey, row); return { generationId: 10, taskId: "task", status: "running" }; });
  await executeCreativeAgentMediaTool(input());
  await executeCreativeAgentMediaTool(input());
  expect(db.raw).toHaveBeenCalled(); expect(db.create).toHaveBeenCalledTimes(1);
 });
 it("does not dispatch twice when the first provider receipt is still pending", async () => {
  await approve();
  let release!: () => void;
  db.create.mockImplementationOnce(async (request: any) => {
   await new Promise<void>(resolve => { release = resolve; });
   db.rows.set(request.requestKey, { id: 10, authUserId: 1, canvasId: 57, source: "agent", type: "image_edit", model: request.model, requestKey: request.requestKey, status: "running", localPath: null, templateData: JSON.stringify({ skill: request.skill }) });
   return { generationId: 10, taskId: "task", status: "running" };
  });
  const first = executeCreativeAgentMediaTool(input());
  await vi.waitFor(() => expect(db.create).toHaveBeenCalledTimes(1));
  await expect(executeCreativeAgentMediaTool(input())).rejects.toMatchObject({ code: "MEDIA_DISPATCH_UNKNOWN" });
  release(); await first;
  expect(db.create).toHaveBeenCalledTimes(1);
 });
 it("rejects forged approval and changed exact args before any dispatch", async () => {
  await approve(); db.decision.answer = "cancel";
  await expect(executeCreativeAgentMediaTool(input())).rejects.toMatchObject({ code: "MEDIA_APPROVAL_REQUIRED" });
  expect(db.action.result).toBeNull(); expect(db.create).not.toHaveBeenCalled();
  db.decision.answer = "approve"; db.action.inputHash = "changed";
  await expect(executeCreativeAgentMediaTool(input())).rejects.toMatchObject({ code: "MEDIA_APPROVAL_REQUIRED" });
  expect(db.create).not.toHaveBeenCalled();
 });
 it("persists stable MediaAsset-backed output nodes once and respects later deletion", async () => {
  await approve(); await executeCreativeAgentMediaTool(input());
  // A legacy generation has no running-task mutation or placeholder.
  db.nodes = []; db.mutations.clear(); db.submit.mockClear();
  const row = [...db.rows.values()][0]; row.status = "success"; row.localPath = "/uploads/final.png";
  row.prompt = "保留产品原貌，真实客厅";
  row.templateData = JSON.stringify({ ...JSON.parse(row.templateData), model: "nano-banana-pro", aspectRatio: "3:4", resolution: "2K", quality: "high", background: "opaque", imagePaths: ["/uploads/reference.png"] });
  const read = { ...input(), kind: "generation.read", args: { generationId: 10 } };
  const first = await executeCreativeAgentMediaTool(read);
  expect(db.nodes[0]).toMatchObject({ width: 350, height: 467, type: "imageTask", data: { kind: "imageTask", task: {
   settings: { model: "nano-banana-pro", prompt: row.prompt, aspectRatio: "3:4", resolution: "2K", quality: "high", background: "opaque", count: 1 },
   references: [{ url: "/uploads/reference.png" }],
   batches: [{ settings: { model: "nano-banana-pro", prompt: row.prompt, aspectRatio: "3:4" }, outputs: [{ generationId: 10, status: "success", url: "/uploads/final.png", width: 1728, height: 2304, mediaId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }] }],
  } } });
  const nodeId = db.nodes[0].id; db.nodes = [];
  const second = await executeCreativeAgentMediaTool(read);
  expect(first.nodeIds).toEqual([nodeId]); expect(second.nodeIds).toEqual([nodeId]);
  expect(db.nodes).toEqual([]); expect(db.submit).toHaveBeenCalledTimes(1); expect(db.create).toHaveBeenCalledTimes(1);
 });
 it("reuses stale processing recovery before querying the shared finalizer", async () => {
  await approve(); await executeCreativeAgentMediaTool(input()); const row = [...db.rows.values()][0]; row.status = "processing";
  db.recover.mockImplementationOnce(async () => { row.status = "running"; return 1; });
  db.finalize.mockImplementationOnce(async () => { row.status = "success"; row.localPath = "/uploads/recovered.png"; return "done"; });
  const result = await executeCreativeAgentMediaTool({ ...input(), kind: "generation.read", args: { generationId: row.id } });
  expect(db.recover).toHaveBeenCalledWith(row.id); expect(result.status).toBe("success");
  expect(db.create).toHaveBeenCalledTimes(1);
 });
 it("delivers an owned existing output after chat failure without requiring a live epoch or dispatching again", async () => {
  await approve(); await executeCreativeAgentMediaTool(input());
  const row = [...db.rows.values()][0]; row.status = "success"; row.localPath = "/uploads/final.png";
  db.fence.mockRejectedValue(new Error("stale epoch")); db.create.mockClear();
  const run = { id: "run", actorUserId: 1, canvasId: 57, epoch: 2, status: "failed" } as import("@/lib/creative-agent/store-types").Run;
  const first = await readCreativeAgentMediaDelivery(run, 10);
  const second = await readCreativeAgentMediaDelivery(run, 10);
  expect(first.status).toBe("success"); expect(second.nodeIds).toEqual(first.nodeIds);
  expect(db.submit).toHaveBeenCalledTimes(2); expect(db.create).not.toHaveBeenCalled(); expect(db.delivery).toHaveBeenCalled();
  db.delivery.mockRejectedValue(new Error("foreign receipt"));
  await expect(readCreativeAgentMediaDelivery(run, 10)).rejects.toThrow("foreign receipt");
  expect(db.submit).toHaveBeenCalledTimes(2);
 });
 it("leaves durable outputs unattached when the run loses its fence", async () => {
  await approve(); await executeCreativeAgentMediaTool(input());
  const row = [...db.rows.values()][0]; row.status = "success"; row.localPath = "/uploads/final.png";
  db.fence.mockRejectedValue(new Error("stale epoch"));
  await expect(executeCreativeAgentMediaTool({ ...input(), kind: "generation.read", args: { generationId: 10 } })).rejects.toThrow("stale epoch");
  expect(db.submit).toHaveBeenCalledTimes(1); expect(db.nodes[0].data.task.batches[0].outputs[0].status).toBe("running"); expect(row.localPath).toBe("/uploads/final.png");
 });
});

async function failedRetrySource(error = "429 Too Many Requests") {
 await approve();
 const receipt = await executeCreativeAgentMediaTool(input());
 db.action.state = "succeeded"; db.action.result = receipt;
 const failed = [...db.rows.values()][0]; failed.status = "failed"; failed.errorMsg = error;
 await executeCreativeAgentMediaTool({ ...input(), kind: "generation.read", args: { generationId: failed.id } });
 db.create.mockImplementation(async (request: any) => {
  const row = { ...failed, id: 11, requestKey: request.requestKey, status: "running", errorMsg: null, templateData: JSON.stringify(request) };
  db.rows.set(request.requestKey, row); return { generationId: row.id, status: "running" };
 });
 return failed;
}
describe("bounded paid retry", () => {
 it("discloses and binds the maximum retry budget before approval", async () => {
  const proposal = await prepareCreativeAgentMedia(input());
  expect(proposal.binding).toMatchObject({ units: 1, retryLimit: 1 });
  expect(proposal.question).toContain("最多 2 次");
  expect(proposal.question).toContain("失败项");
 });
 it("reserves one retry and keeps the same target node and failure history", async () => {
  const failed = await failedRetrySource(); const nodeId = db.nodes[0].id;
  const retried = await executeCreativeAgentMediaRetry(input(), failed.id);
  expect(retried).toMatchObject({ generationId: 11, retryOfGenerationId: 10, retryAttempt: 1, retryReason: "429 Too Many Requests" });
  expect(db.retryActions.size).toBe(1); expect(db.nodes).toHaveLength(1);
  expect(db.nodes[0].id).toBe(nodeId);
  expect(db.nodes[0].data.task.batches.map((b: any) => b.outputs[0].status)).toEqual(["failed", "running"]);
  const retriedRow = [...db.rows.values()].find(row => row.id === 11)!; retriedRow.status = "success"; retriedRow.localPath = "/uploads/retried.png";
  await executeCreativeAgentMediaTool({ ...input(), kind: "generation.read", args: { generationId: 11 } });
  expect(db.nodes).toHaveLength(1);
  expect(db.nodes[0].data.task.batches.map((b: any) => b.outputs[0].status)).toEqual(["failed", "success"]);
  db.raw.mockImplementation(async (query: any) => query.strings?.join("").includes("SELECT result FROM") ? [...db.retryActions.values()].map(action => ({ result: action.result })) : []);
  const delivered = await readCreativeAgentMediaDelivery({ id: "run", actorUserId: 1, canvasId: 57, epoch: 2, status: "stopped" } as any, 11);
  expect(delivered).toMatchObject({ generationId: 11, retryOfGenerationId: 10, retryAttempt: 1, retryReason: "429 Too Many Requests" });
  await executeCreativeAgentMediaRetry(input(), failed.id);
  expect(db.create).toHaveBeenCalledTimes(2);
 });
 it.each(["余额不足", "403 forbidden", "内容审核未通过", "invalid parameter", "提交结果未知", "远程结果已返回，但下载保存失败"])("does not automatically resubmit %s", async reason => {
  const failed = await failedRetrySource(reason);
  expect(await executeCreativeAgentMediaRetry(input(), failed.id)).toBeNull();
  expect(db.create).toHaveBeenCalledTimes(1); expect(db.retryActions.size).toBe(0);
 });
 it.each(["running", "success", "cancelled", "canceled"])("never retries a %s record", async status => {
  const failed = await failedRetrySource(); failed.status = status;
  expect(await executeCreativeAgentMediaRetry(input(), failed.id)).toBeNull();
  expect(db.create).toHaveBeenCalledTimes(1);
 });
 it("does not enlarge an old approval or an unknown primary action", async () => {
  const failed = await failedRetrySource(); delete db.decision.binding.retryLimit;
  expect(await executeCreativeAgentMediaRetry(input(), failed.id)).toBeNull();
  db.decision.binding.retryLimit = 1; db.action.state = "unknown";
  expect(await executeCreativeAgentMediaRetry(input(), failed.id)).toBeNull();
  expect(db.create).toHaveBeenCalledTimes(1);
 });
 it("never dispatches the reserved key again after an ambiguous response", async () => {
  const failed = await failedRetrySource();
  db.create.mockRejectedValueOnce(new Error("lost response"));
  await expect(executeCreativeAgentMediaRetry(input(), failed.id)).rejects.toMatchObject({ code: "MEDIA_DISPATCH_UNKNOWN" });
  await expect(executeCreativeAgentMediaRetry(input(), failed.id)).rejects.toMatchObject({ code: "MEDIA_DISPATCH_UNKNOWN" });
  expect(db.create).toHaveBeenCalledTimes(2); expect(db.retryActions.size).toBe(1);
 });
 it("does not allow a retry generation to obtain a second retry", async () => {
  const failed = await failedRetrySource(); await executeCreativeAgentMediaRetry(input(), failed.id);
  const second = [...db.rows.values()].find(row => row.id === 11)!; second.status = "failed";
  expect(await executeCreativeAgentMediaRetry(input(), 11)).toBeNull();
  expect(db.create).toHaveBeenCalledTimes(2);
 });
 it("checks the lease again before submitting the retry", async () => {
  const failed = await failedRetrySource(); db.fence.mockRejectedValue(new Error("cancelled"));
  await expect(executeCreativeAgentMediaRetry(input(), failed.id)).rejects.toThrow("cancelled");
  expect(db.create).toHaveBeenCalledTimes(1);
 });
 it("serializes two retry reservations into one paid dispatch", async () => {
  const failed = await failedRetrySource();
  const results = await Promise.allSettled([executeCreativeAgentMediaRetry(input(), failed.id), executeCreativeAgentMediaRetry(input(), failed.id)]);
  expect(results.some(result => result.status === "fulfilled")).toBe(true);
  expect(db.create).toHaveBeenCalledTimes(2); expect(db.retryActions.size).toBe(1);
 });
 it("does not overwrite a video task the user has already restarted", async () => {
  const request = { ...input(), kind: "video.generate", args: { model: "doubao-seedance-2-0-fast-260128", prompt: "缓慢推进", params: { inputMode: "text_to_video", duration: 5, resolution: "720p", ratio: "16:9" } } };
  await approve(request); db.action.result = await executeCreativeAgentMediaTool(request); db.action.state = "succeeded";
  const failed = [...db.rows.values()][0]; failed.status = "failed"; failed.errorMsg = "429 Too Many Requests";
  await executeCreativeAgentMediaTool({ ...request, kind: "generation.read", args: { generationId: 20 } });
  db.nodes[0].data.status = "running"; db.nodes[0].data.requestKey = "manual-restart";
  await expect(executeCreativeAgentMediaRetry(request, 20)).rejects.toMatchObject({ code: "MEDIA_RETRY_TARGET_CHANGED" });
  expect(db.createVideo).toHaveBeenCalledTimes(1); expect(db.nodes[0].data.requestKey).toBe("manual-restart");
 });
 it("retries video on its original node and updates it with the returned result", async () => {
  const request = { ...input(), kind: "video.generate", args: { model: "doubao-seedance-2-0-fast-260128", prompt: "缓慢推进", params: { inputMode: "text_to_video", duration: 5, resolution: "720p", ratio: "16:9" } } };
  await approve(request); db.action.result = await executeCreativeAgentMediaTool(request); db.action.state = "succeeded";
  const failed = [...db.rows.values()][0]; failed.status = "failed"; failed.errorMsg = "429 Too Many Requests";
  await executeCreativeAgentMediaTool({ ...request, kind: "generation.read", args: { generationId: 20 } });
  const nodeId = db.nodes[0].id;
  db.createVideo.mockImplementation(async (request: any) => { db.rows.set(request.requestKey, { ...failed, id: 21, requestKey: request.requestKey, status: "running", templateData: JSON.stringify(request) }); return { generationId: 21, status: "running" }; });
  await executeCreativeAgentMediaRetry(request, 20);
  const retried = [...db.rows.values()].find(row => row.id === 21)!; retried.status = "success"; retried.localPath = "/uploads/retried.mp4";
  await executeCreativeAgentMediaTool({ ...request, kind: "generation.read", args: { generationId: 21 } });
  expect(db.nodes).toHaveLength(1); expect(db.nodes[0]).toMatchObject({ id: nodeId, data: { generationId: 21, status: "success", outputUrl: "/uploads/retried.mp4" } });
  expect(db.createVideo).toHaveBeenCalledTimes(2);
 });

 it.each([
  ["Haiya unknown disconnect", "海牙 GPT-Image-2.5 连接中断，生成结果未知；请先核对海牙调用记录，避免重复提交计费"],
  ["base64 file write after upstream success", "ENOSPC: no space left on device, write '/uploads/generated/image.png'"],
  ["generic timeout", "任务处理超时"],
  ["unclassified failure", "生成失败"],
 ])("never reserves or pays a retry for %s through the resumed runner", async (_case, error) => {
  const failed = await failedRetrySource(error);
  const run = { id: "run", sessionId: "session", actorUserId: 1, canvasId: 57, epoch: 1, input: {}, createdAt: new Date(1).toISOString() } as any;
  const store = { getTranscript: vi.fn(async () => [{ role: "user", content: "generate", timestamp: 1 }, { role: "assistant", content: [], stopReason: "stop" }]), assertFence: db.fence, actionReceipts: vi.fn(async () => [db.action]), waitForActions: vi.fn(), saveAssistant: vi.fn(), defer: vi.fn(), finish: vi.fn(), publishMedia: vi.fn() };
  const receipt = { generationId: failed.id, status: "failed", error, mediaType: "image", outputs: [], nodeIds: [db.nodes[0].id] };
  await expect(resumeCompletedCreativeAgentTurn(run, { store: store as any, awaitMedia: async () => ({ pendingGenerationIds: [], generations: [receipt] }) })).rejects.toMatchObject({ code: "MEDIA_GENERATION_FAILED" });
  expect(db.create).toHaveBeenCalledTimes(1); expect(db.retryActions.size).toBe(0);
  expect(store.saveAssistant).toHaveBeenCalledWith("run", 1, "run:media:completed", expect.stringContaining(error));
 });
 it("resumes a definite rate-limit failure with one retry through the runner", async () => {
  const failed = await failedRetrySource();
  const run = { id: "run", sessionId: "session", actorUserId: 1, canvasId: 57, epoch: 1, input: {}, createdAt: new Date(1).toISOString() } as any;
  const store = { getTranscript: vi.fn(async () => [{ role: "user", content: "generate", timestamp: 1 }, { role: "assistant", content: [], stopReason: "stop" }]), assertFence: db.fence, actionReceipts: vi.fn(async () => [db.action]), waitForActions: vi.fn(), saveAssistant: vi.fn(), defer: vi.fn(), finish: vi.fn(), publishMedia: vi.fn() };
  const receipt = { generationId: failed.id, status: "failed", error: failed.errorMsg, mediaType: "image", outputs: [], nodeIds: [db.nodes[0].id] };
  await expect(resumeCompletedCreativeAgentTurn(run, { store: store as any, awaitMedia: async () => ({ pendingGenerationIds: [], generations: [receipt] }) })).resolves.toBe(true);
  expect(db.create).toHaveBeenCalledTimes(2); expect(db.retryActions.size).toBe(1);
  expect(store.defer).toHaveBeenCalledWith("run", 1, "waiting_action");
 });

});

it('preserves pre-v2 GPT2.5 approval binding and its one retry without materializing a mode', async () => {
 const { getImageModelParams } = await import('@/lib/generation/image-model-params');
 const request = input(); request.args = { model: 'gpt-image-2.5-reapi', prompt: '肖像', params: { count: 1 } };
 const config = getImageModelParams('gpt-image-2.5-reapi');
 const params = { count: 1, aspectRatio: config.defaultAspectRatio, resolution: config.defaultResolution, quality: config.defaultQuality };
 const oldBinding = { kind: request.kind, units: 1, retryLimit: 1, argsHash: hashCanvasMutationPayload({ actorUserId: 1, canvasId: 57, kind: request.kind, model: 'gpt-image-2.5-reapi', prompt: '肖像', params, references: [] }) };
 const proposal = await prepareCreativeAgentMedia(request);
 expect(proposal.binding).toEqual(oldBinding);
 await approve(request); db.decision.binding = oldBinding;
 const result = await executeCreativeAgentMediaTool(request);
 db.action.state = 'succeeded'; db.action.result = result;
 const failed = [...db.rows.values()][0]; failed.status = 'failed'; failed.errorMsg = '429 Too Many Requests';
 await executeCreativeAgentMediaTool({ ...request, kind: 'generation.read', args: { generationId: failed.id } });
 db.create.mockImplementationOnce(async (next: any) => { db.rows.set(next.requestKey, { ...failed, id: 11, requestKey: next.requestKey, status: 'running', templateData: JSON.stringify({ skill: next.skill }) }); return { generationId: 11, status: 'running' }; });
 await expect(executeCreativeAgentMediaRetry(request, failed.id)).resolves.toMatchObject({ generationId: 11 });
 expect(db.create).toHaveBeenCalledTimes(2);
 expect(db.create.mock.calls.every(([call]) => call.gptImage25Mode === undefined)).toBe(true);
});
it('does not silently switch a legacy default flare approval to the only visible sunburst mode', async () => {
 db.gptModes = ['sunburst']; const request = input(); request.args = { model: 'gpt-image-2.5-reapi', prompt: '肖像' };
 await expect(prepareCreativeAgentMedia(request)).rejects.toMatchObject({ code: 'MEDIA_PARAMS_INVALID' });
 expect(db.create).not.toHaveBeenCalled();
});
async function matchingFailedSource(retryCalls:number, beforeDispatch?:()=>void, model?:string, direct=false) {
 const {mergeTurnRequirements}=await import('@/lib/creative-agent/matching-contracts');
 const {generationExecution,transitionGenerationReservation,observeGenerationQuantity}=await import('@/lib/creative-agent/quantity');
 const text=`生成一张图片，允许重试${retryCalls}次`;
 const requirements=retryCalls ? mergeTurnRequirements(undefined,undefined,{facts:[{field:'generation.retryCalls',value:retryCalls,strength:'hard',source:{kind:'message',sourceId:'msg',quote:`允许重试${retryCalls}次`}}]},[{kind:'message',sourceId:'msg',text}]) : undefined;
 const request:any={...input(),args:{prompt:'p',params:{count:1}},matching:{policyVersion:2,requirements,...(model?{preferences:{image:{mode:"explicit",model}}}:{})}};
 let proposal=await prepareCreativeAgentMedia(request);const selected=proposal.media!.selectionReceipt!;
 request.args=selected.request;request.matching.receipt=selected;
 const plan:any={version:1,definition:{steps:[]},requirementsRevision:requirements?.revision??0,steps:[{id:'single',mediaType:'image',role:'final',receipt:selected}]};
 const runInput:any={text,messageId:'msg',...(direct?{mediaAuthorizationVersion:1}:{}),matchingPolicyVersion:2,requirements,generationPlans:{p:{id:'p',plan,expiresAt:'2099-01-01T00:00:00.000Z'}}};
 request.matching.execution=generationExecution(runInput,'p','single');
 proposal=await prepareCreativeAgentMedia(request);await approve(request);db.decision.run.input=runInput;
 if(direct){db.direct=true;delete request.mediaApproval;request.mediaAuthorization=(await import('@/lib/creative-agent/media-authorization')).directMediaAuthorization(db.decision.run,request.kind,proposal.binding!);expect(request.mediaAuthorization).toBeDefined();}
 db.transition.mockImplementation(async(_run:any,key:string,phase:any)=>{db.decision.run.input=transitionGenerationReservation(db.decision.run.input,key,phase);});
 db.observe.mockImplementation(async(_run:any,key:string,observation:any)=>{db.decision.run.input=observeGenerationQuantity(db.decision.run.input,key,observation);return db.decision.run.input.quantityLedger;});
 db.action.inputHash=hashCanvasMutationPayload(request.args);
 beforeDispatch?.();
 const receipt=await executeCreativeAgentMediaTool(request);db.action.state='succeeded';db.action.result=receipt;
 const failed=[...db.rows.values()][0];failed.status='failed';failed.errorMsg='429 Too Many Requests';
 await executeCreativeAgentMediaTool({...request,kind:'generation.read',args:{generationId:failed.id}});
 return {request,failed,proposal};
}
it('v2 default retry zero never creates a child action or a second provider call',async()=>{
 const {request,failed,proposal}=await matchingFailedSource(0);
 expect(proposal.media?.planSummary).toMatchObject({planId:'p',stepId:'single',limits:{finalOutputs:1,intermediateOutputs:0,initialCalls:1,retryCalls:0},output:{calls:1},selectedWhy:expect.any(Array)});
 expect(proposal.binding).toMatchObject({version:2,retryLimit:0});expect(proposal.question).toContain('补试最多 0 次');
 expect(await executeCreativeAgentMediaRetry(request,failed.id)).toBeNull();expect(db.create).toHaveBeenCalledTimes(1);
 expect(db.decision.run.input.quantityLedger.reservations).toHaveLength(1);
});
it('v2 explicit retry consumes the same turn ledger and reuses its one failed-step reservation',async()=>{
 const {request,failed}=await matchingFailedSource(2);
 await executeCreativeAgentMediaRetry(request,failed.id);
 expect(db.create).toHaveBeenCalledTimes(2);
 expect(db.decision.run.input.quantityLedger.reservations).toMatchObject([{phase:'started'},{phase:'started',retryOf:failed.requestKey}]);
 await executeCreativeAgentMediaRetry(request,failed.id);expect(db.create).toHaveBeenCalledTimes(2);
});
it('observes raw output mismatch before attachment and preserves all saved assets after pause',async()=>{
 const {request}=await matchingFailedSource(0);const row=[...db.rows.values()][0];
 const ledger=db.decision.run.input.quantityLedger;ledger.reservations[0].outputUpper=1;
 row.status='success';row.localPath='/uploads/one.png';
 row.templateData=JSON.stringify({...JSON.parse(row.templateData),agentOutputContract:{version:2,maxReturned:1},agentOutputObservation:{rawReturned:2,uniqueOutputs:2,savedOutputs:2},savedOutputs:[{outputIndex:0,localPath:'/uploads/one.png',generationId:10},{outputIndex:1,localPath:'/uploads/two.png',generationId:11}]});
 const delivered=await readCreativeAgentMediaDelivery({id:'run',actorUserId:1,canvasId:57,epoch:9,status:'paused'} as any,row.id);
 expect(delivered.outputs).toHaveLength(2);expect(delivered.outputMismatch).toBe(true);
 expect(db.decision.run.input.quantityLedger.frozen).toBe(true);
 await readCreativeAgentMediaDelivery({id:'run',actorUserId:1,canvasId:57,epoch:9,status:'paused'} as any,row.id);
 expect(db.decision.run.input.quantityLedger.reservations).toHaveLength(1);expect(db.create).toHaveBeenCalledTimes(1);
});

it('v2 closes the approval-to-dispatch window when the page catalog hides the selected model',async()=>{
 await expect(matchingFailedSource(0,()=>{db.visible=false;})).rejects.toBeDefined();
 expect(db.create).not.toHaveBeenCalled();
});
it('v2 cannot use an old approval to retry a hidden model, while dispatched outputs remain readable',async()=>{
 const {request,failed}=await matchingFailedSource(1);db.visible=false;
 await expect(executeCreativeAgentMediaRetry(request,failed.id)).rejects.toBeDefined();
 expect(db.create).toHaveBeenCalledTimes(1);expect(db.retryActions.size).toBe(0);
 failed.status='success';failed.localPath='/uploads/previous.png';
 const result=await executeCreativeAgentMediaTool({...request,kind:'generation.read',args:{generationId:failed.id}});
 expect(result.status).toBe('success');expect(db.create).toHaveBeenCalledTimes(1);
});
it('v2 refuses removed page parameter modes before dispatch and retry',async()=>{
 await expect(matchingFailedSource(0,()=>{db.gptModes=['sunburst'];},'gpt-image-2.5-reapi')).rejects.toBeDefined();
 expect(db.create).not.toHaveBeenCalled();
 db.gptModes=['flare','sunburst'];
 const {request,failed}=await matchingFailedSource(1,undefined,'gpt-image-2.5-reapi');db.gptModes=['sunburst'];
 await expect(executeCreativeAgentMediaRetry(request,failed.id)).rejects.toBeDefined();
 expect(db.create).toHaveBeenCalledTimes(1);expect(db.retryActions.size).toBe(0);
});

it.each([0,1])('new direct authorization preserves the explicit retry limit %s and the same ledger',async retryCalls=>{
 const {request,failed}=await matchingFailedSource(retryCalls,undefined,undefined,true);
 const result=await executeCreativeAgentMediaRetry(request,failed.id);
 if(!retryCalls)expect(result).toBeNull();else{expect(result).toMatchObject({retryAttempt:1});await executeCreativeAgentMediaRetry(request,failed.id);}
 expect(db.create).toHaveBeenCalledTimes(1+retryCalls);expect(db.decision.run.input.quantityLedger.reservations).toHaveLength(1+retryCalls);expect(db.retryActions.size).toBe(retryCalls);
});
