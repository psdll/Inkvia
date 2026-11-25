import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, parseCanvasDocumentV2, type CanvasNodeData } from "@/lib/canvas/document";
import { getCanvasImageOutputName, getCanvasMediaDownloadName, getCanvasMediaNodeName, getCanvasTaskGeneratedMediaName, renameCanvasNodeData } from "@/lib/canvas/material-name";
import { listCanvasCurrentMaterials } from "@/lib/canvas/current-materials";
import { collectCanvasTaskAssets } from "@/lib/canvas/task-references";
import { collectCanvasTextReferences } from "@/lib/canvas/text-references";
import { getCanvasTextNodeTitle } from "@/lib/canvas/text-node";

const settings = { model: "model", prompt: "", aspectRatio: "1:1", resolution: "2K", quality: "", count: 1 };
const cases: CanvasNodeData[] = [
  { kind: "image", url: "/image.png", name: "old.png" },
  { kind: "video", url: "/video.mp4" },
  { kind: "audio", url: "/audio.mp3" },
  { kind: "imageTask", task: { references: [], settings, batches: [{ id: "batch", createdAt: 1, settings, outputs: [{ id: "out", status: "success", url: "/result.png", name: "old-result" }] }] } },
  { kind: "videoTask", model: "model", prompt: "", mediaPaths: [], status: "success", outputUrl: "/result.mp4", outputName: "old-video" },
  { kind: "audioTask", model: "speech", prompt: "", voiceId: "voice", speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", status: "success", outputUrl: "/result.mp3", outputName: "old-audio" },
  { kind: "prompt", title: "old", text: "文本内容" },
  { kind: "llm", prompt: "", output: "生成内容", status: "success" },
  { kind: "group", title: "old", collapsed: false },
  { kind: "loop", items: [], mode: "serial", concurrency: 1, status: "idle" },
  { kind: "compare", beforeUrl: "/before.png", afterUrl: "/after.png", slider: 0.5 },
];

describe("canvas node rename", () => {
  it.each(cases)("persists $kind names and uses them for materials, references and downloads", data => {
    const renamed = renameCanvasNodeData(data, "  林度正面  ");
    const document = parseCanvasDocumentV2(JSON.parse(JSON.stringify({ ...createEmptyCanvasDocumentV2(), nodes: [
      { id: "source", type: data.kind, position: { x: 0, y: 0 }, data: renamed },
      { id: "target", type: "videoTask", position: { x: 0, y: 0 }, data: { kind: "videoTask", model: "model", prompt: "@图片1", mediaPaths: [], status: "idle" } },
    ], edges: [{ id: "edge", source: "source", target: "target" }] })));
    expect(document.nodes[0].data).toEqual(renamed);
    expect(renameCanvasNodeData(data, "  ")).toBe(data);
    expect(renameCanvasNodeData(renamed, "林度正面")).toBe(renamed);
    const material = listCanvasCurrentMaterials(document.nodes).find(item => item.nodeId === "source");
    if (data.kind === "group" || data.kind === "loop" || data.kind === "compare" || data.kind === "breakdown") return;
    expect(material?.name).toBe("林度正面");
    if (data.kind === "prompt" || data.kind === "llm") {
      expect(getCanvasTextNodeTitle(document, "source")).toBe("林度正面");
      expect(collectCanvasTextReferences(document, "target")[0].name).toBe("林度正面");
      return;
    }
    const asset = collectCanvasTaskAssets(document, "target")[0];
    expect(asset.name).toBe("林度正面");
    const kind = data.kind === "imageTask" ? "image" : data.kind === "videoTask" ? "video" : data.kind === "audioTask" ? "audio" : data.kind;
    const name = data.kind === "imageTask" ? getCanvasImageOutputName(document, "source", "batch", "out")
      : data.kind === "videoTask" || data.kind === "audioTask" ? getCanvasTaskGeneratedMediaName(document, "source", asset.url!, kind)
      : getCanvasMediaNodeName(document, "source");
    expect(name).toBe("林度正面");
    expect(getCanvasMediaDownloadName({ name, url: asset.url!, kind })).toBe(`林度正面.${kind === "image" ? "png" : kind === "video" ? "mp4" : "mp3"}`);
  });

  it("updates configured image references from their source without changing prompt tokens", () => {
    const source = { id: "source", type: "image" as const, position: { x: 0, y: 0 }, data: renameCanvasNodeData(cases[0], "新参考图") };
    const document = { ...createEmptyCanvasDocumentV2(), nodes: [source, {
      id: "target", type: "imageTask" as const, position: { x: 0, y: 0 }, data: { kind: "imageTask" as const, task: { settings, batches: [], references: [{ id: "ref", sourceNodeId: "source", url: "/image.png", name: "旧名称" }] } },
    }] };
    expect(collectCanvasTaskAssets(document, "target")[0]).toMatchObject({ name: "新参考图", token: "图片1", url: "/image.png" });
  });

  it("preserves a custom task name when generation replaces its results", () => {
    const data = renameCanvasNodeData(cases[3], "角色设定");
    if (data.kind !== "imageTask") throw new Error("expected imageTask");
    const document = { ...createEmptyCanvasDocumentV2(), nodes: [{ id: "task", type: "imageTask" as const, position: { x: 0, y: 0 }, data: { ...data, task: { ...data.task, batches: [{ id: "new", createdAt: 2, settings, outputs: [{ id: "new-out", status: "success" as const, url: "/new.webp" }] }] } } }] };
    expect(getCanvasImageOutputName(document, "task", "new", "new-out")).toBe("角色设定");
    expect(getCanvasMediaDownloadName({ name: "角色设定.webp", url: "/new.webp", kind: "image" })).toBe("角色设定.webp");
  });
});
