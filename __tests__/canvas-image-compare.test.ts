import { describe, expect, it } from "vitest";
import { canvasNodeSchema, createEmptyCanvasDocumentV2, type CanvasNode, type CanvasEdge } from "@/lib/canvas/document";
import { getCanvasConnectionDecision, connectCanvasNodeSelection } from "@/lib/canvas/connection-rules";
import { getCanvasCompareImages, sizeNewlyConnectedComparisons } from "@/lib/canvas/image-compare";
import { getCanvasFlowGeometry } from "@/lib/canvas/flow-geometry";

const compare: CanvasNode = { id: "compare", type: "compare", position: { x: 0, y: 0 }, data: { kind: "compare", beforeUrl: "", afterUrl: "", slider: 0.5 } };
const photo = (id: string): CanvasNode => ({ id, type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: `/${id}.png`, origin: "upload" } });
const edge = (source: string): CanvasEdge => ({ id: source, source, target: compare.id });

describe("connected image comparison", () => {
  it("resizes from the first new source after all connections are removed, but not from the second", () => {
    const empty = { ...createEmptyCanvasDocumentV2(), nodes: [
      { ...photo("a"), width: 800, height: 400 }, { ...photo("b"), width: 350, height: 700 },
      { ...compare, width: 200, height: 200 },
    ] };
    const first = sizeNewlyConnectedComparisons(empty, { ...empty, edges: [edge("a")] });
    expect(first.nodes[2]).toMatchObject({ width: 800, height: 400 });
    const second = sizeNewlyConnectedComparisons(first, { ...first, edges: [edge("a"), edge("b")] });
    expect(second.nodes[2]).toMatchObject({ width: 800, height: 400 });
    const disconnected = { ...second, edges: [] };
    const reconnected = sizeNewlyConnectedComparisons(disconnected, { ...disconnected, edges: [edge("b")] });
    expect(reconnected.nodes[2]).toMatchObject({ width: 350, height: 700 });
  });
  it("provides a full-frame target even before DOM measurement", () => {
    const { handles } = getCanvasFlowGeometry({ ...compare, width: 700, height: 350 });
    expect(handles.find(handle => handle.id === "canvas-task-body-target")).toMatchObject({ type: "target", x: -20, y: -20, width: 740, height: 390 });
    expect(handles.some(handle => handle.type === "source")).toBe(false);
  });
  it("accepts two images and rejects a third or non-image input", () => {
    const nodes: CanvasNode[] = [photo("a"), photo("b"), photo("c"), compare, { id: "text", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "hello" } }];
    expect(getCanvasConnectionDecision(nodes, edge("a")).allowed).toBe(true);
    expect(getCanvasConnectionDecision(nodes, edge("b"), [edge("a")]).allowed).toBe(true);
    expect(getCanvasConnectionDecision(nodes, edge("c"), [edge("a"), edge("b")]).error).toContain("最多连接两张");
    expect(getCanvasConnectionDecision(nodes, edge("text")).error).toContain("只接受图片");
    expect(getCanvasConnectionDecision(nodes, edge("c"), [edge("a"), edge("b")], { ignoreEdgeId: "b" }).allowed).toBe(true);
  });

  it("creates both connections atomically for a two-image selection", () => {
    const nodes = [photo("a"), photo("b"), photo("c"), compare];
    let index = 0;
    expect(connectCanvasNodeSelection(nodes, [], ["a", "b"], "compare", () => String(index++)).edges).toHaveLength(2);
    expect(connectCanvasNodeSelection(nodes, [], ["a", "b", "c"], "compare", () => String(index++)).edges).toHaveLength(0);
  });

  it("restores a one-input node and slider through the document schema", () => {
    const restored = canvasNodeSchema.parse(JSON.parse(JSON.stringify({ ...compare, data: { ...compare.data, slider: 0.73 } })));
    expect(restored.data).toMatchObject({ kind: "compare", slider: 0.73 });
    if (restored.data.kind !== "compare") throw new Error("wrong node type");
    expect(getCanvasCompareImages("compare", [photo("a")], [edge("a")], restored.data)).toEqual(["/a.png", ""]);
  });

  it("tracks source replacement and disconnection without caching stale images", () => {
    if (compare.data.kind !== "compare") throw new Error("wrong node type");
    const nodes = [photo("a"), photo("b"), compare];
    expect(getCanvasCompareImages("compare", nodes, [edge("a"), edge("b")], compare.data)).toEqual(["/a.png", "/b.png"]);
    nodes[0] = { ...photo("a"), data: { kind: "image", url: "/changed.png" } };
    expect(getCanvasCompareImages("compare", nodes, [edge("a"), edge("b")], compare.data)).toEqual(["/changed.png", "/b.png"]);
    expect(getCanvasCompareImages("compare", nodes, [edge("b")], compare.data)).toEqual(["/b.png", ""]);
    expect(getCanvasCompareImages("compare", nodes, [], compare.data)).toEqual(["", ""]);
  });
});
