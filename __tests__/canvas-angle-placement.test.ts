import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import { createCanvasAngleTask } from "@/lib/canvas/creative-presets/create-angle-task";
import { defaultImageAngle } from "@/lib/canvas/creative-presets/angle";
import { CANVAS_LOCAL_UPLOAD_GAP } from "@/lib/canvas/material-placement";
import { canvasNodeWorldPosition } from "@/lib/canvas/spatial-index";

const settings = { model: "gpt-image-2.5-reapi", prompt: "", aspectRatio: "3:4", resolution: "2K", quality: "high", count: 1 };
const source: CanvasNode = { id: "source", type: "image", position: { x: 100, y: 200 }, width: 350, height: 467, data: { kind: "image", url: "/ref.png" } };
function generate(document: CanvasDocumentV2, index: number, aspectRatio = "3:4") {
  return createCanvasAngleTask(document, { sourceId: source.id, url: "/ref.png", angle: defaultImageAngle, settings: { ...settings, aspectRatio }, nodeId: `angle-${index}`, edgeId: `edge-${index}` });
}
function bounds(document: CanvasDocumentV2, node: CanvasNode) {
  return { ...canvasNodeWorldPosition(node, new Map(document.nodes.map(item => [item.id, item]))), width: node.width!, height: node.height! };
}
function expectClear(document: CanvasDocumentV2, node: CanvasNode, obstacles: CanvasNode[]) {
  const a = bounds(document, node), gap = CANVAS_LOCAL_UPLOAD_GAP;
  for (const obstacle of obstacles) {
    const b = bounds(document, obstacle);
    expect(a.x >= b.x + b.width + gap || b.x >= a.x + a.width + gap
      || a.y >= b.y + b.height + gap || b.y >= a.y + a.height + gap, `${node.id} overlaps ${obstacle.id}`).toBe(true);
  }
}

describe("angle output placement", () => {
  it("places repeated outputs in free space using canvas spacing without moving existing nodes", () => {
    let doc = { ...createEmptyCanvasDocumentV2(), nodes: [source] };
    for (let i = 0; i < 12; i++) {
      const before = JSON.stringify(doc);
      const next = generate(doc, i, i % 2 ? "16:9" : "3:4");
      const added = next.nodes.at(-1)!;
      expectClear(next, added, doc.nodes);
      expect(next.nodes.slice(0, -1)).toEqual(doc.nodes);
      expect(JSON.stringify(doc)).toBe(before);
      expect(next.edges.at(-1)).toMatchObject({ source: "source", target: added.id });
      if (i === 0) expect(added.position).toEqual({ x: 600, y: 200 });
      doc = next;
    }
  });
  it("avoids unrelated artwork at the requested location, including nodes in other groups", () => {
    const group: CanvasNode = { id: "other-group", type: "group", position: { x: 550, y: 150 }, width: 800, height: 900, data: { kind: "group", title: "其他素材", collapsed: false } };
    const doc = { ...createEmptyCanvasDocumentV2(), nodes: [source, group, { ...source, id: "other", parentId: group.id, position: { x: 80, y: 100 } }] };
    const next = generate(doc, 0);
    expectClear(next, next.nodes.at(-1)!, doc.nodes);
    expect(next.nodes.slice(0, -1)).toEqual(doc.nodes);
  });
  it("keeps grouped outputs in the source group and preserves existing world positions", () => {
    const outer: CanvasNode = { id: "outer", type: "group", position: { x: 3000, y: -2000 }, width: 1300, height: 1600, data: { kind: "group", title: "外组", collapsed: false } };
    const inner: CanvasNode = { id: "inner", type: "group", parentId: outer.id, position: { x: 80, y: 100 }, width: 700, height: 800, data: { kind: "group", title: "内组", collapsed: false } };
    let doc = { ...createEmptyCanvasDocumentV2(), nodes: [outer, inner, { ...source, parentId: inner.id }] };
    const original = bounds(doc, doc.nodes[2]);
    for (let i = 0; i < 5; i++) {
      const next = generate(doc, i);
      const added = next.nodes.at(-1)!;
      expect(added.parentId).toBe(inner.id);
      expectClear(next, added, next.nodes.filter(node => node.id !== added.id && node.type !== "group"));
      for (const existing of doc.nodes.filter(node => node.type !== "group")) {
        expect(bounds(next, next.nodes.find(node => node.id === existing.id)!)).toEqual(bounds(doc, existing));
      }
      const parent = next.nodes.find(node => node.id === inner.id)!;
      expect(added.position.x + added.width!).toBeLessThanOrEqual(parent.width!);
      expect(added.position.y + added.height!).toBeLessThanOrEqual(parent.height!);
      if (i === 0) expect(bounds(next, added)).toMatchObject({ x: original.x + original.width + CANVAS_LOCAL_UPLOAD_GAP, y: original.y });
      doc = next;
    }
  });
});
