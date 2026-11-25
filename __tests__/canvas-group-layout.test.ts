import { describe, expect, it, vi } from "vitest";
import type { CanvasDocumentV2, CanvasNode } from "@/lib/canvas/document";
import { createCanvasGroupDragGeometry, fitCanvasGroupBounds, findCanvasGroupDropTargets, findCanvasGroupAtPoint, joinCanvasGroups } from "@/lib/canvas/group-layout";
import { createCanvasHistory, pushCanvasHistory, undoCanvasHistory } from "@/lib/canvas/history";

const node = (id: string, x: number, y: number, parentId?: string): CanvasNode => ({ id, type: "image", position: { x, y }, width: 200, height: 120, parentId, data: { kind: "image", url: `/uploads/${id}.jpg` } });
const group = (id = "g"): CanvasNode => ({ id, type: "group", position: { x: 100, y: 200 }, width: 700, height: 600, data: { kind: "group", title: "分组", collapsed: false } });
const doc = (nodes: CanvasNode[]): CanvasDocumentV2 => ({ schemaVersion: 2, mode: "smart", nodes, edges: [{ id: "ab", source: "a", target: "b" }], viewport: { x: 0, y: 0, zoom: .1 }, settings: { snapToGrid: false, gridSize: 20 } });
const absolute = (nodes: CanvasNode[], id: string): { x: number; y: number } => {
  const n = nodes.find(n => n.id === id)!;
  const p = n.parentId ? absolute(nodes, n.parentId) : { x: 0, y: 0 };
  return { x: n.position.x + p.x, y: n.position.y + p.y };
};

describe("canvas group geometry and membership", () => {
  it.each(["g", "other"])("puts a new connected task into the drop group %s without shrinking it", targetId => {
    const original = doc([group(), { ...group("other"), position: { x: 1200, y: 200 } }, node("a", 80, 100, "g")]);
    const position = { x: targetId === "g" ? 400 : 1500, y: 450 };
    const task: CanvasNode = { id: "task", type: "prompt", position, width: 200, height: 120, data: { kind: "prompt", text: "task" } };
    const inserted = { ...original, nodes: [...original.nodes, task], edges: [{ id: "new-edge", source: "a", target: "task" }] };
    const dropGroup = findCanvasGroupAtPoint(original.nodes, position)!;
    expect(dropGroup).toBe(targetId);
    const next = joinCanvasGroups(inserted, new Map([[task.id, dropGroup]]), true);
    expect(next.nodes.find(n => n.id === "task")?.parentId).toBe(targetId);
    expect(absolute(next.nodes, "task")).toEqual(position);
    expect(absolute(next.nodes, "a")).toEqual(absolute(original.nodes, "a"));
    expect(next.nodes.find(n => n.id === targetId)).toMatchObject({ width: 700, height: 600 });
    expect(next.edges).toBe(inserted.edges);
    expect(undoCanvasHistory(pushCanvasHistory(createCanvasHistory(original), next)).present).toEqual(original);
  });
  it("places external media at the release point even when its center is outside the group", () => {
    const nodes = [group(), node("a", 699, 799)];
    const target = findCanvasGroupAtPoint(nodes, nodes[1].position);
    expect(target).toBe("g");
    const joined = joinCanvasGroups(doc(nodes), new Map([["a", target!]]));
    expect(joined.nodes.find(n => n.id === "a")?.parentId).toBe("g");
    expect(absolute(joined.nodes, "a")).toEqual({ x: 699, y: 799 });
    expect(findCanvasGroupAtPoint(nodes, { x: 801, y: 799 })).toBeUndefined();
  });
  it("finds nested groups in world coordinates and excludes collapsed or hidden ancestors", () => {
    const nested = { ...group("inner"), parentId: "g", position: { x: 40, y: 50 }, width: 200, height: 200 };
    expect(findCanvasGroupAtPoint([group(), nested], { x: 150, y: 260 })).toBe("inner");
    expect(findCanvasGroupAtPoint([{ ...group(), hidden: true }, nested], { x: 150, y: 260 })).toBeUndefined();
    expect(findCanvasGroupAtPoint([{ ...group(), data: { kind: "group", title: "g", collapsed: true } }, nested], { x: 150, y: 260 })).toBeUndefined();
  });
  it.each([500, 2000])("does not rescan %s nodes for twenty moving nodes after gesture setup", total => {
    const nodes = [group(), ...Array.from({ length: total - 1 }, (_, i) => node(`n${i}`, 200, 300))];
    const moving = nodes.slice(1, 21).map(n => n.id);
    const geometry = createCanvasGroupDragGeometry(nodes, moving);
    const find = vi.spyOn(nodes, "find"), filter = vi.spyOn(nodes, "filter"), map = vi.spyOn(nodes, "map");
    const lookup = vi.spyOn(geometry.byId, "get");
    for (let frame = 0; frame < 100; frame++) expect(findCanvasGroupDropTargets(nodes, moving, geometry).size).toBe(20);
    expect(find).not.toHaveBeenCalled(); expect(filter).not.toHaveBeenCalled(); expect(map).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledTimes(4000);
    vi.restoreAllMocks();
  });
  it.each([[-160, 100], [900, 100], [80, -180], [80, 900]])("fits a member moved to %s,%s without moving its siblings", (x, y) => {
    const nodes = [group(), node("a", x, y, "g"), node("b", 380, 320, "g"), node("outside", 1400, 0)];
    const before = nodes.map(n => absolute(nodes, n.id));
    const next = fitCanvasGroupBounds(nodes, ["g"]);
    expect(next.filter(n => n.type !== "group").map(n => absolute(next, n.id))).toEqual(before.slice(1));
    for (const n of next.filter(n => n.parentId === "g")) {
      const g = next[0];
      expect(n.position.x).toBeGreaterThanOrEqual(80);
      expect(n.position.y).toBeGreaterThanOrEqual(100);
      expect(n.position.x + n.width! + 80).toBeLessThanOrEqual(g.width!);
      expect(n.position.y + n.height! + 60).toBeLessThanOrEqual(g.height!);
      expect(n.extent).toBeUndefined();
    }
    expect(next[3]).toBe(nodes[3]);
    expect(fitCanvasGroupBounds(next, ["g"])).toBe(next);
  });

  it("shrinks around moved members and unlocks old constrained groups", () => {
    const nodes = [group(), { ...node("a", 24, 52, "g"), extent: "parent" as const }];
    const next = fitCanvasGroupBounds(nodes);
    expect(next[0]).toMatchObject({ width: 360, height: 280 });
    expect(absolute(next, "a")).toEqual({ x: 124, y: 252 });
    expect(next[1].extent).toBeUndefined();
  });

  it.each(["top-left", "top-right", "bottom-left", "bottom-right"])("restores a frame shrunk away from its members using the %s corner", corner => {
    const original = [group(), node("a", 80, 100, "g"), node("b", 380, 320, "g")];
    const dx = corner.includes("left") ? 600 : 0;
    const dy = corner.includes("top") ? 500 : 0;
    const resized = original.map(n => n.id === "g" ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy }, width: 40, height: 30 } : { ...n, position: { x: n.position.x - dx, y: n.position.y - dy } });
    const fitted = fitCanvasGroupBounds(resized, ["g"], true);
    expect(absolute(fitted, "a")).toEqual(absolute(original, "a"));
    expect(absolute(fitted, "b")).toEqual(absolute(original, "b"));
    expect(fitted[0]).toMatchObject({ position: { x: 100, y: 200 }, width: 660, height: corner.includes("top") ? 530 : 500 });
    expect(fitted.map(n => n.parentId)).toEqual(original.map(n => n.parentId));
  });

  it("keeps deliberate extra space when a resized frame already contains its members", () => {
    const nodes = [group(), node("a", 80, 100, "g")];
    expect(fitCanvasGroupBounds(nodes, ["g"], true)).toBe(nodes);
  });

  it("joins on drop, preserving the landing point, other members and every edge", () => {
    const original = doc([node("outside", 150, 280), group(), node("a", 80, 100, "g"), node("b", 1100, 0)]);
    const targets = findCanvasGroupDropTargets(original.nodes, ["outside"]);
    expect(targets.get("outside")).toBe("g");
    const next = joinCanvasGroups(original, targets);
    expect(next.nodes.find(n => n.id === "outside")?.parentId).toBe("g");
    expect(absolute(next.nodes, "outside")).toEqual({ x: 150, y: 280 });
    expect(absolute(next.nodes, "a")).toEqual(absolute(original.nodes, "a"));
    expect(next.edges).toBe(original.edges);
    expect(next.nodes.findIndex(n => n.id === "g")).toBeLessThan(next.nodes.findIndex(n => n.id === "outside"));
    const history = pushCanvasHistory(createCanvasHistory(original), next);
    expect(undoCanvasHistory(history).present).toEqual(original);
  });

  it("uses node centers and ignores collapsed groups, group drags and current members", () => {
    const nodes = [group(), node("edge", -90, 250), node("a", 80, 100, "g")];
    expect(findCanvasGroupDropTargets(nodes, ["edge", "a", "g"]).size).toBe(0);
    const collapsed = { ...group(), data: { kind: "group" as const, title: "折叠", collapsed: true } };
    expect(findCanvasGroupDropTargets([collapsed, node("new", 200, 300)], ["new"]).size).toBe(0);
  });

  it("adds multiple dropped nodes and updates ancestor bounds without shifting descendants", () => {
    const inner = { ...group("inner"), parentId: "g" };
    const nodes = [group(), inner, node("a", -150, -50, "inner"), node("b", 180, 300), node("c", 390, 450)];
    const fitted = fitCanvasGroupBounds(nodes, ["inner"]);
    expect(absolute(fitted, "a")).toEqual(absolute(nodes, "a"));
    const targets = findCanvasGroupDropTargets([group(), node("b", 180, 300), node("c", 390, 450)], ["b", "c"]);
    expect(targets.size).toBe(2);
    expect(joinCanvasGroups(doc([group(), node("b", 180, 300), node("c", 390, 450)]), targets).nodes.filter(n => n.parentId === "g")).toHaveLength(2);
  });
});
