import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, parseCanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import { duplicateSelection } from "@/lib/canvas/graph";
import { getCanvasImageOutputName, getCanvasMediaDownloadName, getCanvasTaskGeneratedMediaName } from "@/lib/canvas/material-name";

const settings = { model: "", prompt: "", aspectRatio: "1:1", resolution: "1K", quality: "", count: 1 };

describe("copying generated material nodes", () => {
  it("preserves every image result's copy name through saving without renumbering existing results", () => {
    const task: CanvasNode = { id: "task", type: "imageTask", position: { x: 0, y: 0 }, data: { kind: "imageTask", task: {
      references: [], settings,
      batches: Array.from({ length: 7 }, (_, index) => ({ id: `batch-${index}`, createdAt: index + 1, settings, outputs: [{ id: `output-${index}`, status: "success", url: `/result-${index}.png` }] })),
    } } };
    const later: CanvasNode = { ...task, id: "later", data: { kind: "imageTask", task: { references: [], settings, batches: [{ id: "later-batch", createdAt: 20, settings, outputs: [{ id: "later-output", status: "success", url: "/later.png" }] }] } } };
    const original = { ...createEmptyCanvasDocumentV2(), nodes: [task, later] };
    const copied = duplicateSelection(original, [task.id]);
    const saved = parseCanvasDocumentV2(JSON.parse(JSON.stringify(copied.document)));
    for (let index = 0; index < 7; index++) {
      expect(getCanvasImageOutputName(saved, copied.selectedIds[0], `batch-${index}`, `output-${index}`)).toBe(`图片节点${index + 1} - 副本`);
      expect(getCanvasImageOutputName(saved, task.id, `batch-${index}`, `output-${index}`)).toBe(`图片节点${index + 1}`);
    }
    expect(getCanvasImageOutputName(saved, later.id, "later-batch", "later-output")).toBe("图片节点8");
    expect(getCanvasMediaDownloadName({ name: getCanvasImageOutputName(saved, copied.selectedIds[0], "batch-6", "output-6"), kind: "image", url: "/result-6.png" })).toBe("图片节点7 - 副本.png");
  });

  it("preserves a video result's copy name through saving without renumbering other videos", () => {
    const task = { id: "task", type: "videoTask", position: { x: 0, y: 0 }, data: { kind: "videoTask", model: "", prompt: "", mediaPaths: [], status: "success", outputUrl: "/video.mp4", finishedAt: 1 } } satisfies CanvasNode;
    const later: CanvasNode = { ...task, id: "later", data: { ...task.data, finishedAt: 20 } };
    const original = { ...createEmptyCanvasDocumentV2(), nodes: [task, later] };
    const copied = duplicateSelection(original, [task.id]);
    const saved = parseCanvasDocumentV2(JSON.parse(JSON.stringify(copied.document)));
    expect(getCanvasTaskGeneratedMediaName(saved, copied.selectedIds[0], "/video.mp4", "video")).toBe("视频节点1 - 副本");
    expect(getCanvasTaskGeneratedMediaName(saved, task.id, "/video.mp4", "video")).toBe("视频节点1");
    expect(getCanvasTaskGeneratedMediaName(saved, later.id, "/video.mp4", "video")).toBe("视频节点2");
    expect(getCanvasMediaDownloadName({ name: getCanvasTaskGeneratedMediaName(saved, copied.selectedIds[0], "/video.mp4", "video"), kind: "video", url: "/video.mp4" })).toBe("视频节点1 - 副本.mp4");
  });
});
