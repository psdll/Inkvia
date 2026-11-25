import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import { arrangeGroupChildren } from "@/lib/canvas/graph";
import { createCanvasHistory, pushCanvasHistory, undoCanvasHistory } from "@/lib/canvas/history";

const member = (id: string, x: number, y: number, width = 200, height = 120): CanvasNode => ({
  id, type: "image", parentId: "g", position: { x, y }, width, height,
  data: { kind: "image", url: `/uploads/${id}.png` },
});
const document = (children: CanvasNode[]) => ({
  ...createEmptyCanvasDocumentV2(),
  nodes: [
    { id: "g", type: "group", position: { x: 100, y: 200 }, width: 2400, height: 2000, data: { kind: "group", title: "分组", collapsed: false } } as CanvasNode,
    ...children,
    { ...member("outside", 3000, 0), parentId: undefined },
  ],
  edges: [{ id: "ab", source: "a", target: "b" }],
});
const visualRows = (nodes: CanvasNode[]) => {
  const rows = new Map<number, CanvasNode[]>();
  for (const node of nodes.filter(n => n.parentId === "g")) {
    const row = rows.get(node.position.y) ?? [];
    row.push(node);
    rows.set(node.position.y, row);
  }
  return [...rows].sort(([a], [b]) => a - b).map(([, row]) => row.sort((a, b) => a.position.x - b.position.x).map(n => n.id));
};

describe("group arrange follows the current visual layout", () => {
  it("keeps a single mixed-size row and fits the group to actual material edges", () => {
    const source = document([member("a", 80, 100, 60, 220), member("b", 400, 105, 420, 80), member("c", 1100, 102, 90, 150)]);
    const arranged = arrangeGroupChildren(source, "g");
    expect(visualRows(arranged.nodes)).toEqual([["a", "b", "c"]]);
    const [a, b, c] = ["a", "b", "c"].map(id => arranged.nodes.find(n => n.id === id)!);
    expect(b.position.x - a.position.x - a.width!).toBe(160);
    expect(c.position.x - b.position.x - b.width!).toBe(160);
    expect(arranged.nodes[0].width).toBe(c.position.x + c.width! + 80);
    expect(arranged.nodes[0].height).toBe(a.position.y + a.height! + 60);
    expect(arranged.nodes[0].position).toEqual(source.nodes[0].position);
    expect(arrangeGroupChildren(arranged, "g")).toEqual(arranged);
  });

  it("only repacks existing rows when grid is explicitly requested", () => {
    const source = document(Array.from({ length: 8 }, (_, index) => member(String(index), index < 6 ? index * 400 : (index - 6) * 400, index < 6 ? 100 : 500)));
    expect(visualRows(arrangeGroupChildren(source, "g").nodes).map(row => row.length)).toEqual([6, 2]);
    expect(visualRows(arrangeGroupChildren(source, "g", "grid").nodes).map(row => row.length)).toEqual([3, 3, 2]);
  });
  it("keeps manually swapped nodes in their current rows and left-to-right order", () => {
    const source = document([
      member("a", 500, 100), member("b", 80, 126),
      member("c", 510, 440), member("d", 90, 410),
    ]);
    const before = structuredClone(source);
    const arranged = arrangeGroupChildren(source, "g");
    expect(visualRows(arranged.nodes)).toEqual([["b", "a"], ["d", "c"]]);
    expect(source).toEqual(before);
    expect(arranged.edges).toBe(source.edges);
    expect(arranged.nodes.at(-1)).toBe(source.nodes.at(-1));
    expect(undoCanvasHistory(pushCanvasHistory(createCanvasHistory(source), arranged)).present).toEqual(source);
  });

  it("preserves an 18-node layout with rows of 5, 5, 4, 4 instead of repacking it", () => {
    const ids = [["a", "b", "c", "d", "e"], ["f", "g1", "h", "i", "j"], ["k", "l", "m", "n"], ["o", "p", "q", "r"]];
    const children = ids.flatMap((row, y) => row.map((id, x) => member(id, 80 + x * 380, 100 + y * 320 + x * 2)));
    const arranged = arrangeGroupChildren(document(children.reverse()), "g");
    expect(visualRows(arranged.nodes)).toEqual(ids);
  });

  it("closes empty slots within each existing row", () => {
    const source = document([member("a", 80, 100), member("b", 480, 105), member("c", 880, 95), member("d", 90, 420), member("e", 890, 410)]);
    const arranged = arrangeGroupChildren(source, "g");
    const byId = new Map(arranged.nodes.map(n => [n.id, n]));
    expect(visualRows(arranged.nodes)).toEqual([["a", "b", "c"], ["d", "e"]]);
    expect(byId.get("d")!.position.x).toBe(byId.get("a")!.position.x);
    expect(byId.get("e")!.position.x - (byId.get("d")!.position.x + byId.get("d")!.width!)).toBe(160);
  });

  it("allows mixed media sizes, leaves gaps, and stays stable when arranged again", () => {
    const source = document([member("a", 480, 110, 400, 120), member("b", 80, 100, 220, 480), member("c", 500, 810, 200, 320), member("d", 90, 800, 320, 180)]);
    const arranged = arrangeGroupChildren(source, "g");
    expect(visualRows(arranged.nodes)).toEqual([["b", "a"], ["d", "c"]]);
    const [a, b, c, d] = ["a", "b", "c", "d"].map(id => arranged.nodes.find(n => n.id === id)!);
    expect(a.position.x - (b.position.x + b.width!)).toBe(160);
    expect(c.position.x - (d.position.x + d.width!)).toBe(160);
    expect(c.position.y - (b.position.y + b.height!)).toBe(160);
    expect(arranged.nodes.filter(n => n.parentId === "g").map(n => [n.width, n.height, n.data])).toEqual(source.nodes.filter(n => n.parentId === "g").map(n => [n.width, n.height, n.data]));
    expect(arrangeGroupChildren(arranged, "g")).toEqual(arranged);
  });

  it.each(["horizontal", "vertical"] as const)("uses the current visual order for explicit %s arrangement", layout => {
    const children = layout === "horizontal"
      ? [member("a", 880, 100), member("b", 80, 100), member("c", 480, 100)]
      : [member("a", 80, 880), member("b", 80, 100), member("c", 80, 480)];
    const arranged = arrangeGroupChildren(document(children), "g", layout);
    expect(visualRows(arranged.nodes).flat()).toEqual(["b", "c", "a"]);
  });

  it("never reverses a row when differently sized nodes match earlier column anchors", () => {
    const source = document([member("anchor", 0, 0, 1000, 120), member("a", 280, 400, 80, 120), member("b", 500, 400, 1000, 120)]);
    expect(visualRows(arrangeGroupChildren(source, "g").nodes)).toEqual([["anchor"], ["a", "b"]]);
  });

  it("never pulls a lower node above an existing row because it is taller", () => {
    const source = document([member("anchor", 0, 0, 200, 1000), member("a", 500, 280, 200, 80), member("b", 500, 400, 200, 1000)]);
    expect(visualRows(arrangeGroupChildren(source, "g").nodes)).toEqual([["anchor"], ["a"], ["b"]]);
  });

  it.each(["horizontal", "vertical"] as const)("can return to a grid after %s arrangement", layout => {
    const source = document([member("a", 500, 100), member("b", 80, 100), member("c", 500, 500), member("d", 80, 500)]);
    const linear = arrangeGroupChildren(source, "g", layout);
    const grid = arrangeGroupChildren(linear, "g", "grid");
    expect(visualRows(grid.nodes)).toEqual([["b", "a"], ["d", "c"]]);
    expect(arrangeGroupChildren(grid, "g", "grid")).toEqual(grid);
  });

  it("returns two vertically arranged nodes to one grid row", () => {
    const source = document([member("a", 80, 100), member("b", 480, 100)]);
    const vertical = arrangeGroupChildren(source, "g", "vertical");
    expect(visualRows(arrangeGroupChildren(vertical, "g", "grid").nodes)).toEqual([["a", "b"]]);
  });
});
