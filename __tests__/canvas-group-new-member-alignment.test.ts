import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import { alignNewCanvasGroupMember, joinCanvasGroups, joinAndAlignCanvasGroups, findCanvasGroupDropTargets } from "@/lib/canvas/group-layout";
import { canvasNodeWorldPosition } from "@/lib/canvas/spatial-index";
import { createCanvasHistory, pushCanvasHistory, undoCanvasHistory } from "@/lib/canvas/history";

const member = (id: string, x: number, y: number, width = 200, height = 120): CanvasNode => ({
  id, type: "prompt", parentId: "g", position: { x, y }, width, height, data: { kind: "prompt", text: id },
});
const world = (nodes: CanvasNode[], id: string) => canvasNodeWorldPosition(nodes.find(n => n.id === id)!, new Map(nodes.map(n => [n.id, n])));
function align(children: CanvasNode[], added: CanvasNode) {
  const group: CanvasNode = { id: "g", type: "group", position: { x: 500, y: 300 }, width: 1800, height: 1600, data: { kind: "group", title: "组", collapsed: false } };
  const source = { ...createEmptyCanvasDocumentV2(), nodes: [group, ...children, added], edges: [{ id: "edge", source: children[0]?.id ?? "a", target: added.id }] };
  const snapshot = structuredClone(source);
  const result = alignNewCanvasGroupMember(source, added.id);
  expect(source).toEqual(snapshot);
  expect(result.edges).toBe(source.edges);
  for (const child of children) expect(world(result.nodes, child.id)).toEqual(world(source.nodes, child.id));
  expect(undoCanvasHistory(pushCanvasHistory(createCanvasHistory(source), result)).present).toEqual(source);
  return { result, added: result.nodes.find(n => n.id === added.id)! };
}
describe("align new task to the group's existing layout", () => {
  it.each([1, 2])("aligns %s canvas nodes dropped into a group without disturbing the existing row", count => {
    const group: CanvasNode = { id: "g", type: "group", position: { x: 500, y: 300 }, width: 1800, height: 1200, data: { kind: "group", title: "素材", collapsed: false } };
    const incoming = Array.from({ length: count }, (_, index) => ({ ...member(`drag-${index}`, 1160 + index * 300, 680 + index * 260), parentId: undefined }));
    const source = { ...createEmptyCanvasDocumentV2(), nodes: [group, member("a", 80, 100), member("b", 380, 100), ...incoming], edges: [{ id: "edge", source: "a", target: "drag-0" }] };
    const targets = findCanvasGroupDropTargets(source.nodes, incoming.map(n => n.id));
    expect(targets.size).toBe(count);
    const result = joinAndAlignCanvasGroups(source, targets);
    for (let index = 0; index < count; index++) {
      expect(result.nodes.find(n => n.id === `drag-${index}`)).toMatchObject({ parentId: "g", position: { x: 680 + index * 300, y: 100 } });
    }
    for (const id of ["a", "b"]) expect(world(result.nodes, id)).toEqual(world(source.nodes, id));
    expect(result.edges).toBe(source.edges);
    expect(undoCanvasHistory(pushCanvasHistory(createCanvasHistory(source), result)).present).toEqual(source);
    expect(joinAndAlignCanvasGroups(result, new Map([["a", "g"]]))).toBe(result);
    expect(joinAndAlignCanvasGroups(source, new Map())).toBe(source);
  });
  it.each(["image", "video", "audio"] as const)("aligns an imported %s after joining the drop group, preserving media and siblings", kind => {
    const group: CanvasNode = { id: "g", type: "group", position: { x: 500, y: 300 }, width: 1400, height: 800, data: { kind: "group", title: "素材", collapsed: false, tone: "cyan" } };
    const imported: CanvasNode = { id: "imported", type: kind, position: { x: 1150, y: 550 }, width: 280, height: 180, data: { kind, url: "/uploads/material", mediaId: "material-id", origin: "upload", name: "素材" } };
    const source = { ...createEmptyCanvasDocumentV2(), nodes: [group, member("a", 80, 100), member("b", 380, 100), imported] };
    const placed = alignNewCanvasGroupMember(joinCanvasGroups(source, new Map([[imported.id, group.id]]), true), imported.id);
    const result = placed.nodes.find(n => n.id === imported.id)!;
    expect(result.parentId).toBe("g");
    expect(result.position).toEqual({ x: 680, y: 100 });
    expect(result.data).toBe(imported.data);
    expect(placed.edges).toBe(source.edges);
    for (const id of ["a", "b"]) expect(world(placed.nodes, id)).toEqual(world(source.nodes, id));
    expect(placed.nodes.find(n => n.id === "g")).toMatchObject({ width: 1400, height: 800, data: { tone: "cyan" } });
  });
  it("continues a horizontal row using its existing spacing", () => {
    const { added } = align([member("a", 80, 100), member("b", 380, 100)], member("new", 660, 190));
    expect(added.position).toEqual({ x: 680, y: 100 });
  });
  it("continues a vertical column using its existing spacing", () => {
    const { added } = align([member("a", 80, 100), member("b", 80, 320)], member("new", 190, 580));
    expect(added.position).toEqual({ x: 80, y: 540 });
  });
  it("fills the nearby vacant grid cell", () => {
    const { added } = align([member("a", 80, 100), member("b", 480, 100), member("c", 80, 400)], member("new", 520, 460));
    expect(added.position).toEqual({ x: 480, y: 400 });
  });
  it("continues the existing columns when a grid has no vacant cells", () => {
    const { added } = align([member("a", 80, 100), member("b", 480, 100), member("c", 80, 400), member("d", 480, 400)], member("new", 520, 740));
    expect(added.position).toEqual({ x: 480, y: 700 });
  });
  it("does not force a large task into a gap narrower than its result frame", () => {
    const { result, added } = align([member("a", 80, 100), member("b", 480, 100), member("c", 880, 100), member("d", 80, 400), member("e", 880, 400)], member("new", 480, 400, 600, 300));
    for (const other of result.nodes.filter(n => n.parentId === "g" && n.id !== "new")) {
      expect(added.position.x < other.position.x + other.width! && added.position.x + added.width! > other.position.x
        && added.position.y < other.position.y + other.height! && added.position.y + added.height! > other.position.y).toBe(false);
    }
    expect(added.position.x).toBe(480);
  });
  it("keeps the drop position in an empty group", () => {
    expect(align([], member("new", 320, 250)).added.position).toEqual({ x: 320, y: 250 });
  });
});
