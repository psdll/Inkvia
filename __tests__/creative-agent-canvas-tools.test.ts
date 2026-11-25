import { describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "@/lib/canvas/document";
import { creativeAgentNodeHash, executeCreativeAgentCanvasTool, resolveCreativeAgentSelection } from "@/lib/creative-agent/canvas-tools";

const node: CanvasNode = { id: "script", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", title: "剧本", text: "旧结尾" } };
const scope = { actorUserId: 1, canvasId: 2, runId: "run", actionId: "action", epoch: 1 };
function deps() {
  return { read: vi.fn().mockResolvedValue({ revision: "9", nodes: [node], edgeIds: [] }), receipt: vi.fn().mockResolvedValue(null), commit: vi.fn().mockResolvedValue({ revision: "10" }) };
}

describe("creative Agent canvas tools", () => {
  it("creates stable node/mutation IDs through the existing committed revision contract", async () => {
    const io = deps();
    const input = { ...scope, kind: "canvas.create", args: { nodes: [{ kind: "prompt", title: "分镜", text: "镜头一" }] } };
    const first = await executeCreativeAgentCanvasTool(input, io);
    const second = await executeCreativeAgentCanvasTool(input, io);
    expect(first).toEqual(second);
    expect(io.commit.mock.calls[0][1]).toMatchObject({ baseRevision: "9", protocolVersion: 1, operations: [{ kind: "node.create", node: { data: { kind: "prompt", title: "分镜", text: "镜头一" } } }] });
    expect(io.commit.mock.calls[0][1].clientMutationId).toEqual(io.commit.mock.calls[1][1].clientMutationId);
  });
  it("recovers a committed canvas receipt without re-reading changed content or writing twice", async () => {
    const io = deps();
    io.receipt.mockResolvedValue({ revision: "10", nodeIds: ["created"] });
    const result = await executeCreativeAgentCanvasTool({ ...scope, kind: "canvas.create", args: {} }, io);
    expect(result).toMatchObject({ revision: "10", nodeIds: ["created"], idempotent: true });
    expect(io.read).not.toHaveBeenCalled(); expect(io.commit).not.toHaveBeenCalled();
  });
  it("rejects changes to the target content while allowing layout changes", async () => {
    const io = deps();
    const input = { ...scope, kind: "canvas.patch", args: { nodeId: node.id, expectedHash: creativeAgentNodeHash(node), patch: { text: "新结尾" } } };
    io.read.mockResolvedValue({ revision: "12", nodes: [{ ...node, position: { x: 500, y: 20 } }], edgeIds: [] });
    await executeCreativeAgentCanvasTool(input, io);
    expect(io.commit.mock.calls[0][1].baseRevision).toBe("12");
    io.commit.mockClear();
    io.read.mockResolvedValue({ revision: "13", nodes: [{ ...node, data: { ...node.data, text: "用户已改" } }], edgeIds: [] });
    await expect(executeCreativeAgentCanvasTool(input, io)).rejects.toMatchObject({ code: "TARGET_CHANGED" });
    expect(io.commit).not.toHaveBeenCalled();
  });
  it("propagates a commit race without retrying or overwriting", async () => {
    const io = deps(); io.commit.mockRejectedValue(new Error("revision conflict"));
    await expect(executeCreativeAgentCanvasTool({ ...scope, kind: "canvas.patch", args: { nodeId: node.id, expectedHash: creativeAgentNodeHash(node), patch: { text: "新" } } }, io)).rejects.toThrow("revision conflict");
    expect(io.commit).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-canvas, removed and forged output references", () => {
    const snapshot = { revision: "1", nodes: [node], edgeIds: [] };
    const selection = { nodeIds: [node.id], edgeIds: [], references: [{ canvasId: 2, nodeId: node.id, kind: "prompt", label: "剧本" }] };
    expect(resolveCreativeAgentSelection(2, snapshot, selection).references[0].semanticHash).toBe(creativeAgentNodeHash(node));
    expect(() => resolveCreativeAgentSelection(2, snapshot, { ...selection, references: [{ ...selection.references[0], canvasId: 3 }] })).toThrow();
    expect(() => resolveCreativeAgentSelection(2, snapshot, { ...selection, nodeIds: ["deleted"] })).toThrow();
    expect(() => resolveCreativeAgentSelection(2, snapshot, { ...selection, references: [{ ...selection.references[0], outputId: "forged" }] })).toThrow();
  });
  it.each(["imageTask", "videoTask", "audioTask"] as const)("rejects an empty %s material reference while keeping the node available as an operation target", kind => {
    const task = { id: "task", type: kind, position: { x: 0, y: 0 }, data: { kind, status: "idle", task: { batches: [] } } } as unknown as CanvasNode;
    const snapshot = { revision: "1", nodes: [task], edgeIds: [] };
    const selection = { nodeIds: [task.id], edgeIds: [], references: [] };
    expect(resolveCreativeAgentSelection(2, snapshot, selection)).toEqual(selection);
    expect(() => resolveCreativeAgentSelection(2, snapshot, { ...selection, references: [{ canvasId: 2, nodeId: task.id, kind, label: "空任务" }] })).toThrow("引用");
  });
});
