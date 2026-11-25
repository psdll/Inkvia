import { describe, expect, it, vi } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import { createCanvasDocumentMutation, diffCanvasDocumentsToOperations } from "@/lib/canvas/document-diff";
import { applyCanvasOperations } from "@/lib/canvas/operations";

function promptNode(id: string, text = id): CanvasNode {
  return { id, type: "prompt", position: { x: 0, y: 0 }, width: 200, height: 120, data: { kind: "prompt", text } };
}

function doc(nodes: CanvasNode[], edges: CanvasDocumentV2["edges"] = []): CanvasDocumentV2 {
  return { ...createEmptyCanvasDocumentV2(), nodes, edges };
}

describe("canvas document diff", () => {
  it("produces a minimal replayable batch for node, edge, and settings changes", () => {
    const before = doc([promptNode("a"), promptNode("b")], [{ id: "e1", source: "a", target: "b" }]);
    const after = doc([
      { ...promptNode("a", "updated"), position: { x: 50, y: 75 }, width: 260 },
      promptNode("c"),
    ], [{ id: "e2", source: "a", target: "c" }]);
    after.settings = { snapToGrid: true, gridSize: 24 };

    const operations = diffCanvasDocumentsToOperations(before, after, "m1");

    expect(applyCanvasOperations(before, operations)).toEqual(after);
    expect(operations.map((operation) => operation.kind)).toEqual([
      "edge.delete",
      "node.delete",
      "node.create",
      "node.patch",
      "node.move",
      "node.resize",
      "edge.create",
      "canvas.settings.patch",
    ]);
  });

  it("removes optional node data fields without replacing the node", () => {
    const before = doc([{ ...promptNode("a"), data: { kind: "prompt", text: "x", title: "remove me" } }]);
    const after = doc([promptNode("a", "x")]);
    const operations = diffCanvasDocumentsToOperations(before, after, "m2");

    expect(operations).toEqual([
      expect.objectContaining({ kind: "node.patch", patch: { unsetDataKeys: ["title"] } }),
    ]);
    expect(applyCanvasOperations(before, operations)).toEqual(after);
  });

  it("persists optional node data cleared by assigning undefined", () => {
    const videoTask: CanvasNode = {
      id: "video-task",
      type: "videoTask",
      position: { x: 0, y: 0 },
      data: {
        kind: "videoTask",
        model: "video-model",
        prompt: "prompt",
        mediaPaths: [],
        status: "failed",
        generationId: 41,
        error: "生成超时",
      },
    };
    const before = doc([videoTask]);
    const successfulVideoTask: CanvasNode = {
      ...videoTask,
      data: {
        kind: "videoTask",
        model: "video-model",
        prompt: "prompt",
        mediaPaths: [],
        status: "success",
        generationId: 41,
        outputUrl: "/uploads/result.mp4",
        error: undefined,
      },
    };
    const after = doc([successfulVideoTask]);

    const operations = diffCanvasDocumentsToOperations(before, after, "m-undefined");
    const applied = applyCanvasOperations(before, operations);

    expect(operations).toEqual([
      expect.objectContaining({
        kind: "node.patch",
        patch: expect.objectContaining({ unsetDataKeys: ["error"] }),
      }),
    ]);
    expect(applied.nodes[0]?.data).not.toHaveProperty("error");
    expect(applied.nodes[0]?.data).toMatchObject({ status: "success", outputUrl: "/uploads/result.mp4" });
  });

  it("recreates unchanged incident edges when a node kind is replaced", () => {
    const before = doc([promptNode("a"), promptNode("b")], [{ id: "e1", source: "a", target: "b" }]);
    const replacement: CanvasNode = {
      id: "a",
      type: "image",
      position: { x: 0, y: 0 },
      width: 200,
      height: 120,
      data: { kind: "image", url: "/replacement.png" },
    };
    const after = doc([replacement, promptNode("b")], [{ id: "e1", source: "a", target: "b" }]);

    expect(applyCanvasOperations(before, diffCanvasDocumentsToOperations(before, after, "m3"))).toEqual(after);
  });

  it("creates inverse operations that restore the exact base document", () => {
    const before = doc([promptNode("a", "before")]);
    const after = doc([{ ...promptNode("a", "after"), hidden: true, position: { x: 9, y: 4 } }, promptNode("b")]);

    const mutation = createCanvasDocumentMutation(before, after, "mutation-id");
    const applied = applyCanvasOperations(before, mutation.operations);

    expect(applied).toEqual(after);
    expect(applyCanvasOperations(applied, mutation.inverseOperations)).toEqual(before);
  });

  it("does not create shared mutations for per-user viewport movement", () => {
    const before = doc([promptNode("a")]);
    const after = { ...before, viewport: { x: 100, y: 80, zoom: 0.5 } };
    expect(diffCanvasDocumentsToOperations(before, after, "m4")).toEqual([]);
  });

  it("does not visit graph contents for viewport-only changes, but still persists settings", () => {
    const before = doc([promptNode("a")]);
    const visit = vi.spyOn(before.nodes, "map");
    const after = { ...before, viewport: { x: 120, y: 80, zoom: 2 } };
    expect(diffCanvasDocumentsToOperations(before, after)).toEqual([]);
    expect(diffCanvasDocumentsToOperations(before, { ...after, settings: { snapToGrid: true, gridSize: 24 } }))
      .toEqual([expect.objectContaining({ kind: "canvas.settings.patch", patch: { snapToGrid: true, gridSize: 24 } })]);
    expect(visit).not.toHaveBeenCalled();
  });

  it("moves a node without serializing unchanged task data or edges", () => {
    const before = doc([promptNode("a"), promptNode("b")], [{ id: "edge", source: "a", target: "b" }]);
    const serialize = vi.fn(() => "unchanged");
    Object.defineProperty(before.nodes[0].data, "text", { enumerable: true, value: { toJSON: serialize } });
    Object.defineProperty(before.edges[0], "toJSON", { value: serialize });
    const after = { ...before, nodes: [{ ...before.nodes[0], position: { x: 30, y: 40 } }, before.nodes[1]] };
    expect(diffCanvasDocumentsToOperations(before, after)).toEqual([
      expect.objectContaining({ kind: "node.move", nodeId: "a", position: { x: 30, y: 40 } }),
    ]);
    expect(serialize).not.toHaveBeenCalled();
  });
});
