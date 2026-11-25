import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import { moveCanvasNodeOutOfGroup } from "@/lib/canvas/group-layout";
import { canvasNodeWorldPosition } from "@/lib/canvas/spatial-index";
import { createCanvasHistory, pushCanvasHistory, undoCanvasHistory } from "@/lib/canvas/history";

function node(id: string, x: number, y: number, width: number, height: number, parentId?: string): CanvasNode {
  return { id, type: "prompt", position: { x, y }, width, height, parentId, data: { kind: "prompt", text: id } };
}
function group(id: string, x: number, y: number, width: number, height: number, parentId?: string): CanvasNode {
  return { ...node(id, x, y, width, height, parentId), type: "group", data: { kind: "group", title: id, collapsed: false } };
}
function doc(nodes: CanvasNode[]) { return { ...createEmptyCanvasDocumentV2(), nodes, edges: [{ id: "edge", source: "child", target: "other" }] }; }
function expectClear(nodes: CanvasNode[], id = "child") {
  const moved = nodes.find(n => n.id === id)!;
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const obstacle of nodes.filter(n => n.id !== id)) {
    const p = canvasNodeWorldPosition(obstacle, byId);
    expect(moved.position.x < p.x + obstacle.width! + 40 && moved.position.x + moved.width! + 40 > p.x
      && moved.position.y < p.y + obstacle.height! + 40 && moved.position.y + moved.height! + 40 > p.y).toBe(false);
  }
}
describe("move a member into nearby free canvas space", () => {
  it("places multiple selected members without overlap and undoes the batch in one step", () => {
    const source = doc([group("g", 100, 100, 600, 500), node("child", 10, 200, 100, 100, "g"), node("second", 10, 310, 100, 100, "g"), node("other", 300, 200, 100, 100, "g")]);
    const next = ["child", "second"].reduce((current, id) => moveCanvasNodeOutOfGroup(current, id), source);
    for (const id of ["child", "second"]) {
      expect(next.nodes.find(n => n.id === id)?.parentId).toBeUndefined();
      expectClear(next.nodes, id);
    }
    expect(next.nodes[0]).toBe(source.nodes[0]);
    expect(next.nodes[3]).toBe(source.nodes[3]);
    expect(next.edges).toBe(source.edges);
    expect(undoCanvasHistory(pushCanvasHistory(createCanvasHistory(source), next)).present).toEqual(source);
  });
  it("chooses the nearby left side and preserves connections, siblings, and source document", () => {
    const source = doc([group("g", 100, 100, 600, 500), node("child", 10, 200, 100, 100, "g"), node("other", 300, 200, 100, 100, "g")]);
    const next = moveCanvasNodeOutOfGroup(source, "child");
    expect(next.nodes[1]).toMatchObject({ parentId: undefined, extent: undefined, position: { x: -40, y: 300 } });
    expect(next.edges).toBe(source.edges);
    expect(next.nodes[0]).toBe(source.nodes[0]);
    expect(next.nodes[2]).toBe(source.nodes[2]);
    expect(source.nodes[1].parentId).toBe("g");
    expectClear(next.nodes);
  });
  it("skips neighboring groups and ordinary nodes, even with all four sides obstructed", () => {
    const source = doc([group("g", 0, 0, 600, 600), node("child", 250, 250, 100, 100, "g"),
      group("left", -500, 0, 480, 600), group("right", 620, 0, 400, 600),
      node("above", 0, -400, 600, 380), node("below", 0, 620, 600, 450)]);
    expectClear(moveCanvasNodeOutOfGroup(source, "child").nodes);
  });
  it("resolves nested group positions and leaves every ancestor", () => {
    const source = doc([group("outer", 1000, -500, 1000, 900), group("inner", 100, 100, 500, 500, "outer"), node("child", 20, 200, 100, 100, "inner")]);
    const next = moveCanvasNodeOutOfGroup(source, "child");
    expect(next.nodes[2].parentId).toBeUndefined();
    expectClear(next.nodes);
  });
  it("uses live measured sizes and leaves ungrouped nodes unchanged", () => {
    const source = doc([group("g", 0, 0, 400, 400), node("child", 200, 100, 100, 100, "g")]);
    const measured = new Map([["g", { width: 800, height: 900 }], ["child", { width: 350, height: 250 }]]);
    const next = moveCanvasNodeOutOfGroup(source, "child", measured);
    expectClear(next.nodes.map(n => ({ ...n, ...measured.get(n.id) })));
    expect(moveCanvasNodeOutOfGroup(next, "child")).toBe(next);
    expect(moveCanvasNodeOutOfGroup(source, "missing")).toBe(source);
  });
});
