import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import {
  getCanvasImageOutputName,
  getCanvasMediaNodeName,
  getCanvasTaskGeneratedMediaName,
  getNextCanvasMaterialName,
} from "@/lib/canvas/material-name";

const settings = { model: "model", prompt: "prompt", aspectRatio: "1:1", resolution: "2K", quality: "", count: 1 };

function imageTask(id: string, batches: Array<{ id: string; createdAt: number; outputId: string; status: "success" | "failed"; url?: string }>): CanvasNode {
  return {
    id,
    type: "imageTask",
    position: { x: 0, y: 0 },
    data: {
      kind: "imageTask",
      task: {
        references: [],
        settings,
        batches: batches.map((batch) => ({
          id: batch.id,
          createdAt: batch.createdAt,
          settings,
          outputs: [{ id: batch.outputId, status: batch.status, url: batch.url }],
        })),
      },
    },
  };
}

describe("canvas generated material names", () => {
  it("names existing and new angle results 多角度 while preserving explicit output names", () => {
    const node = imageTask("angle", [{ id: "batch", createdAt: 1, outputId: "output", status: "success", url: "/angle.png" }]);
    if (node.data.kind !== "imageTask") throw new Error("Expected image task");
    node.data.task.angleSource = { sourceNodeId: "source", url: "/source.png" };
    const document = { ...createEmptyCanvasDocumentV2(), nodes: [node] };
    expect(getCanvasImageOutputName(document, "angle", "batch", "output")).toBe("多角度");
    node.data.task.batches[0].outputs[0].name = "产品背面";
    expect(getCanvasImageOutputName(document, "angle", "batch", "output")).toBe("产品背面");
  });
  it("numbers legacy and new audio results by completion order like video, preserving custom names", () => {
    const audioTask = (id: string, finishedAt: number, outputName?: string, status: "success" | "failed" = "success"): CanvasNode => ({
      id, type: "audioTask", position: { x: 0, y: 0 },
      data: {
        kind: "audioTask", model: "speech-2.8-hd", prompt: "你好", voiceId: "voice",
        speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0,
        soundEffect: "", status, outputUrl: `/${id}.mp3`, outputName, finishedAt,
      },
    });
    const document = { ...createEmptyCanvasDocumentV2(), nodes: [
      audioTask("new", 200), audioTask("old", 100, "生成音频"),
      audioTask("custom", 300, "产品旁白"), audioTask("failed", 50, undefined, "failed"),
    ] };
    expect(getCanvasTaskGeneratedMediaName(document, "old", "/old.mp3", "audio")).toBe("音频节点1");
    expect(getCanvasTaskGeneratedMediaName(document, "new", "/new.mp3", "audio")).toBe("音频节点2");
    expect(getCanvasTaskGeneratedMediaName(document, "custom", "/custom.mp3", "audio")).toBe("产品旁白");
    expect(getCanvasTaskGeneratedMediaName(document, "failed", "/failed.mp3", "audio")).toBeUndefined();
    expect(document.nodes[1].data).toMatchObject({ outputName: "生成音频" });
  });

  it("does not store a fixed title that overrides generated audio numbering", () => {
    const board = readFileSync("components/canvas/SmartCanvasBoard.tsx", "utf8");
    expect(board).not.toContain('outputName: "生成音频"');
  });

  it("increments successful image outputs by generation time across reruns and tasks", () => {
    const document: CanvasDocumentV2 = {
      ...createEmptyCanvasDocumentV2(),
      nodes: [
        imageTask("task-a", [
          { id: "batch-a1", createdAt: 100, outputId: "output-a1", status: "success", url: "/a1.png" },
          { id: "batch-a2", createdAt: 300, outputId: "output-a2", status: "success", url: "/a2.png" },
        ]),
        imageTask("task-b", [
          { id: "batch-b1", createdAt: 200, outputId: "output-b1", status: "success", url: "/b1.png" },
          { id: "batch-b2", createdAt: 250, outputId: "output-b2", status: "failed" },
        ]),
      ],
    };

    expect(getCanvasImageOutputName(document, "task-a", "batch-a1", "output-a1")).toBe("图片节点1");
    expect(getCanvasImageOutputName(document, "task-b", "batch-b1", "output-b1")).toBe("图片节点2");
    expect(getCanvasImageOutputName(document, "task-a", "batch-a2", "output-a2")).toBe("图片节点3");
    expect(getCanvasImageOutputName(document, "task-b", "batch-b2", "output-b2")).toBeUndefined();
    expect(getNextCanvasMaterialName(document, "image")).toBe("图片节点4");
  });

  it("reuses the latest generated video node name for task preview and the next run", () => {
    const document: CanvasDocumentV2 = {
      ...createEmptyCanvasDocumentV2(),
      nodes: [
        { id: "task", type: "videoTask", position: { x: 0, y: 0 }, data: { kind: "videoTask", model: "model", prompt: "prompt", mediaPaths: [], status: "success", outputUrl: "/v1.mp4" } },
        { id: "result", type: "video", position: { x: 100, y: 0 }, data: { kind: "video", url: "/v1.mp4", name: "视频节点1" } },
        { id: "result-rerun", type: "video", position: { x: 100, y: 100 }, data: { kind: "video", url: "/v1.mp4", name: "视频节点2" } },
      ],
      edges: [
        { id: "edge", source: "task", target: "result" },
        { id: "edge-rerun", source: "task", target: "result-rerun" },
      ],
    };

    expect(getCanvasTaskGeneratedMediaName(document, "task", "/v1.mp4", "video")).toBe("视频节点2");
    expect(getNextCanvasMaterialName(document, "video")).toBe("视频节点3");
  });

  it("continues image numbering for legacy generated child nodes", () => {
    const document: CanvasDocumentV2 = {
      ...createEmptyCanvasDocumentV2(),
      nodes: [
        imageTask("task", [
          { id: "batch", createdAt: 100, outputId: "output", status: "success", url: "/result.png" },
        ]),
        { id: "edited", type: "image", position: { x: 100, y: 0 }, data: { kind: "image", url: "/edited.png", name: "生成结果" } },
      ],
      edges: [{ id: "edge", source: "task", target: "edited" }],
    };

    expect(getCanvasMediaNodeName(document, "edited")).toBe("图片节点2");
    expect(getNextCanvasMaterialName(document, "image")).toBe("图片节点3");
  });

  it("ignores fixed crop labels when numbering regular image nodes", () => {
    const document: CanvasDocumentV2 = {
      ...createEmptyCanvasDocumentV2(),
      nodes: [
        { id: "generated", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/generated.png", name: "图片节点8" } },
        { id: "crop-a", type: "image", position: { x: 100, y: 0 }, data: { kind: "image", url: "/crop-a.png", name: "裁剪" } },
        { id: "crop-c", type: "image", position: { x: 200, y: 0 }, data: { kind: "image", url: "/crop-c.png", name: "裁剪" } },
      ],
    };

    expect(getNextCanvasMaterialName(document, "image")).toBe("图片节点9");
  });
});
