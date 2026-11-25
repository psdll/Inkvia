import { describe, expect, it } from "vitest";
import {
  filterDeletedGenerationItems,
  filterDeletedToolResults,
  pruneImageBatchOrphanedSuccessItems,
  pruneCanvasDeletedGenerations,
} from "@/lib/generation-deletion";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";

describe("generation deletion projections", () => {
  it("removes only the matching audio task and its edges, preserving a newer result", () => {
    const base = createEmptyCanvasDocumentV2();
    const document = { ...base, nodes: [24, 25].map((id) => ({
      id: `audio-${id}`, type: "audioTask", position: { x: 0, y: 0 },
      data: { kind: "audioTask", generationId: id, status: "success", outputUrl: `/uploads/${id}.mp3` },
    })), edges: [{ id: "audio-edge", source: "audio-24", target: "audio-25" }] } as CanvasDocumentV2;
    expect(pruneCanvasDeletedGenerations(document, [24]).nodes.map((node) => node.id)).toEqual(["audio-25"]);
    expect(pruneCanvasDeletedGenerations(document, [24]).edges).toEqual([]);
    expect(pruneCanvasDeletedGenerations(document, [23])).toBe(document);
  });

  it("hides old successful batch residue without hiding normal pre-generation failures", () => {
    const items = [
      { id: "deleted", outputs: [{ status: "success", generation: null }] },
      { id: "failed-before-create", outputs: [{ status: "failed", generation: null }] },
      { id: "live", outputs: [{ status: "success", generation: { id: 9 } }] },
    ];

    expect(pruneImageBatchOrphanedSuccessItems(items).map((item) => item.id)).toEqual([
      "failed-before-create",
      "live",
    ]);
  });

  it("removes deleted generations from ordinary lists and Agent tool results", () => {
    expect(filterDeletedGenerationItems([{ id: 1 }, { id: "2" }, { id: 3 }], [2, 3])).toEqual([{ id: 1 }]);
    expect(filterDeletedToolResults([
      { name: "create_image_task", data: { generationId: 2 } },
      { name: "create_video_task", data: { generation: { id: 3 } } },
      { name: "list_recent_generations", data: { items: [] } },
    ], [2, 3])).toEqual([{ name: "list_recent_generations", data: { items: [] } }]);
  });

  it("removes a deleted image batch, empty task node, video task node and connected edges", () => {
    const base = createEmptyCanvasDocumentV2();
    const document: CanvasDocumentV2 = {
      ...base,
      nodes: [
        {
          id: "prompt",
          type: "prompt",
          position: { x: 0, y: 0 },
          data: { kind: "prompt", text: "keep" },
        },
        {
          id: "image-task",
          type: "imageTask",
          position: { x: 10, y: 10 },
          data: {
            kind: "imageTask",
            task: {
              references: [],
              settings: { model: "m", prompt: "", aspectRatio: "1:1", resolution: "1K", quality: "", count: 1 },
              batches: [{
                id: "batch-1",
                createdAt: 1,
                settings: { model: "m", prompt: "", aspectRatio: "1:1", resolution: "1K", quality: "", count: 1 },
                outputs: [{ id: "out-1", status: "success", generationId: 22, url: "/old.png" }],
              }],
            },
          },
        },
        {
          id: "video-task",
          type: "videoTask",
          position: { x: 20, y: 20 },
          data: { kind: "videoTask", model: "m", prompt: "", mediaPaths: [], status: "success", generationId: 23, outputUrl: "/old.mp4" },
        },
      ],
      edges: [
        { id: "e1", source: "prompt", target: "image-task" },
        { id: "e2", source: "prompt", target: "video-task" },
      ],
    };

    const next = pruneCanvasDeletedGenerations(document, [22, 23]);

    expect(next.nodes.map((node) => node.id)).toEqual(["prompt"]);
    expect(next.edges).toEqual([]);
  });

  it("keeps an image task node when another historical batch remains", () => {
    const base = createEmptyCanvasDocumentV2();
    const document: CanvasDocumentV2 = {
      ...base,
      nodes: [{
        id: "image-task",
        type: "imageTask",
        position: { x: 0, y: 0 },
        data: {
          kind: "imageTask",
          task: {
            references: [],
            settings: { model: "m", prompt: "", aspectRatio: "1:1", resolution: "1K", quality: "", count: 1 },
            batches: [
              { id: "old", createdAt: 1, settings: { model: "m", prompt: "", aspectRatio: "1:1", resolution: "1K", quality: "", count: 1 }, outputs: [{ id: "a", status: "success", generationId: 31 }] },
              { id: "keep", createdAt: 2, settings: { model: "m", prompt: "", aspectRatio: "1:1", resolution: "1K", quality: "", count: 1 }, outputs: [{ id: "b", status: "success", generationId: 32 }] },
            ],
          },
        },
      }],
    };

    const next = pruneCanvasDeletedGenerations(document, [31]);

    expect(next.nodes).toHaveLength(1);
    expect(next.nodes[0].data.kind === "imageTask" && next.nodes[0].data.task.batches.map((batch) => batch.id)).toEqual(["keep"]);
  });
});
