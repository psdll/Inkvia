import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { getCreativeAgentSelection, mergeCreativeAgentReferences, creativeAgentReferenceKey } from "@/lib/creative-agent/canvas-selection";

const doc = (): CanvasDocumentV2 => ({ ...createEmptyCanvasDocumentV2(), nodes: [
 { id: "image", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/a.png", mediaId: "media-a", name: "参考图" } },
 { id: "task", type: "imageTask", position: { x: 100, y: 0 }, data: { kind: "imageTask", title: "角色图", task: { references: [], settings: { model: "test", prompt: "test", aspectRatio: "1:1", resolution: "2K", count: 1, quality: "" }, batches: [
 { id: "batch-1", createdAt: 1, settings: {} as any, primaryOutputId: "output-2", outputs: [
  { id: "output-1", status: "success", url: "/one.png" }, { id: "output-2", status: "success", url: "/two.png", mediaId: "media-two" },
 ] }, { id: "pending", createdAt: 2, settings: {} as any, outputs: [{ id: "pending-output", status: "running" }] },
 ] } } },
 ], edges: [{ id: "e", source: "image", target: "task" }] });

describe("Agent canvas selection", () => {
 it("offers every successful output when resolving a result reference and preserves two outputs of one node", () => {
  const refs = getCreativeAgentSelection(57, doc(), ["task"], [], true).references;
  expect(refs.map(ref => ref.outputId)).toEqual(["output-1", "output-2"]);
  expect(creativeAgentReferenceKey(refs[0])).not.toBe(creativeAgentReferenceKey(refs[1]));
  expect(mergeCreativeAgentReferences([refs[1]], [refs[0], refs[1], refs[0]])).toEqual(refs);
 });
 it("fixes the selected output to concrete primary batch/output/media IDs", () => {
  const selection = getCreativeAgentSelection(57, doc(), ["task", "image"], ["e"]);
  expect(selection.nodeIds).toEqual(["task", "image"]);
  expect(selection.references).toMatchObject([
   { canvasId: 57, nodeId: "task", label: "角色图", batchId: "batch-1", outputId: "output-2", mediaId: "media-two" },
   { canvasId: 57, nodeId: "image", mediaId: "media-a" },
  ]);
 });
 it("drops deleted/duplicate IDs and is stable when document order changes", () => {
  const current = doc();
  const before = getCreativeAgentSelection(57, current, ["task", "missing", "task", "image"], ["e", "missing", "e"]);
  current.nodes.reverse();
  expect(getCreativeAgentSelection(57, current, ["task", "image"], ["e"])).toEqual(before);
  expect(before.edgeIds).toEqual(["e"]);
 });
 it("does not mutate the captured output identity when the primary later changes", () => {
  const current = doc(), selection = getCreativeAgentSelection(57, current, ["task"], []);
  (current.nodes[1].data as any).task.batches[0].primaryOutputId = "output-1";
  expect(selection.references[0].outputId).toBe("output-2");
  expect(getCreativeAgentSelection(57, current, ["task"], []).references[0].outputId).toBe("output-1");
 });
});

describe("Agent reference thumbnails", () => {
 it.each(["empty", "running", "failed", "success-without-url"])("does not offer an %s task or use its connected input as an output", async status => {
  const { getReferencePreview } = await import("@/components/creative-agent/reference-preview");
  const current = doc();
  (current.nodes[1].data as any).task.batches = status === "empty" ? [] : [{ id: "batch", outputs: [{ id: "output", status: status === "success-without-url" ? "success" : status }] }];
  const selection = getCreativeAgentSelection(57, current, ["image", "task"], []);
  expect(selection.nodeIds).toEqual(["image", "task"]);
  expect(selection.references.map(ref => ref.nodeId)).toEqual(["image"]);
  const taskRef = { canvasId: 57, nodeId: "task", label: "角色图", kind: "imageTask" };
  expect(getReferencePreview(current, taskRef)).toBeUndefined();
  (current.nodes[0].data as any).url = "/updated.png";
  expect(getReferencePreview(current, selection.references[0])?.url).toBe("/updated.png");
  expect(getReferencePreview(current, taskRef)).toBeUndefined();
  (current.nodes[1].data as any).task.batches = [{ id: "generated", outputs: [{ id: "result", status: "success", url: "/generated.png" }] }];
  const ready = getCreativeAgentSelection(57, current, ["image", "task"], []).references;
  expect(ready[1]).toMatchObject({ batchId: "generated", outputId: "result" });
  expect(getReferencePreview(current, ready[1])?.url).toBe("/generated.png");
 });
 it.each(["videoTask", "audioTask"] as const)("only offers a %s after it has its own successful media output", async kind => {
  const { getReferencePreview } = await import("@/components/creative-agent/reference-preview");
  const current = doc();
  current.nodes[1] = { ...current.nodes[1], type: kind, data: { kind, status: "idle", mediaPaths: ["/a.png"] } } as CanvasDocumentV2["nodes"][number];
  const data = current.nodes[1].data as any;
  const reference = { canvasId: 57, nodeId: "task", kind, label: "生成任务" };
  for (const status of ["idle", "running", "failed", "success"]) {
   data.status = status;
   expect(getCreativeAgentSelection(57, current, ["task"], []).references).toEqual([]);
   expect(getReferencePreview(current, reference)).toBeUndefined();
  }
  data.outputUrl = kind === "videoTask" ? "/generated.mp4" : "/generated.mp3";
  data.requestKey = "generated";
  const ready = getCreativeAgentSelection(57, current, ["task"], []).references;
  expect(ready[0]).toMatchObject({ outputId: "generated" });
  expect(getReferencePreview(current, ready[0])?.url).toBe(data.outputUrl);
  data.status = "failed";
  expect(getCreativeAgentSelection(57, current, ["task"], []).references).toEqual([]);
  expect(getReferencePreview(current, ready[0])).toBeUndefined();
 });
 it("keeps the selected output preview frozen while new selections use the latest primary", async () => {
  const { getReferencePreview } = await import("@/components/creative-agent/reference-preview");
  const current = doc();
  const frozen = getCreativeAgentSelection(57, current, ["task"], []).references[0];
  (current.nodes[1].data as any).task.batches[0].primaryOutputId = "output-1";
  expect(getReferencePreview(current, frozen)?.url).toBe("/two.png");
  const fresh = getCreativeAgentSelection(57, current, ["task"], []).references[0];
  expect(getReferencePreview(current, fresh)?.url).toBe("/one.png");
  (current.nodes[1].data as any).task.batches = [];
  expect(getReferencePreview(current, frozen)).toBeUndefined();
 });
});
