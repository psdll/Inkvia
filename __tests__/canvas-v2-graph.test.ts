import { describe, expect, it } from "vitest";
import type { CanvasDocumentV2, CanvasNode } from "@/lib/canvas/document";
import { parseCanvasDocumentV2 } from "@/lib/canvas/document";
import { getCanvasFlowGeometry } from "@/lib/canvas/flow-geometry";
import {
  alignNodes,
  autoArrangeNodes,
  distributeNodes,
  duplicateSelection,
  groupSelection,
  stackSelection,
  resolveCanvasMarqueeSelection,
  ungroupSelection,
} from "@/lib/canvas/graph";
import * as graphOperations from "@/lib/canvas/graph";

function promptNode(id: string, x: number, y: number): CanvasNode {
  return { id, type: "prompt", position: { x, y }, width: 200, height: 100, data: { kind: "prompt", text: id } };
}

function document(nodes: CanvasNode[]): CanvasDocumentV2 {
  return {
    schemaVersion: 2,
    mode: "smart",
    nodes,
    edges: nodes.length > 1 ? [{ id: "e-ab", source: nodes[0].id, target: nodes[1].id }] : [],
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: { snapToGrid: false, gridSize: 20 },
  };
}

describe("canvas v2 graph operations", () => {
  it("stacks without losing task state or edges and restores the original layout", () => {
    const source = document([promptNode("a", 100, 80), promptNode("b", 360, 180)]);
    const snapshot = structuredClone(source);
    const stacked = stackSelection(source, ["a", "b"]);
    expect(stacked.document.nodes.find(node => node.id === stacked.groupId)?.data).toMatchObject({ stacked: true, collapsed: true });
    expect(stacked.document.nodes.filter(node => node.parentId === stacked.groupId).every(node => node.hidden)).toBe(true);
    expect(stacked.document.edges).toEqual(source.edges);
    const saved = parseCanvasDocumentV2(JSON.parse(JSON.stringify(stacked.document)));
    const stack = saved.nodes.find(node => node.id === stacked.groupId)!;
    expect(stack.data).toMatchObject({ stacked: true });
    expect(getCanvasFlowGeometry(stack).handles.map(handle => handle.type)).toEqual(["source", "target"]);
    const restored = ungroupSelection(stacked.document, stacked.groupId);
    expect(restored.nodes.map(node => ({ id: node.id, position: node.position, data: node.data }))).toEqual(source.nodes.map(node => ({ id: node.id, position: node.position, data: node.data })));
    expect(source).toEqual(snapshot);
  });
  it.each(["submitting", "running"] as const)("copies a %s video task as idle without changing the original", (status) => {
    const node: CanvasNode = {
      id: "task", type: "videoTask", position: { x: 0, y: 0 },
      data: {
        kind: "videoTask", model: "MiniMax-H3", prompt: "产品视频", mediaPaths: ["reference.png"],
        referenceOrder: ["ref"], ratio: "9:16", duration: 15, status,
        requestKey: "original-request", generationId: 123, startedAt: 100,
      },
    };
    const source = document([promptNode("ref", 0, 0), node]);
    const snapshot = structuredClone(source);
    const result = duplicateSelection(source, [node.id], undefined, { preserveIncomingEdges: true });
    const copy = result.document.nodes.find(item => item.id === result.idMap.get(node.id))!;

    expect(copy.data).toEqual({
      kind: "videoTask", model: "MiniMax-H3", prompt: "产品视频", mediaPaths: ["reference.png"],
      referenceOrder: ["ref"], ratio: "9:16", duration: 15, status: "idle",
    });
    expect(result.document.edges.at(-1)).toMatchObject({ source: "ref", target: copy.id });
    expect(source).toEqual(snapshot);
    expect(result.document.nodes.find(item => item.id === node.id)?.data).toEqual(node.data);
  });

  it("clears execution from tasks copied inside a group", () => {
    const node: CanvasNode = {
      id: "task", type: "audioTask", position: { x: 0, y: 0 },
      data: {
        kind: "audioTask", model: "speech-2.8-hd", prompt: "旁白", voiceId: "voice",
        speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0,
        soundEffect: "", status: "running", requestKey: "request", generationId: 123, startedAt: 100,
      },
    };
    const grouped = groupSelection(document([node, promptNode("ref", 300, 0)]), [node.id, "ref"]);
    const result = duplicateSelection(grouped.document, [grouped.groupId]);
    const copy = result.document.nodes.find(item => item.id === result.idMap.get(node.id))!;
    expect(copy.data).toMatchObject({ kind: "audioTask", prompt: "旁白", voiceId: "voice", status: "idle" });
    expect(copy.data).not.toHaveProperty("generationId");
    expect(copy.data).not.toHaveProperty("requestKey");
    expect(copy.data).not.toHaveProperty("startedAt");
    expect(node.data).toMatchObject({ status: "running", generationId: 123 });
  });

  it("duplicates selected nodes and only their internal edges", () => {
    const source = document([promptNode("a", 10, 20), promptNode("b", 260, 20), promptNode("c", 520, 20)]);
    source.edges.push({ id: "e-bc", source: "b", target: "c" });

    const result = duplicateSelection(source, ["a", "b"], { x: 40, y: 30 });

    expect(result.selectedIds).toHaveLength(2);
    expect(result.document.nodes).toHaveLength(5);
    expect(result.document.edges).toHaveLength(3);
    const copies = result.document.nodes.filter((node) => result.selectedIds.includes(node.id));
    expect(copies.map((node) => node.position)).toEqual([{ x: 50, y: 50 }, { x: 300, y: 50 }]);
    expect(result.document.edges.at(-1)).toMatchObject({
      source: result.selectedIds[0],
      target: result.selectedIds[1],
    });
  });

  it("copies image settings and completed results without pending batch outputs", () => {
    const settings = { model: "image-model", prompt: "产品图片", aspectRatio: "9:16", resolution: "2k", quality: "standard", count: 1 };
    const node: CanvasNode = {
      id: "image-task", type: "imageTask", position: { x: 0, y: 0 },
      data: { kind: "imageTask", task: {
        settings, references: [{ id: "ref", name: "产品", url: "reference.png" }],
        batches: [
          { id: "mixed", createdAt: 1, settings, outputs: [
            { id: "done", status: "success", url: "done.png" },
            { id: "running", status: "running", generationId: 123 },
            { id: "submitting", status: "submitting", requestKey: "request" },
          ] },
          { id: "queued", createdAt: 2, settings, outputs: [{ id: "pending", status: "idle" }] },
        ],
      } },
    };
    const source = document([node]);
    const snapshot = structuredClone(source);
    const result = duplicateSelection(source, [node.id]);
    const copy = result.document.nodes.at(-1)!;
    if (copy.data.kind !== "imageTask") throw new Error("Expected image task");
    expect(copy.data.task.settings).toEqual(settings);
    expect(copy.data.task.references).toEqual([{ id: "ref", name: "产品", url: "reference.png" }]);
    expect(copy.data.task.batches).toHaveLength(1);
    expect(copy.data.task.batches[0].outputs).toHaveLength(1);
    expect(copy.data.task.batches[0].outputs[0]).toMatchObject({ status: "success", url: "done.png" });
    expect(source).toEqual(snapshot);
  });

  it("duplicates every descendant when a selected group is copied", () => {
    const grouped = groupSelection(document([
      promptNode("a", 100, 80),
      promptNode("b", 360, 180),
    ]), ["a", "b"]);

    const result = duplicateSelection(grouped.document, [grouped.groupId], { x: 40, y: 30 });
    const copies = result.document.nodes.filter((node) => result.selectedIds.includes(node.id) || result.selectedIds.includes(node.parentId || ""));
    const copiedGroup = copies.find((node) => node.type === "group");
    const copiedChildren = copiedGroup ? result.document.nodes.filter((node) => node.parentId === copiedGroup.id) : [];

    expect(copiedGroup).toBeDefined();
    expect(copiedChildren).toHaveLength(2);
    expect(result.document.edges).toHaveLength(grouped.document.edges.length + 1);
  });

  it("groups nodes using relative positions and restores absolute positions when ungrouped", () => {
    const source = document([promptNode("a", 100, 80), promptNode("b", 360, 180)]);

    const grouped = groupSelection(source, ["a", "b"], "研究区");
    const group = grouped.document.nodes.find((node) => node.id === grouped.groupId)!;
    expect(group.data).toMatchObject({ kind: "group", title: "研究区", collapsed: false });
    expect(grouped.document.nodes.find((node) => node.id === "a")).toMatchObject({
      parentId: group.id,
      position: { x: 80, y: 100 },
    });

    const ungrouped = ungroupSelection(grouped.document, group.id);
    expect(ungrouped.nodes.find((node) => node.id === group.id)).toBeUndefined();
    expect(ungrouped.nodes.find((node) => node.id === "a")).toMatchObject({ position: { x: 100, y: 80 } });
    expect(ungrouped.nodes.find((node) => node.id === "a")?.parentId).toBeUndefined();
  });

  it("aligns, distributes, and auto-arranges nodes deterministically", () => {
    const source = document([
      promptNode("a", 40, 80),
      promptNode("b", 320, 160),
      promptNode("c", 760, 260),
    ]);

    const aligned = alignNodes(source, ["a", "b", "c"], "top");
    expect(aligned.nodes.map((node) => node.position.y)).toEqual([80, 80, 80]);

    const distributed = distributeNodes(aligned, ["a", "b", "c"], "horizontal");
    expect(distributed.nodes.map((node) => node.position.x)).toEqual([40, 400, 760]);

    const arranged = autoArrangeNodes({
      ...source,
      edges: [
        { id: "e-ab", source: "a", target: "b" },
        { id: "e-bc", source: "b", target: "c" },
      ],
    });
    expect(arranged.nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: 320, y: 0 },
      { x: 640, y: 0 },
    ]);
  });

  it("auto-arranges variable-size nodes without overlap and stays clear of top-level groups", () => {
    const wide = { ...promptNode("wide", 20, 20), width: 620, height: 350 };
    const tall = { ...promptNode("tall", 40, 40), width: 350, height: 1050 };
    const output = { ...promptNode("output", 60, 60), width: 400, height: 220 };
    const group: CanvasNode = {
      id: "group",
      type: "group",
      position: { x: 0, y: 0 },
      width: 500,
      height: 300,
      data: { kind: "group", title: "保留区", collapsed: false },
    };
    const source = document([group, wide, tall, output]);
    source.edges = [
      { id: "wide-output", source: "wide", target: "output" },
      { id: "tall-output", source: "tall", target: "output" },
    ];

    const arranged = autoArrangeNodes(source);

    expect(arranged.nodes.find((node) => node.id === "group")?.position).toEqual({ x: 0, y: 0 });
    expect(arranged.nodes.find((node) => node.id === "wide")?.position).toEqual({ x: 620, y: 0 });
    expect(arranged.nodes.find((node) => node.id === "tall")?.position).toEqual({ x: 620, y: 470 });
    expect(arranged.nodes.find((node) => node.id === "output")?.position).toEqual({ x: 1360, y: 0 });
  });

  it("preserves incoming edges only when Alt+Shift duplication asks for them", () => {
    const source = document([promptNode("source", 0, 0), promptNode("a", 240, 0), promptNode("b", 480, 0)]);
    source.edges = [
      { id: "incoming", source: "source", target: "a" },
      { id: "internal", source: "a", target: "b" },
    ];

    const result = duplicateSelection(source, ["a", "b"], { x: 40, y: 20 }, { preserveIncomingEdges: true });
    const [copyA, copyB] = result.selectedIds;

    expect(result.document.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "source", target: copyA }),
      expect.objectContaining({ source: copyA, target: copyB }),
    ]));
  });

  it("collapses a group without losing child visibility state and restores its size", () => {
    const toggleGroupCollapsed = (graphOperations as any).toggleGroupCollapsed;
    expect(typeof toggleGroupCollapsed).toBe("function");
    if (typeof toggleGroupCollapsed !== "function") return;

    const grouped = groupSelection(document([promptNode("a", 100, 80), promptNode("b", 360, 180)]), ["a", "b"]);
    const collapsed = toggleGroupCollapsed(grouped.document, grouped.groupId, true);
    expect(collapsed.nodes.find((node: CanvasNode) => node.id === grouped.groupId)).toMatchObject({ height: 56, data: { collapsed: true } });
    expect(collapsed.nodes.filter((node: CanvasNode) => node.parentId === grouped.groupId).every((node: CanvasNode) => node.hidden)).toBe(true);

    const expanded = toggleGroupCollapsed(collapsed, grouped.groupId, false);
    expect(expanded.nodes.find((node: CanvasNode) => node.id === grouped.groupId)?.data).toMatchObject({ collapsed: false });
    expect(expanded.nodes.filter((node: CanvasNode) => node.parentId === grouped.groupId).every((node: CanvasNode) => !node.hidden)).toBe(true);
    expect(expanded.nodes.find((node: CanvasNode) => node.id === grouped.groupId)?.height).toBeGreaterThan(56);
  });

  it("aligns existing group rows to their left edge", () => {
    const arrangeGroupChildren = (graphOperations as any).arrangeGroupChildren;
    expect(typeof arrangeGroupChildren).toBe("function");
    if (typeof arrangeGroupChildren !== "function") return;

    const grouped = groupSelection(document([
      promptNode("a", 100, 80),
      promptNode("b", 360, 180),
      promptNode("c", 620, 240),
    ]), ["a", "b", "c"]);
    const arranged = arrangeGroupChildren(grouped.document, grouped.groupId);
    expect(arranged.nodes.filter((node: CanvasNode) => node.parentId === grouped.groupId).map((node: CanvasNode) => node.position)).toEqual([
      { x: 80, y: 100 },
      { x: 80, y: 360 },
      { x: 80, y: 620 },
    ]);
  });

  it("replaces the previous node selection for an unmodified marquee", () => {
    expect(resolveCanvasMarqueeSelection(["a", "b"], ["b", "c"], "replace"))
      .toEqual(["b", "c"]);
  });

  it("unions a Shift marquee with the previous node selection", () => {
    expect(resolveCanvasMarqueeSelection(["a", "b"], ["b", "c"], "union"))
      .toEqual(["a", "b", "c"]);
  });

  it("toggles a Control or Meta marquee against the previous node selection", () => {
    expect(resolveCanvasMarqueeSelection(["a", "b"], ["b", "c"], "toggle"))
      .toEqual(["a", "c"]);
  });
});
