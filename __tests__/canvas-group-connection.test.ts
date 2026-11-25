import { describe, expect, it } from "vitest";
import { connectCanvasNodeSelection, getCanvasSelectionConnectionSources } from "@/lib/canvas/connection-rules";
import type { CanvasNode } from "@/lib/canvas/document";

const group = (id: string, parentId?: string): CanvasNode => ({ id, parentId, type: "group", position: { x: 0, y: 0 }, data: { kind: "group", title: id, collapsed: true } });
const image = (id: string, parentId?: string): CanvasNode => ({ id, parentId, type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: `/${id}.png` } });
const target: CanvasNode = { id: "target", type: "videoTask", position: { x: 500, y: 0 }, data: { kind: "videoTask", model: "test", prompt: "", mediaPaths: [], status: "idle" } };

describe("selected group connections", () => {
  it("connects group members including collapsed nested groups, without duplicate or outside sources", () => {
    const nodes = [group("group"), image("a", "group"), group("nested", "group"), { ...image("b", "nested"), hidden: true }, image("outside"), target];
    const sources = getCanvasSelectionConnectionSources(nodes, ["group", "a", "nested"]);
    expect(sources.map(node => node.id)).toEqual(["a", "b"]);
    let sequence = 0;
    const result = connectCanvasNodeSelection(nodes, [], sources.map(node => node.id), "target", () => `edge-${++sequence}`);
    expect(result.connected).toBe(true);
    expect(result.edges.map(edge => [edge.source, edge.target])).toEqual([["a", "target"], ["b", "target"]]);
  });

  it("connects a group with only one remaining member and rejects an empty group", () => {
    const nodes = [group("group"), image("a", "group"), target];
    const sources = getCanvasSelectionConnectionSources(nodes, ["group"]);
    expect(connectCanvasNodeSelection(nodes, [], sources.map(node => node.id), "target", () => "edge").edges).toHaveLength(1);
    expect(getCanvasSelectionConnectionSources([group("empty"), image("outside")], ["empty"])).toEqual([]);
    expect(connectCanvasNodeSelection(nodes, [], [], "target", () => "edge").connected).toBe(false);
  });

  it("keeps direct selection scoped to the selected nodes", () => {
    expect(getCanvasSelectionConnectionSources([group("group"), image("a", "group"), image("b", "group")], ["a"]).map(node => node.id)).toEqual(["a"]);
  });
});
