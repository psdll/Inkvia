import { describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "@/lib/canvas/document";
import type { Run } from "@/lib/creative-agent/store-types";
import type { CreativeAgentAttachmentRecord } from "@/lib/creative-agent/attachments";
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/creative-agent/store", () => ({ creativeAgentStore: {} }));
const run: Run = { id: "run", sessionId: "session", actorUserId: 7, canvasId: 17, epoch: 1, status: "running", error: null, createdAt: "2026-10-16", updatedAt: "2026-10-16", leaseExpiresAt: null, workerId: null, input: { actorUserId: 7, canvasId: 17, messageId: "message", text: "use references", baseRevision: "1", attachments: [{ id: "attachment" }], selection: { nodeIds: [], edgeIds: [], references: [] } } };
const records: CreativeAgentAttachmentRecord[] = [{ id: "attachment", name: "product.png", mimeType: "image/png", url: "/uploads/product.png", sha256: "a".repeat(64), size: 3, status: "ready", coverage: "image", actorUserId: 7, canvasId: 17, sessionId: "session" }];
async function setup(nodes: CanvasNode[] = []) {
  const module = await import("@/lib/creative-agent/reference-preparation").catch(() => ({})) as any;
  expect(module.prepareCreativeAgentReferences, "attachment-to-canvas bridge must exist").toBeTypeOf("function");
  let snapshot = { revision: "1", nodes, edgeIds: [] as string[] };
  const deps = { attachments: vi.fn(async () => records), read: vi.fn(async () => snapshot), contentHash: vi.fn(async () => records[0].sha256), mediaFacts: vi.fn(async (record: { sha256: string }) => ({ state: "verified", kind: "image", contentVersion: record.sha256, width: 100, height: 100 })), guard: vi.fn(), saveMapping: vi.fn(), loadMapping: vi.fn(async () => null), commit: vi.fn(async (_run, request) => { snapshot = { ...snapshot, revision: "2", nodes: [...snapshot.nodes, ...request.operations.map((op: { node: CanvasNode }) => op.node)] }; return { revision: "2" }; }) };
  return { prepare: module.prepareCreativeAgentReferences, deps, snapshot: () => snapshot };
}
describe("durable sent attachment reference preparation", () => {
  it("makes empty-canvas attachments bindable and replay creates no duplicate", async () => {
    const { prepare, deps, snapshot } = await setup();
    const result = await prepare(run, deps);
    expect(result.selection.references[0]).toMatchObject({ canvasId: 17, kind: "image", label: "product.png", semanticHash: expect.any(String) });
    expect(snapshot().nodes).toHaveLength(1);
    expect(deps.saveMapping).toHaveBeenCalled();
    const retry = await prepare(run, deps);
    expect(retry.selection.references).toEqual(result.selection.references);
    expect(deps.commit).toHaveBeenCalledOnce();
  });
  it.each([[2160, 2880, 350, 467], [2880, 2160, 467, 350]])("preserves verified image aspect %s x %s", async (width, height, expectedWidth, expectedHeight) => {
    const { prepare, deps, snapshot } = await setup();
    deps.mediaFacts.mockResolvedValue({ state: "verified", kind: "image", contentVersion: records[0].sha256, width, height });
    await prepare(run, deps);
    expect(snapshot().nodes[0]).toMatchObject({ width: expectedWidth, height: expectedHeight });
  });
  it.each([["video", 1920, 1080, 622, 350], ["video", 0, 0, 350, 350], ["audio", 0, 0, 420, 200]])("uses existing media-size defaults for %s %s x %s", async (kind, width, height, expectedWidth, expectedHeight) => {
    const { prepare, deps, snapshot } = await setup();
    deps.attachments.mockResolvedValue([{ ...records[0], mimeType: `${kind}/test`, facts: { state: "verified", kind, contentVersion: records[0].sha256, width, height } }]);
    deps.mediaFacts.mockResolvedValue({ state: "verified", kind, contentVersion: records[0].sha256, width, height });
    await prepare(run, deps);
    expect(snapshot().nodes[0]).toMatchObject({ width: expectedWidth, height: expectedHeight });
  });
  it("reuses identical original bytes while keeping existing nodes in place", async () => {
    const original: CanvasNode = { id: "original", type: "image", position: { x: 20, y: 30 }, width: 201, height: 302, data: { kind: "image", url: "/uploads/original.png" } };
    const { prepare, deps, snapshot } = await setup([original]);
    const result = await prepare(run, deps);
    expect(result.selection.references[0].nodeId).toBe("original");
    expect(deps.commit).not.toHaveBeenCalled();
    expect(snapshot().nodes[0]).toMatchObject({ position: { x: 20, y: 30 }, width: 201, height: 302 });
    expect(deps.mediaFacts).not.toHaveBeenCalled();
  });
  it("sends one reference when selected original and two same-byte attachments agree", async () => {
    const original: CanvasNode = { id: "original", type: "image", position: { x: 20, y: 30 }, data: { kind: "image", url: "/uploads/original.png", mediaId: "fe2a1d28-321f-4cf8-9124-35d55dbb79a5" } };
    const { prepare, deps, snapshot } = await setup([original]);
    deps.attachments.mockResolvedValue([records[0], { ...records[0], id: "same-content", name: "other-name.png" }]);
    const selected = { canvasId: 17, nodeId: "original", kind: "image", label: "selected product" };
    const result = await prepare({ ...run, input: { ...run.input, selection: { nodeIds: ["original"], edgeIds: [], references: [selected] } } }, deps);
    expect(result.selection.references).toHaveLength(1);
    expect(result.selection.references[0]).toMatchObject(selected);
    expect(snapshot().nodes).toHaveLength(1);
    expect(deps.commit).not.toHaveBeenCalled();
  });
  it("does not create media nodes for text documents", async () => {
    const { prepare, deps } = await setup();
    deps.attachments.mockResolvedValue([{ ...records[0], mimeType: "text/plain" }]);
    expect((await prepare(run, deps)).selection.references).toEqual([]);
    expect(deps.commit).not.toHaveBeenCalled();
  });
  it("re-reads on revision conflict and reuses a concurrently created source", async () => {
    const { prepare, deps } = await setup();
    deps.commit.mockImplementationOnce(async (_run, request) => {
      const source = request.operations[0].node;
      deps.read.mockResolvedValue({ revision: "2", nodes: [source], edgeIds: [] });
      throw Object.assign(new Error("conflict"), { code: "CANVAS_REVISION_CONFLICT" });
    });
    await prepare(run, deps);
    expect(deps.read).toHaveBeenCalledTimes(2);
    expect(deps.commit).toHaveBeenCalledOnce();
  });
  it("keeps the exact historical selected output and preserves attachment order", async () => {
    const task = { id: "task", type: "imageTask", position: { x: 0, y: 0 }, data: { kind: "imageTask", task: { batches: [{ id: "old-batch", outputs: [{ id: "old-output", status: "success", url: "/uploads/old.png", generationId: 8 }] }, { id: "new-batch", outputs: [{ id: "new-output", status: "success", url: "/uploads/new.png" }] }] } } } as any;
    const { prepare, deps } = await setup([task]);
    deps.attachments.mockResolvedValue([records[0], { ...records[0], id: "second", name: "second.png", sha256: "b".repeat(64) }]);
    const selected = { canvasId: 17, nodeId: "task", kind: "imageTask", label: "historical", batchId: "old-batch", outputId: "old-output", generationId: 8 };
    const result = await prepare({ ...run, input: { ...run.input, selection: { nodeIds: ["task"], edgeIds: [], references: [selected] } } }, deps);
    expect(result.selection.references[0]).toMatchObject(selected);
    expect(result.selection.references.map((ref: { label: string }) => ref.label)).toEqual(["historical", "product.png", "second.png"]);
  });
  it("stops remaining mapping saves when cancelled during the first save", async () => {
    const { prepare, deps } = await setup();
    deps.attachments.mockResolvedValue([records[0], { ...records[0], id: "second", sha256: "b".repeat(64) }]);
    const controller = new AbortController();
    deps.saveMapping.mockImplementationOnce(async () => { controller.abort(new Error("cancelled during save")); });
    await expect(prepare(run, deps, controller.signal)).rejects.toThrow("cancelled during save");
    expect(deps.saveMapping).toHaveBeenCalledOnce();
  });
  it("checks cancellation before committing a source", async () => {
    const { prepare, deps } = await setup();
    deps.guard.mockImplementation(() => { throw new Error("cancelled"); });
    await expect(prepare(run, deps)).rejects.toThrow("cancelled");
    expect(deps.commit).not.toHaveBeenCalled();
  });
});
