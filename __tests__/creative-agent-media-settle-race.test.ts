import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { prepareCreativeAgentMedia, executeCreativeAgentMediaTool, readCreativeAgentMediaDelivery } from "@/lib/creative-agent/media-broker";
import { hashCanvasMutationPayload } from "@/lib/canvas/mutation-contract";
import { applyCanvasOperations } from "@/lib/canvas/operations";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";
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

afterEach(() => vi.restoreAllMocks());
describe("concurrent observer settlement uses one durable payload", () => {
 it.each([
  ["image", "success", "date"], ["image", "failed", "date"], ["image", "cancelled", "date"],
  ["video", "success", "date"], ["video", "failed", "date"], ["image", "success", "missing"], ["video", "success", "string"],
 ])("settles %s %s with %s timestamp once for worker and delivery", async (type, status, timestamp) => {
  const request = type === "image" ? input() : { ...input(), kind: "video.generate", args: { model: "doubao-seedance-2-0-fast-260128", prompt: "缓慢推进", params: { inputMode: "text_to_video", duration: 5, resolution: "720p", ratio: "16:9" } } };
  await approve(request); await executeCreativeAgentMediaTool(request);
  const row = [...db.rows.values()][0]; row.status = status; row.localPath = status === "success" ? `/uploads/result.${type === "image" ? "png" : "mp4"}` : null;
  row.finishedAt = timestamp === "missing" ? null : timestamp === "string" ? "2026-10-16T11:12:45.000Z" : new Date("2026-10-16T11:12:45.000Z");
  const { submitCanvasMutation } = await vi.importActual<typeof import("@/lib/canvas/mutation-service")>("@/lib/canvas/mutation-service");
  const captured: any[] = [], committed = new Map<string, string>();
  let release!: () => void; const bothReady = new Promise<void>(resolve => { release = resolve; });
  let now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => ++now);
  db.submit.mockImplementation(async (args: any) => {
   captured.push(args.input); if (captured.length === 2) release(); await bothReady;
   return submitCanvasMutation(args, { commit: async value => {
    const prior = committed.get(value.request.clientMutationId);
    if (prior) return { kind: "duplicate", revision: BigInt(3), payloadHash: prior };
    committed.set(value.request.clientMutationId, value.payloadHash);
    const doc = applyCanvasOperations({ ...createEmptyCanvasDocumentV2(), nodes: db.nodes, edges: db.edges }, value.request.operations);
    db.nodes = doc.nodes; db.edges = doc.edges;
    return { kind: "applied", revision: BigInt(3) };
   } });
  });
  const outcomes = await Promise.allSettled([
   executeCreativeAgentMediaTool({ ...request, kind: "generation.read", args: { generationId: row.id } }),
   readCreativeAgentMediaDelivery({ id: "run", actorUserId: 1, canvasId: 57, epoch: 1 } as any, row.id),
  ]);
  expect(outcomes.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
  expect(committed.size).toBe(1); expect(captured).toHaveLength(2);
  expect(hashCanvasMutationPayload(captured[0])).toBe(hashCanvasMutationPayload(captured[1]));
  const data = db.nodes[0].data;
  const finish = data.kind === "imageTask" ? data.task.batches[0].outputs[0].finishedAt : data.finishedAt;
  expect(finish).toBe(timestamp === "missing" ? undefined : Date.parse("2026-10-16T11:12:45.000Z"));
  expect(db.create.mock.calls.length + db.createVideo.mock.calls.length).toBe(1);
 });
 it("still rejects a genuine mutation ID collision with changed output content", async () => {
  await approve(); await executeCreativeAgentMediaTool(input());
  const row = [...db.rows.values()][0]; Object.assign(row, { status: "success", localPath: "/uploads/result.png", finishedAt: new Date("2026-10-16T11:12:45.000Z") });
  const { submitCanvasMutation } = await vi.importActual<typeof import("@/lib/canvas/mutation-service")>("@/lib/canvas/mutation-service");
  db.submit.mockImplementation(async args => submitCanvasMutation(args, { commit: async () => ({ kind: "duplicate", revision: BigInt(3), payloadHash: "different-actual-content" }) }));
  await expect(executeCreativeAgentMediaTool({ ...input(), kind: "generation.read", args: { generationId: row.id } })).rejects.toMatchObject({ code: "MUTATION_ID_REUSED" });
  expect(db.create).toHaveBeenCalledOnce();
 });
});
