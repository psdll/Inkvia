import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2, type CanvasNodeData } from "@/lib/canvas/document";
import { duplicateSelection, removeSelection } from "@/lib/canvas/graph";
import { createCanvasHistory, pushCanvasHistory, undoCanvasHistory } from "@/lib/canvas/history";
import { omitPendingCanvasUploads, settleCanvasPendingUpload } from "@/lib/canvas/pending-uploads";

const localUrl = "blob:pending-copy";
const uploaded = {
  status: "success" as const,
  kind: "image" as const,
  url: "/uploads/canvas_imports/1/copy.png",
  mediaId: "d31782e3-d0fb-4aa1-9096-a7d16878cd55",
};

function pendingDocument(kind: "image" | "video" | "audio" = "image"): CanvasDocumentV2 {
  return {
    ...createEmptyCanvasDocumentV2(),
    nodes: [
      { id: "original", type: kind, position: { x: 0, y: 0 }, data: { kind, url: localUrl, name: "source" } },
      { id: "other", type: "image", position: { x: 400, y: 0 }, data: { kind: "image", url: "blob:other-upload" } },
    ],
    edges: [{ id: "connection", source: "original", target: "other", type: "default" }],
  };
}

describe("pending upload copies", () => {
  it.each(["image", "video", "audio"] as const)("settles every %s copy after the original is deleted, including undo history", (kind) => {
    const original = pendingDocument(kind);
    const copied = duplicateSelection(original, ["original"]);
    const current = removeSelection(copied.document, ["original"]);
    const copy = current.nodes.find((node) => copied.selectedIds.includes(node.id))!;
    copy.data = { ...copy.data, name: "renamed copy" } as CanvasNodeData;
    const history = pushCanvasHistory(pushCanvasHistory(createCanvasHistory(original), copied.document), current);

    const settled = settleCanvasPendingUpload(history, current, "original", { ...uploaded, kind }, localUrl);

    expect(settled.document.nodes.some((node) => node.id === "original")).toBe(false);
    expect(settled.document.nodes.find((node) => node.id === copy.id)?.data).toMatchObject({ kind, name: "renamed copy", url: uploaded.url, mediaId: uploaded.mediaId });
    expect(settled.document.nodes.find((node) => node.id === "other")).toBe(current.nodes.find((node) => node.id === "other"));
    expect(JSON.stringify(settled.history)).not.toContain(localUrl);
    expect(undoCanvasHistory(settled.history).present.nodes.find((node) => node.id === "original")?.data).toMatchObject({ url: uploaded.url });
  });

  it("never persists a temporary copy even when its original is absent from the document and pending registry", () => {
    const copied = duplicateSelection(pendingDocument(), ["original", "other"]);
    const current = removeSelection(copied.document, ["original", "other"]);
    const saved = omitPendingCanvasUploads(current, new Set());

    expect(saved.nodes).toEqual([]);
    expect(saved.edges).toEqual([]);
    expect(current.nodes).toHaveLength(2);
  });

  it("removes failed copies and their edges without affecting another pending upload", () => {
    const copied = duplicateSelection(pendingDocument(), ["original"], undefined, { preserveIncomingEdges: true });
    copied.document.edges.push({ id: "copy-edge", source: copied.selectedIds[0], target: "other", type: "default" });
    const history = pushCanvasHistory(createCanvasHistory(pendingDocument()), copied.document);
    const settled = settleCanvasPendingUpload(history, copied.document, "original", { status: "failed" }, localUrl);

    expect(settled.document.nodes.map((node) => node.id)).toEqual(["other"]);
    expect(settled.document.edges).toEqual([]);
    expect(JSON.stringify(settled.history)).not.toContain(localUrl);
  });

  it("settles copied outpaint task references along with their media nodes", () => {
    const original = pendingDocument();
    original.nodes[0].data = { kind: "image", url: localUrl, localPreview: true };
    original.nodes.push({
      id: "task", type: "imageTask", position: { x: 0, y: 400 },
      data: { kind: "imageTask", task: {
        references: [{ id: "ref", url: localUrl, name: "outpaint" }],
        settings: { model: "test", prompt: "keep this prompt", aspectRatio: "auto", resolution: "1K", quality: "auto", count: 1 },
        batches: [],
      } },
    });
    const copied = duplicateSelection(original, ["original", "task"]);
    expect(omitPendingCanvasUploads(copied.document, new Set(["original", "task"])).nodes).toEqual([]);
    const current = removeSelection(copied.document, ["original", "task"]);
    const settled = settleCanvasPendingUpload(createCanvasHistory(current), current, "original", uploaded, localUrl);
    const task = settled.document.nodes.find((node) => node.data.kind === "imageTask")!;

    expect(task.data).toMatchObject({ task: { references: [{ id: "ref", url: uploaded.url, name: "outpaint" }], settings: { prompt: "keep this prompt" } } });
    expect(settled.document.nodes.find((node) => copied.selectedIds.includes(node.id) && node.data.kind === "image")?.data).not.toHaveProperty("localPreview");
    expect(JSON.stringify(settled.history)).not.toContain(localUrl);
  });
});
