import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";

function imageNode(id: string, x = 0) {
  return {
    id,
    type: "image" as const,
    position: { x, y: 0 },
    data: { kind: "image" as const, url: `/uploads/${id}.png` },
  };
}

describe("CanvasDocumentV2 three-way merge", () => {
  it("automatically merges non-overlapping node changes", async () => {
    const module = await import("@/lib/canvas/merge").catch(() => ({}));
    const mergeCanvasDocuments = (module as any).mergeCanvasDocuments;
    const base = { ...createEmptyCanvasDocumentV2(), nodes: [imageNode("a")] };
    const local = { ...base, nodes: [imageNode("a", 100)], viewport: { x: 20, y: 30, zoom: 1.5 } };
    const remote = { ...base, nodes: [imageNode("a"), imageNode("b", 300)] };

    expect(mergeCanvasDocuments).toBeTypeOf("function");
    const result = mergeCanvasDocuments(base, local, remote);

    expect(result.conflicts).toEqual([]);
    expect(result.document.nodes).toEqual([imageNode("a", 100), imageNode("b", 300)]);
    expect(result.document.viewport).toEqual(local.viewport);
  });

  it("reports same-entity conflicts and resolves them explicitly", async () => {
    const module = await import("@/lib/canvas/merge");
    const mergeCanvasDocuments = (module as any).mergeCanvasDocuments;
    const resolveCanvasMergeConflicts = (module as any).resolveCanvasMergeConflicts;
    const base = { ...createEmptyCanvasDocumentV2(), nodes: [imageNode("a")] };
    const local = { ...base, nodes: [imageNode("a", 100)] };
    const remote = { ...base, nodes: [imageNode("a", 200)] };

    const result = mergeCanvasDocuments(base, local, remote);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ key: "node:a", entity: "node", id: "a" });
    expect(result.document.nodes).toEqual([imageNode("a", 100)]);

    expect(resolveCanvasMergeConflicts(result, { "node:a": "remote" }).nodes).toEqual([imageNode("a", 200)]);
  });

  it("treats delete-versus-change as a conflict", async () => {
    const { mergeCanvasDocuments } = await import("@/lib/canvas/merge") as any;
    const base = { ...createEmptyCanvasDocumentV2(), nodes: [imageNode("a")] };
    const local = { ...base, nodes: [] };
    const remote = { ...base, nodes: [imageNode("a", 50)] };

    const result = mergeCanvasDocuments(base, local, remote);
    expect(result.conflicts.map((item: any) => item.key)).toEqual(["node:a"]);
  });
});
