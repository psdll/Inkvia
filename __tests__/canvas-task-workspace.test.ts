import { describe, expect, it } from "vitest";
import { buildCanvasTaskMediaInput, collectCanvasTaskAssets, disconnectCanvasEdge, getCanvasTaskFrameSize, getCanvasTaskMediaFrameSize, getCanvasTaskResultFrameSize, hasPendingCanvasTaskUploads, normalizeCanvasTaskNodeSizes, reorderCanvasTaskReferences, syncCanvasTaskAssetChanges } from "@/lib/canvas/task-references";
import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import { getCanvasMediaNodeSize } from "@/lib/canvas/media-size";
import { removeSelection } from "@/lib/canvas/graph";

function fixture(): CanvasDocumentV2 {
  return {
    schemaVersion: 2,
    mode: "smart",
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: { snapToGrid: false, gridSize: 20 },
    nodes: [
      { id: "image-a", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/uploads/a.png", name: "产品正面" } },
      { id: "image-b", type: "image", position: { x: 0, y: 200 }, data: { kind: "image", url: "/uploads/b.png", name: "使用场景" } },
      {
        id: "upstream-task",
        type: "imageTask",
        position: { x: 0, y: 400 },
        data: {
          kind: "imageTask",
          task: {
            references: [],
            settings: { model: "model", prompt: "", aspectRatio: "1:1", resolution: "2K", quality: "", count: 1 },
            batches: [{
              id: "batch",
              createdAt: 1,
              settings: { model: "model", prompt: "", aspectRatio: "1:1", resolution: "2K", quality: "", count: 1 },
              outputs: [{ id: "output", status: "success", url: "/uploads/upstream.png" }],
            }],
          },
        },
      },
      {
        id: "task",
        type: "imageTask",
        position: { x: 500, y: 0 },
        data: {
          kind: "imageTask",
          task: {
            references: [],
            settings: { model: "model", prompt: "", aspectRatio: "9:16", resolution: "2K", quality: "", count: 1 },
            batches: [],
          },
        },
      },
    ],
    edges: [
      { id: "e1", source: "image-a", target: "task" },
      { id: "e2", source: "image-b", target: "task" },
      { id: "e3", source: "upstream-task", target: "task" },
      { id: "e4", source: "image-a", target: "task" },
    ],
  };
}

describe("canvas task workspace helpers", () => {
  it("collects direct connected media and successful task outputs in edge order", () => {
    const assets = collectCanvasTaskAssets(fixture(), "task");

    expect(assets.map((asset) => ({ token: asset.token, url: asset.url, name: asset.name }))).toEqual([
      { token: "图片1", url: "/uploads/a.png", name: "产品正面" },
      { token: "图片2", url: "/uploads/b.png", name: "使用场景" },
      { token: "图片3", url: "/uploads/upstream.png", name: "生成结果" },
    ]);
  });

  it("uses referenceOrder before assigning stable type-local mention tokens", () => {
    const document = fixture();
    const task = document.nodes.find((node) => node.id === "task");
    if (!task || task.data.kind !== "imageTask") throw new Error("missing task fixture");
    task.data.task.referenceOrder = ["image-b", "image-a", "unknown-old-id"];

    const assets = collectCanvasTaskAssets(document, "task");

    expect(assets.map((asset) => asset.id)).toEqual(["image-b", "image-a", "upstream-task:primary"]);
    expect(assets.map((asset) => asset.token)).toEqual(["图片1", "图片2", "图片3"]);
  });

  it("rewrites existing mention tokens when references are reordered", () => {
    const document = fixture();
    const task = document.nodes.find((node) => node.id === "task");
    if (!task || task.data.kind !== "imageTask") throw new Error("missing task fixture");
    task.data.task.settings.prompt = "让 @图片1 靠近 @图片2";

    const reordered = reorderCanvasTaskReferences(document, "task", ["image-b", "image-a", "upstream-task:primary"]);
    const nextTask = reordered.nodes.find((node) => node.id === "task");

    expect(nextTask?.data.kind === "imageTask" ? nextTask.data.task.settings.prompt : "").toBe("让 @图片2 靠近 @图片1");
    expect(nextTask?.data.kind === "imageTask" ? nextTask.data.task.referenceOrder : []).toEqual(["image-b", "image-a", "upstream-task:primary"]);
  });

  it("does not rewrite the prefix of an unknown longer mention during a swap", () => {
    const document = fixture();
    const task = document.nodes.find((node) => node.id === "task")!;
    if (task.data.kind !== "imageTask") throw new Error("missing task fixture");
    task.data.task.settings.prompt = "@图片1 与 @图片3，保留文字 @图片10";
    const next = reorderCanvasTaskReferences(document, "task", ["upstream-task:primary", "image-b", "image-a"]);
    const nextTask = next.nodes.find((node) => node.id === "task")!;
    expect(nextTask.data.kind === "imageTask" && nextTask.data.task.settings.prompt).toBe("@图片3 与 @图片1，保留文字 @图片10");
  });

  it("keeps mixed video references and type-local mentions aligned with submitted media", () => {
    const document = fixture();
    document.nodes = document.nodes.filter((node) => node.id !== "task");
    document.nodes.push(
      { id: "video", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", url: "/uploads/video.mp4" } },
      { id: "audio", type: "audio", position: { x: 0, y: 0 }, data: { kind: "audio", url: "/uploads/audio.mp3" } },
      { id: "task", type: "videoTask", position: { x: 500, y: 0 }, data: { kind: "videoTask", model: "seedance", prompt: "@图片1 参考 @视频1，配 @音频1", mediaPaths: [], status: "idle" } },
    );
    document.edges.push({ id: "video-edge", source: "video", target: "task" }, { id: "audio-edge", source: "audio", target: "task" });
    const next = reorderCanvasTaskReferences(document, "task", ["video", "image-b", "upstream-task:primary", "image-a", "audio"]);
    const task = next.nodes.find((node) => node.id === "task")!;
    if (task.data.kind !== "videoTask") throw new Error("missing task fixture");
    expect(collectCanvasTaskAssets(next, "task").map((asset) => asset.token)).toEqual(["视频1", "图片1", "图片2", "图片3", "音频1"]);
    expect(task.data.prompt).toBe("@图片3 参考 @视频1，配 @音频1");
    const input = buildCanvasTaskMediaInput(next, "task", task.data.prompt);
    expect(input.mediaPaths).toEqual(["/uploads/video.mp4", "/uploads/b.png", "/uploads/upstream.png", "/uploads/a.png", "/uploads/audio.mp3"]);
    expect(input.prompt).toBe("@图片3 参考 @视频1，配 @音频1");
  });

  it("removes stale mention tokens when a connected material node is deleted", () => {
    const document = fixture();
    const task = document.nodes.find((node) => node.id === "task");
    if (!task || task.data.kind !== "imageTask") throw new Error("missing task fixture");
    task.data.task.settings.prompt = "让 @图片1 靠近 @图片2";

    const removed = removeSelection(document, ["image-a"]);
    const next = syncCanvasTaskAssetChanges(document, removed);
    const nextTask = next.nodes.find((node) => node.id === "task");

    expect(nextTask?.data.kind === "imageTask" ? nextTask.data.task.settings.prompt : "").toBe("让  靠近 @图片1");
  });

  it("disconnects exactly one edge and keeps task mention tokens in sync", () => {
    const document = fixture();
    const task = document.nodes.find((node) => node.id === "task");
    if (!task || task.data.kind !== "imageTask") throw new Error("missing task fixture");
    task.data.task.settings.prompt = "保留 @图片1，移除 @图片2，并继续 @图片3";

    const next = disconnectCanvasEdge(document, "e2");
    const nextTask = next.nodes.find((node) => node.id === "task");

    expect(next.edges.map((edge) => edge.id)).toEqual(["e1", "e3", "e4"]);
    expect(nextTask?.data.kind === "imageTask" ? nextTask.data.task.settings.prompt : "").toBe("保留 @图片1，移除 ，并继续 @图片2");
  });

  it("leaves the document untouched when the requested edge no longer exists", () => {
    const document = fixture();

    expect(disconnectCanvasEdge(document, "missing-edge")).toBe(document);
  });

  it("keeps a task pending until its connected upload has a server URL", () => {
    const pending = fixture();
    const image = pending.nodes.find((node) => node.id === "image-a");
    if (!image || image.data.kind !== "image") throw new Error("missing image fixture");
    image.data.url = "blob:local-upload";

    expect(hasPendingCanvasTaskUploads(pending, "task")).toBe(true);

    image.data.url = "/uploads/canvas_imports/1/2026-07-23/image-a.png";
    expect(hasPendingCanvasTaskUploads(pending, "task")).toBe(false);
  });

  it("fits the result frame inside the maximum size while preserving ratio", () => {
    expect(getCanvasTaskFrameSize("9:16", 320)).toEqual({ width: 180, height: 320 });
    expect(getCanvasTaskFrameSize("16:9", 320)).toEqual({ width: 320, height: 180 });
    expect(getCanvasTaskFrameSize("auto", 320)).toEqual({ width: 320, height: 320 });
  });

  it("uses the same visual bounds for uploads, generated results, and pending placeholders", () => {
    for (const [aspectRatio, width, height] of [["16:9", 16, 9], ["3:4", 3, 4], ["9:16", 9, 16]] as const) {
      expect(getCanvasTaskMediaFrameSize(aspectRatio)).toEqual(getCanvasMediaNodeSize(width, height));
    }
  });

  it("keeps task node bounds on the visible result ratio across drag renders", () => {
    const document = fixture();
    const placeholder = document.nodes.find((node) => node.id === "task");
    const completed = document.nodes.find((node) => node.id === "upstream-task");
    if (!placeholder || placeholder.data.kind !== "imageTask" || !completed || completed.data.kind !== "imageTask") {
      throw new Error("missing task fixtures");
    }

    completed.data.task.settings.aspectRatio = "9:16";
    const completedBatch = completed.data.task.batches.at(-1);
    if (!completedBatch) throw new Error("missing completed batch");
    completedBatch.settings.aspectRatio = "16:9";

    expect(getCanvasTaskResultFrameSize(placeholder.data)).toEqual(getCanvasTaskMediaFrameSize("9:16"));
    expect(getCanvasTaskResultFrameSize(completed.data)).toEqual(getCanvasTaskMediaFrameSize("16:9"));
  });

  it("replaces stale task node dimensions with the matching result frame size", () => {
    const document = fixture();
    const staleTask = document.nodes.find((node) => node.id === "task");
    const staleCompletedTask = document.nodes.find((node) => node.id === "upstream-task");
    if (!staleTask || !staleCompletedTask || staleTask.data.kind !== "imageTask" || staleCompletedTask.data.kind !== "imageTask") {
      throw new Error("missing task fixtures");
    }
    staleTask.width = 620;
    staleTask.height = 660;
    staleCompletedTask.width = 620;
    staleCompletedTask.height = 660;

    const normalized = normalizeCanvasTaskNodeSizes(document);
    const placeholder = normalized.nodes.find((node) => node.id === "task");
    const completed = normalized.nodes.find((node) => node.id === "upstream-task");

    expect(placeholder).toMatchObject(getCanvasTaskMediaFrameSize("9:16"));
    expect(completed).toMatchObject(getCanvasTaskMediaFrameSize("1:1"));
  });
});

it("keeps Agent video reference identities and order instead of substituting the latest source output", () => {
  const document = fixture();
  const source = document.nodes.find(node => node.id === "image-a")!;
  const settings = { model: "test", prompt: "", aspectRatio: "1:1", resolution: "1K", quality: "auto", count: 2 };
  source.type = "imageTask"; source.data = { kind: "imageTask", task: { references: [], settings, batches: [{ id: "b", createdAt: 1, settings, primaryOutputId: "latest", outputs: [{ id: "chosen", status: "success", url: "/uploads/chosen.png" }, { id: "latest", status: "success", url: "/uploads/latest.png" }] }] } };
  const target = document.nodes.find(node => node.id === "task")!;
  target.type = "videoTask";
  target.data = { kind: "videoTask", model: "test", prompt: "", status: "running", mediaPaths: ["/uploads/chosen.png"], pinnedReferences: [{ id: "pinned", sourceNodeId: source.id, kind: "image", url: "/uploads/chosen.png", name: "参考图" }] };
  document.edges = [{ id: "ref", source: source.id, target: target.id }];
  expect(collectCanvasTaskAssets(document, target.id).map(asset => asset.url)).toEqual(["/uploads/chosen.png"]);
});
