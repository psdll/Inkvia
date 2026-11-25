import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import { duplicateSelection } from "@/lib/canvas/graph";
import { connectCanvasShortcutSelection } from "@/lib/canvas/connection-rules";

const image = (id: string, x = 0, y = 0): CanvasNode => ({ id, type: "image", position: { x, y }, width: 300, height: 600, data: { kind: "image", url: `/${id}.png` } });

describe("canvas shortcut graph actions", () => {
  it("omits connections for Alt copies and retains them for Ctrl+Alt copies", () => {
    const source = { ...createEmptyCanvasDocumentV2(), nodes: [image("a"), image("b")], edges: [{ id: "e", source: "a", target: "b" }] };
    expect(duplicateSelection(source, ["a", "b"], { x: 20, y: 0 }, { copyInternalEdges: false }).document.edges).toHaveLength(1);
    expect(duplicateSelection(source, ["a", "b"]).document.edges).toHaveLength(2);
    expect(duplicateSelection(source, ["b"], { x: 20, y: 0 }, { preserveIncomingEdges: true }).document.edges).toHaveLength(2);
  });

  it("connects exactly two nodes, tries the reverse direction, and rejects duplicate or invalid connections", () => {
    const task: CanvasNode = { id: "task", type: "llm", position: { x: 400, y: 0 }, data: { kind: "llm", prompt: "describe", status: "idle" } };
    const nodes = [image("a"), task, image("b")];
    const forward = connectCanvasShortcutSelection(nodes, [], ["a", "task"], () => "edge");
    expect(forward.edges).toEqual([expect.objectContaining({ source: "a", target: "task" })]);
    expect(connectCanvasShortcutSelection(nodes, [], ["task", "a"], () => "edge").edges).toEqual(forward.edges);
    expect(connectCanvasShortcutSelection(nodes, forward.edges, ["task", "a"], () => "extra").connected).toBe(false);
    expect(connectCanvasShortcutSelection(nodes, [], ["a", "b"], () => "edge").connected).toBe(false);
    expect(connectCanvasShortcutSelection(nodes, [], ["a", "task", "b"], () => "edge").connected).toBe(false);
  });
});
