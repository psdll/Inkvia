import { describe, expect, it } from "vitest";
import type { CanvasDocumentV2, CanvasNodeData } from "@/lib/canvas/document";
import { disconnectCanvasEdge, syncCanvasTaskAssetChanges, syncCanvasTaskPromptsWithEdges } from "@/lib/canvas/task-references";
import { normalizeCanvasVideoTaskForModel } from "@/lib/canvas/task-preferences";
import { sora2Models } from "@/lib/sora2";

type VideoTask = Extract<CanvasNodeData, { kind: "videoTask" }>;
const taskData = (model: string, inputMode = "multimodal"): VideoTask => ({
  kind: "videoTask", model, inputMode, prompt: "测试视频", mediaPaths: [], status: "idle",
  resolution: "720p", ratio: "16:9", duration: 5,
});
function fixture(model: string, inputMode = "text_to_video"): CanvasDocumentV2 {
  return {
    schemaVersion: 2, mode: "smart", viewport: { x: 0, y: 0, zoom: 1 },
    settings: { snapToGrid: false, gridSize: 20 },
    nodes: [
      ...(["image", "video", "audio"] as const).map(kind => ({
        id: kind, type: kind, position: { x: 0, y: 0 }, data: { kind, url: `/uploads/${kind}.${kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3"}` },
      })),
      { id: "text", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "提示词" } },
      { id: "task", type: "videoTask", position: { x: 500, y: 0 }, data: taskData(model, inputMode) },
    ], edges: [],
  };
}
const videoData = (document: CanvasDocumentV2) => document.nodes.find(node => node.id === "task")!.data as VideoTask;
const edge = (source: string) => ({ id: source, source, target: "task" });

it.each(["image", "video", "audio"])("uses first frame for MiniMax-H3-Max when connecting %s", kind => {
  const connected = syncCanvasTaskPromptsWithEdges(fixture("minimax-h3-max"), [edge(kind)]);
  expect(videoData(connected)).toMatchObject({ inputMode: "first_frame", ratio: "adaptive" });
  expect(videoData(disconnectCanvasEdge(connected, kind))).toMatchObject({ inputMode: "text_to_video", ratio: "9:16" });
});

it.each(["doubao-seedance-2-5-260628", "seedance-2.5-apimart"])("clears the editing submode and keeps a valid duration for %s after disconnecting", model => {
  const document = fixture(model, "multimodal");
  Object.assign(videoData(document), { omniReferenceTaskType: "edit", duration: -1 });
  document.edges = [edge("video")];
  const result = videoData(disconnectCanvasEdge(document, "video"));
  expect(result.inputMode).toBe("text_to_video");
  expect(result.omniReferenceTaskType).toBe("auto");
  if (sora2Models.find(spec => spec.id === model)!.allowAutoDuration) expect(result.duration).toBe(-1);
  else expect(result.duration).toBeGreaterThan(0);
});

it("keeps configured local references active until they are removed too", () => {
  const document = fixture("minimax-h3", "multimodal");
  videoData(document).mediaPaths = ["/uploads/reference.png"];
  document.edges = [edge("image")];
  const disconnected = disconnectCanvasEdge(document, "image");
  expect(videoData(disconnected).inputMode).toBe("multimodal");
  const removed = { ...disconnected, nodes: disconnected.nodes.map(node => node.id === "task" ? { ...node, data: { ...videoData(disconnected), mediaPaths: [] } } : node) };
  expect(videoData(syncCanvasTaskAssetChanges(disconnected, removed)).inputMode).toBe("text_to_video");
});

describe.each(sora2Models.filter(spec => spec.supportedInputModes.includes("text_to_video")))("$id canvas input mode", spec => {
  it("uses text mode for an empty task even when the previous preference was reference mode", () => {
    const result = normalizeCanvasVideoTaskForModel(taskData(spec.id), spec.id, spec, false);
    expect(result.inputMode).toBe("text_to_video");
  });
});

describe.each(sora2Models.filter(spec => spec.supportedInputModes.includes("multimodal") && spec.supportedInputModes.includes("text_to_video")))("$id reference connections", spec => {
  it.each(["image", "video", "audio"])("switches to omni reference when %s is connected and back after disconnecting", kind => {
    const connected = syncCanvasTaskPromptsWithEdges(fixture(spec.id), [edge(kind)]);
    expect(videoData(connected).inputMode).toBe("multimodal");
    expect(videoData(disconnectCanvasEdge(connected, kind)).inputMode).toBe("text_to_video");
  });
  it("stays in reference mode until the final media edge is removed, ignoring text edges", () => {
    const connected = syncCanvasTaskPromptsWithEdges(fixture(spec.id), [edge("image"), edge("audio"), edge("text")]);
    const partial = disconnectCanvasEdge(connected, "image");
    expect(videoData(partial).inputMode).toBe("multimodal");
    expect(videoData(disconnectCanvasEdge(partial, "audio")).inputMode).toBe("text_to_video");
  });
  it("does not count a text-only connection as reference media", () => {
    expect(videoData(syncCanvasTaskPromptsWithEdges(fixture(spec.id, "multimodal"), [edge("text")])).inputMode).toBe("text_to_video");
  });
  it("preserves a manual frame selection until another media source is connected", () => {
    const document = fixture(spec.id, "first_frame");
    document.edges = [edge("image")];
    expect(videoData(syncCanvasTaskPromptsWithEdges(document, [...document.edges, edge("text")])).inputMode).toBe("first_frame");
    expect(videoData(syncCanvasTaskPromptsWithEdges(document, [...document.edges, edge("audio")])).inputMode).toBe("multimodal");
  });
  it("normalizes a saved text mode when switching models with connected media", () => {
    expect(normalizeCanvasVideoTaskForModel(taskData(spec.id, "text_to_video"), spec.id, spec, true).inputMode).toBe("multimodal");
  });
  it("counts a connected video task before its output is ready", () => {
    const document = fixture(spec.id);
    document.nodes.push({ id: "upstream", type: "videoTask", position: { x: 0, y: 0 }, data: taskData(spec.id) });
    expect(videoData(syncCanvasTaskPromptsWithEdges(document, [edge("upstream")])).inputMode).toBe("multimodal");
  });
  it("switches back when a referenced node is deleted", () => {
    const document = fixture(spec.id, "multimodal");
    document.edges = [edge("image")];
    const removed = { ...document, nodes: document.nodes.filter(node => node.id !== "image"), edges: [] };
    expect(videoData(syncCanvasTaskAssetChanges(document, removed)).inputMode).toBe("text_to_video");
  });
});
