import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, parseCanvasDocumentV2, type CanvasNodeData } from "@/lib/canvas/document";
import { getCanvasMediaNodeSize } from "@/lib/canvas/media-size";
import { getCanvasTaskResultFrameSize, normalizeCanvasTaskNodeSizes } from "@/lib/canvas/task-references";
import {
  formatCanvasMediaResolution,
  hydrateCanvasMediaDimensions,
  hydrateCanvasTaskOutputDimensions,
} from "@/lib/canvas/media-metadata";

describe("canvas media metadata", () => {
  const settings = { model: "nano-banana-pro", prompt: "", aspectRatio: "auto", resolution: "2K", quality: "", count: 1 };
  const angleTask = (): Extract<CanvasNodeData, { kind: "imageTask" }> => ({ kind: "imageTask", task: {
    settings, references: [], angleSource: { sourceNodeId: "source", url: "/source.png" },
    batches: [{ id: "batch", createdAt: 1, settings, outputs: [{ id: "output", status: "success", url: "/angle.png" }] }],
  } });
  it("repairs square auto-ratio results using original dimensions and persists matching canvas bounds", () => {
    const data = angleTask();
    expect(getCanvasTaskResultFrameSize(data)).toEqual({ width: 350, height: 350 });
    const hydrated = hydrateCanvasTaskOutputDimensions(data, "batch", "output", "/angle.png", 2048, 1136);
    const document = normalizeCanvasTaskNodeSizes({ ...createEmptyCanvasDocumentV2(), nodes: [{ id: "angle", type: "imageTask", position: { x: 0, y: 0 }, width: 350, height: 350, data: hydrated }] });
    const restored = parseCanvasDocumentV2(JSON.parse(JSON.stringify(document)));
    expect(restored.nodes[0]).toMatchObject(getCanvasMediaNodeSize(2048, 1136));
    expect(data.task.batches[0].outputs[0].width).toBeUndefined();
    expect(hydrateCanvasTaskOutputDimensions(hydrated, "batch", "output", "/angle.png", 2048, 1136)).toBe(hydrated);
  });
  it("ignores stale image loads and invalid dimensions", () => {
    const data = angleTask();
    expect(hydrateCanvasTaskOutputDimensions(data, "batch", "output", "/old.png", 2048, 1136)).toBe(data);
    expect(hydrateCanvasTaskOutputDimensions(data, "old-batch", "output", "/angle.png", 2048, 1136)).toBe(data);
    expect(hydrateCanvasTaskOutputDimensions(data, "batch", "output", "/angle.png", NaN, 1136)).toBe(data);
  });
  it("formats stored intrinsic dimensions as a pixel resolution", () => {
    const data: CanvasNodeData = {
      kind: "image",
      url: "/chair.png",
      variants: {
        original: { url: "/chair.png", width: 5483, height: 3060 },
      },
    };

    expect(formatCanvasMediaResolution(data)).toBe("5483 × 3060");
  });

  it("hydrates missing intrinsic dimensions once and preserves existing variants", () => {
    const data: CanvasNodeData = {
      kind: "video",
      url: "/chair.mp4",
      variants: {
        poster: { url: "/chair-poster.jpg" },
      },
    };

    const hydrated = hydrateCanvasMediaDimensions(data, 1920, 1080);

    expect(hydrated).toEqual({
      ...data,
      variants: {
        poster: { url: "/chair-poster.jpg" },
        original: { url: "/chair.mp4", width: 1920, height: 1080 },
      },
    });
    expect(hydrateCanvasMediaDimensions(hydrated, 1920, 1080)).toBe(hydrated);
  });
});
