import { describe, expect, it } from "vitest";
import {
  arrangeCanvas,
  DEFAULT_CANVAS_ARRANGE_OPTIONS,
  type CanvasArrangeOptions,
} from "@/lib/canvas/arrangement";
import {
  createEmptyCanvasDocumentV2,
  type CanvasNode,
} from "@/lib/canvas/document";
import {
  createCanvasHistory,
  pushCanvasHistory,
  undoCanvasHistory,
} from "@/lib/canvas/history";

const node = (
  id: string,
  x: number,
  y: number,
  width = 200,
  height = 120,
): CanvasNode => ({
  id,
  type: "prompt",
  position: { x, y },
  width,
  height,
  data: { kind: "prompt", text: id },
});
const document = () => ({
  ...createEmptyCanvasDocumentV2(),
  nodes: [
    node("a", 900, 800, 600, 400),
    node("b", 10, 20),
    node("c", 300, 400, 100, 800),
    node("d", -100, 200),
  ],
  edges: [
    { id: "ab", source: "a", target: "b" },
    { id: "bc", source: "b", target: "c" },
  ],
});
const find = (nodes: CanvasNode[], id: string) =>
  nodes.find((n) => n.id === id)!;
function noOverlap(nodes: CanvasNode[]) {
  const roots = nodes.filter((n) => !n.parentId);
  for (let i = 0; i < roots.length; i++)
    for (let j = i + 1; j < roots.length; j++) {
      const a = roots[i],
        b = roots[j];
      expect(
        a.position.x < b.position.x + b.width! &&
          a.position.x + a.width! > b.position.x &&
          a.position.y < b.position.y + b.height! &&
          a.position.y + a.height! > b.position.y,
      ).toBe(false);
    }
}
describe("canvas arrangement", () => {
  it("tidies mixed groups and nodes by existing rows without changing group contents", () => {
    const group: CanvasNode = { ...node("g", 100, 200, 1000, 700), type: "group", data: { kind: "group", title: "组", collapsed: false } };
    const child = { ...node("child", 80, 100), parentId: "g" };
    const source = { ...createEmptyCanvasDocumentV2(), nodes: [group, child, node("a", 1500, 220, 150, 220), node("b", 140, 1400, 600, 200), node("c", 1100, 1410, 250, 100)], edges: [{ id: "link", source: "a", target: "child" }] };
    const snapshot = structuredClone(source);
    const next = arrangeCanvas(source, { category: "none", layout: "tidy", followConnections: true });
    expect(find(next.nodes, "g").position).toEqual({ x: 100, y: 200 });
    expect(find(next.nodes, "a").position).toEqual({ x: 1220, y: 200 });
    expect(find(next.nodes, "b").position).toEqual({ x: 100, y: 1020 });
    expect(find(next.nodes, "c").position).toEqual({ x: 820, y: 1020 });
    expect(find(next.nodes, "child")).toBe(child);
    expect(next.edges).toBe(source.edges);
    expect(next.nodes.map(n => [n.id, n.width, n.height, n.data])).toEqual(source.nodes.map(n => [n.id, n.width, n.height, n.data]));
    noOverlap(next.nodes);
    expect(arrangeCanvas(next, DEFAULT_CANVAS_ARRANGE_OPTIONS)).toEqual(next);
    expect(source).toEqual(snapshot);
    expect(undoCanvasHistory(pushCanvasHistory(createCanvasHistory(source), next)).present).toEqual(source);
  });
  for (const category of ["none", "connections", "media"] as const)
    for (const layout of ["grid", "horizontal", "vertical"] as const) {
      it(`preserves content, edges and undo while avoiding overlap: ${category}/${layout}`, () => {
        const source = document(),
          snapshot = structuredClone(source);
        const next = arrangeCanvas(source, {
          category,
          layout,
          followConnections: true,
        });
        noOverlap(next.nodes);
        expect(source).toEqual(snapshot);
        expect(next.edges).toBe(source.edges);
        expect(
          next.nodes.map((n) => [n.id, n.data, n.width, n.height]),
        ).toEqual(source.nodes.map((n) => [n.id, n.data, n.width, n.height]));
        expect(
          undoCanvasHistory(
            pushCanvasHistory(createCanvasHistory(source), next),
          ).present,
        ).toEqual(source);
      });
    }
  it("places connected workflow upstream to downstream, with isolated nodes below", () => {
    const next = arrangeCanvas(document(), {
      category: "connections",
      layout: "grid",
      followConnections: false,
    });
    const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => find(next.nodes, id));
    expect(a.position.x).toBeLessThan(b.position.x);
    expect(b.position.x).toBeLessThan(c.position.x);
    expect(d.position.y).toBeGreaterThan(
      Math.max(...[a, b, c].map((n) => n.position.y + n.height!)),
    );
  });
  it("follows upstream vertically when requested", () => {
    const next = arrangeCanvas(document(), {
      category: "none",
      layout: "vertical",
      followConnections: true,
    });
    expect(find(next.nodes, "a").position.y).toBeLessThan(
      find(next.nodes, "b").position.y,
    );
    expect(find(next.nodes, "b").position.y).toBeLessThan(
      find(next.nodes, "c").position.y,
    );
  });
  it("sorts media into lanes regardless of edge direction", () => {
    const source = document();
    source.nodes[0] = {
      ...source.nodes[0],
      type: "video",
      data: { kind: "video", url: "/v.mp4" },
    };
    source.nodes[1] = {
      ...source.nodes[1],
      type: "image",
      data: { kind: "image", url: "/i.png" },
    };
    source.nodes[2] = {
      ...source.nodes[2],
      type: "audio",
      data: { kind: "audio", url: "/a.mp3" },
    };
    const next = arrangeCanvas(source, {
      category: "media",
      layout: "horizontal",
      followConnections: true,
    });
    expect(
      ["b", "a", "c", "d"].map((id) => find(next.nodes, id).position.y),
    ).toEqual(
      [...next.nodes]
        .sort((a, b) => a.position.y - b.position.y)
        .map((n) => n.position.y),
    );
  });
  it("moves a group as a unit and projects descendant connections to the group", () => {
    const source = document();
    const group: CanvasNode = {
      id: "g",
      type: "group",
      position: { x: 800, y: 1000 },
      width: 1200,
      height: 900,
      data: { kind: "group", title: "组", collapsed: false },
    };
    source.nodes = [
      group,
      { ...source.nodes[0], parentId: "g" },
      ...source.nodes.slice(1),
    ];
    const next = arrangeCanvas(source, {
      category: "connections",
      layout: "horizontal",
      followConnections: true,
    });
    expect(find(next.nodes, "a")).toBe(source.nodes[1]);
    expect(find(next.nodes, "g").position.x).toBeLessThan(
      find(next.nodes, "b").position.x,
    );
    noOverlap(next.nodes);
  });
  it("terminates deterministically with cycles and duplicate edges", () => {
    const source = document();
    source.edges.push(
      { id: "ca", source: "c", target: "a" },
      { id: "ab2", source: "a", target: "b" },
    );
    const options: CanvasArrangeOptions = {
      category: "connections",
      layout: "grid",
      followConnections: true,
    };
    const next = arrangeCanvas(source, options);
    expect(arrangeCanvas(source, options)).toEqual(next);
    noOverlap(next.nodes);
  });
  it("leaves empty and single-unit canvases unchanged", () => {
    const empty = createEmptyCanvasDocumentV2();
    expect(arrangeCanvas(empty, DEFAULT_CANVAS_ARRANGE_OPTIONS)).toBe(empty);
    const single = { ...empty, nodes: [node("a", 100, 100)] };
    expect(arrangeCanvas(single, DEFAULT_CANVAS_ARRANGE_OPTIONS)).toBe(single);
  });
});
