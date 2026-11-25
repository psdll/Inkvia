import { describe, expect, it } from "vitest";
import { parseCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { splitCanvasImageResults } from "@/lib/canvas/image-result-nodes";
import { stackSelection, ungroupSelection } from "@/lib/canvas/graph";
import { collectCanvasTaskAssets } from "@/lib/canvas/task-references";
import { connectCanvasNodeSelection, getCanvasConnectionDecision, getCanvasSelectionConnectionSources } from "@/lib/canvas/connection-rules";

function fixture(count = 2): CanvasDocumentV2 {
  const settings = { model: "test", prompt: "角色设定", aspectRatio: "16:9", resolution: "2K", quality: "standard", count };
  return {
    schemaVersion: 2, mode: "smart", viewport: { x: 0, y: 0, zoom: 1 }, settings: { snapToGrid: false, gridSize: 20 },
    nodes: [
      { id: "reference", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/reference.png", origin: "upload" } },
      { id: "task", type: "imageTask", position: { x: 500, y: 100 }, data: { kind: "imageTask", task: {
        references: [], settings, preset: "characterSheet",
        batches: [{ id: "batch", createdAt: 1, settings, outputs: Array.from({ length: count }, (_, index) => ({ id: `output-${index}`, status: "success", url: `/result-${index}.png`, generationId: index + 1, width: 1600, height: 900 })) }],
      } } },
      { id: "next", type: "videoTask", position: { x: 1200, y: 0 }, data: { kind: "videoTask", prompt: "", model: "video", mediaPaths: [], status: "idle" } },
    ],
    edges: [{ id: "in", source: "reference", target: "task" }, { id: "out", source: "task", target: "next" }],
  };
}

describe("independent multi-image results", () => {
  it.each([2, 4])("splits %s results without grouping, preserving identity, parameters, references and reload", count => {
    const original = fixture(count);
    const split = splitCanvasImageResults(original);
    expect(split.nodes.some(node => node.type === "group")).toBe(false);
    const results = split.nodes.filter(node => node.type === "imageTask");
    expect(results).toHaveLength(count);
    expect(results[0].position).toEqual({ x: 500, y: 100 });
    expect(new Set(results.map(node => `${node.position.x},${node.position.y}`)).size).toBe(count);
    const target = split.nodes.find(node => node.id === "next")!;
    for (const result of results.slice(1)) {
      expect(result.position.x + result.width! <= target.position.x
        || result.position.x >= target.position.x + (target.width ?? 350)
        || result.position.y + result.height! <= target.position.y
        || result.position.y >= target.position.y + (target.height ?? 350)).toBe(true);
    }
    results.forEach((node, index) => {
      expect(node.parentId).toBeUndefined();
      expect(node.hidden).toBeFalsy();
      if (node.data.kind !== "imageTask") throw new Error("Expected image task");
      expect(node.data.task.batches.at(-1)?.outputs).toEqual([expect.objectContaining({ id: `output-${index}`, generationId: index + 1, url: `/result-${index}.png` })]);
      expect(collectCanvasTaskAssets(split, node.id).map(asset => asset.url)).toEqual(["/reference.png"]);
    });
    expect(collectCanvasTaskAssets(split, "next").map(asset => asset.url)).toEqual(Array.from({ length: count }, (_, index) => `/result-${index}.png`));
    expect(splitCanvasImageResults(split)).toBe(split);
    const restored = parseCanvasDocumentV2(JSON.parse(JSON.stringify(split)));
    expect(splitCanvasImageResults(restored)).toBe(restored);
    expect(original.nodes).toHaveLength(3);
  });

  it("uses the existing manual stack and unstack operations, retaining independent and group connections", () => {
    const split = splitCanvasImageResults(fixture());
    const resultIds = split.nodes.filter(node => node.type === "imageTask").map(node => node.id);
    const stacked = stackSelection(split, resultIds);
    const sources = getCanvasSelectionConnectionSources(stacked.document.nodes, [stacked.groupId]);
    expect(getCanvasConnectionDecision(stacked.document.nodes, { source: stacked.groupId, target: "next" }, []).allowed).toBe(true);
    let sequence = 0;
    const connected = connectCanvasNodeSelection(stacked.document.nodes, [], sources.map(node => node.id), "next", () => `new-${sequence++}`);
    expect(connected.connected).toBe(true);
    expect(connected.edges).toHaveLength(2);
    const expanded = ungroupSelection(stacked.document, stacked.groupId);
    expect(expanded.nodes.some(node => node.type === "group")).toBe(false);
    expect(expanded.nodes.filter(node => resultIds.includes(node.id)).every(node => !node.hidden && !node.parentId)).toBe(true);
    expect(splitCanvasImageResults(expanded)).toBe(expanded);
    const single = connectCanvasNodeSelection(expanded.nodes, [], [resultIds[1]], "next", () => "single");
    expect(collectCanvasTaskAssets({ ...expanded, edges: single.edges }, "next").map(asset => asset.url)).toEqual(["/result-1.png"]);
  });

  it("waits for pending outputs and leaves single results alone", () => {
    const single = fixture(1);
    expect(splitCanvasImageResults(single)).toBe(single);
    const pending = fixture();
    const task = pending.nodes[1];
    if (task.data.kind === "imageTask") task.data.task.batches[0].outputs[1].status = "running";
    expect(splitCanvasImageResults(pending)).toBe(pending);
  });

  it.each([2, 3])("retains a failed output for individual retry among %s results", count => {
    const partial = fixture(count);
    const task = partial.nodes[1];
    if (task.data.kind === "imageTask") task.data.task.batches[0].outputs[count - 1] = { id: "failed", status: "failed", error: "失败" };
    const split = splitCanvasImageResults(partial);
    expect(split.nodes.filter(node => node.type === "imageTask")).toHaveLength(count);
    expect(split.nodes.at(-2)?.data).toMatchObject({ task: { batches: [{ outputs: [{ status: "failed", error: "失败" }] }] } });
  });
});
