import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasNodeData } from "@/lib/canvas/document";
import { replaceCanvasMedia } from "@/lib/canvas/replace-media";
import { getCanvasTaskPrimaryFrameSize } from "@/lib/canvas/task-references";

describe("replace canvas material", () => {
  it("replaces the chosen generated image only and preserves task settings and other results", () => {
    const document = createEmptyCanvasDocumentV2();
    const settings = { model: "test", prompt: "keep", aspectRatio: "9:16", resolution: "2K", quality: "", count: 2 };
    document.nodes = [{ id: "task", type: "imageTask", position: { x: 0, y: 0 }, data: { kind: "imageTask", task: {
      settings, references: [], batches: [{ id: "batch", createdAt: 1, settings, outputs: [
        { id: "a", status: "success", url: "/a.png" }, { id: "b", status: "success", url: "/b.png", generationId: 12 },
      ] }],
    } } }];
    const result = replaceCanvasMedia(document, "task", { kind: "image", url: "/new.png", variants: { original: { url: "/new.png", width: 1600, height: 900 } } }, "b");
    const data = result.nodes[0].data;
    if (data.kind !== "imageTask") throw new Error("wrong kind");
    expect(data.task.settings).toEqual(settings);
    expect(data.task.batches[0].outputs[0].url).toBe("/a.png");
    expect(data.task.batches[0].outputs[1].url).toBe("/new.png");
    expect(data.task.batches[0].outputs[1].generationId).toBeUndefined();
    expect(data.task.batches[0].outputs[1]).toMatchObject({ width: 1600, height: 900 });
    const replaced = replaceCanvasMedia(document, "task", { kind: "image", url: "/wide.png", variants: { original: { url: "/wide.png", width: 1600, height: 900 } } }, "a").nodes[0].data;
    if (replaced.kind !== "imageTask") throw new Error("wrong kind");
    const frame = getCanvasTaskPrimaryFrameSize(replaced);
    expect(frame.width / frame.height).toBeCloseTo(16 / 9, 2);
    expect(replaced.task.settings.aspectRatio).toBe("9:16");
  });
  it("uses replacement image dimensions for an ordinary material frame", () => {
    const document = createEmptyCanvasDocumentV2();
    document.nodes = [{ id: "image", type: "image", position: { x: 0, y: 0 }, width: 350, height: 700, data: { kind: "image", url: "/portrait.png" } }];
    const result = replaceCanvasMedia(document, "image", { kind: "image", url: "/wide.png", variants: { original: { url: "/wide.png", width: 1800, height: 900 } } });
    expect(result.nodes[0].width! / result.nodes[0].height!).toBe(2);
  });
  it("replaces generated video without changing its prompt or parameters", () => {
    const document = createEmptyCanvasDocumentV2();
    document.nodes = [{ id: "task", type: "videoTask", position: { x: 10, y: 20 }, data: {
      kind: "videoTask", status: "success", outputUrl: "/old.mp4", prompt: "keep", model: "test", ratio: "9:16", mediaPaths: ["/ref.png"],
    } }];
    expect(replaceCanvasMedia(document, "task", { kind: "video", url: "/new.mp4" }).nodes[0].data).toMatchObject({
      kind: "videoTask", outputUrl: "/new.mp4", prompt: "keep", model: "test", ratio: "9:16", mediaPaths: ["/ref.png"],
    });
  });
  it.each(["image", "video", "audio"] as const)("replaces only %s material without disturbing workflow configuration", kind => {
    const document = createEmptyCanvasDocumentV2();
    document.nodes = [{ id: "material", type: kind, parentId: "group", position: { x: 50, y: 80 }, width: 350, height: 500,
      data: { kind, url: "/old", name: "原名称", prompt: "原提示词", model: "原模型", origin: "generated", mediaId: "old", variants: { original: { url: "/old" } },
        ...(kind === "video" ? { posterUrl: "/old-poster" } : kind === "audio" ? { waveformPeaks: [1, 2], durationSeconds: 10 } : {}) } as CanvasNodeData },
      { id: "task", type: "videoTask", position: { x: 600, y: 80 }, data: { kind: "videoTask", prompt: "下游提示词", model: "video-model", mediaPaths: [], ratio: "9:16", status: "idle" } }];
    document.edges = [{ id: "in", source: "upstream", target: "material" }, { id: "out", source: "material", target: "task" }];
    const result = replaceCanvasMedia(document, "material", { kind, url: "/new", mediaId: "new" });
    expect(result.edges).toBe(document.edges);
    expect(result.nodes[1]).toBe(document.nodes[1]);
    expect(result.nodes[0]).toMatchObject({ id: "material", parentId: "group", position: { x: 50, y: 80 }, width: 350, height: 500,
      data: { url: "/new", mediaId: "new", prompt: "原提示词", model: "原模型", name: "原名称", origin: "generated" } });
    expect(result.nodes[0].data).not.toHaveProperty("waveformPeaks");
    expect((result.nodes[0].data as any).posterUrl).toBeUndefined();
    expect((result.nodes[0].data as any).variants).toBeUndefined();
    expect((document.nodes[0].data as any).url).toBe("/old");
    expect(() => replaceCanvasMedia(document, "material", { kind: kind === "image" ? "video" : "image", url: "/wrong" })).toThrow("相同类型");
  });
});
