import { describe, expect, it } from "vitest";
import { getBuiltinProviders, mergeSavedProvidersWithBuiltins } from "@/lib/providers/registry";
import { isProviderModelEnabled } from "@/lib/providers/model-availability";
import { supportsProviderModelFetch } from "@/lib/providers/model-fetch";
import { AUDIO_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { createEmptyCanvasDocumentV2, parseCanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import { getCanvasConnectionDecision } from "@/lib/canvas/connection-rules";
import { reorderCanvasTaskReferences } from "@/lib/canvas/task-references";
import { buildCanvasRunStepSubmission } from "@/lib/canvas/run-worker-contract";
import { buildCanvasSeedAudioInput, getCanvasAudioModelReferenceError } from "@/lib/canvas/seed-audio";
import { restoreCanvasAudioModelPreference } from "@/lib/canvas/task-preferences";

const task: CanvasNode = { id: "task", type: "audioTask", position: { x: 0, y: 0 }, data: { kind: "audioTask", model: "seed-audio-1.0", prompt: "@音频1 对 @音频2 说你好", audioFormat: "ogg_opus", sampleRate: 48000, voiceId: "female-shaonv", speed: 1, volume: 1, pitch: 0, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", status: "idle" } };
const audio = (id: string): CanvasNode => ({ id, type: "audio", position: { x: 0, y: 0 }, data: { kind: "audio", url: `/uploads/${id}.mp3`, durationSeconds: 10 } });

describe("Seed Audio canvas integration", () => {
  it("registers an independent speech provider, exact label and capability gating", () => {
    const provider = getBuiltinProviders().find((item) => item.id === "volcengine-speech")!;
    // 同一平台还内置了语音识别模型（Agent 拆解视频用）
    expect(provider).toMatchObject({ baseUrl: "https://openspeech.bytedance.com", enabled: false, audioModels: ["seed-audio-1.0", "doubao-asr-flash"], envKeyName: "", egressMode: "direct" });
    expect(AUDIO_MODEL_DEFINITIONS.find((item) => item.id === "seed-audio-1.0")?.label).toBe("Seed Audio 1.0");
    expect(supportsProviderModelFetch(provider)).toBe(false);
    expect(isProviderModelEnabled([provider], "audio", "seed-audio-1.0")).toBe(false);
    expect(isProviderModelEnabled([{ ...provider, enabled: true }], "audio", "seed-audio-1.0")).toBe(true);
    expect(mergeSavedProvidersWithBuiltins([{ ...provider, enabled: true, audioModels: [] }]).find((item) => item.id === provider.id)).toMatchObject({ enabled: true, audioModels: ["seed-audio-1.0", "doubao-asr-flash"] });
  });
  it("permits Seed references while keeping MiniMax text-only", () => {
    expect(getCanvasConnectionDecision([audio("a"), task], { source: "a", target: "task" }).allowed).toBe(true);
    const minimax = { ...task, data: { ...task.data, model: "speech-2.8-hd" } } as CanvasNode;
    expect(getCanvasConnectionDecision([audio("a"), minimax], { source: "a", target: "task" }).allowed).toBe(false);
  });
  it("persists reordered references and binds direct and worker submissions identically", () => {
    const document = { ...createEmptyCanvasDocumentV2(), nodes: [audio("a"), audio("b"), task], edges: [{ id: "a-task", source: "a", target: "task" }, { id: "b-task", source: "b", target: "task" }] };
    const saved = parseCanvasDocumentV2(reorderCanvasTaskReferences(document, "task", ["b", "a"]));
    const savedTask = saved.nodes.find((node) => node.id === "task")!;
    const direct = buildCanvasSeedAudioInput(saved, "task", (savedTask.data as any).prompt);
    const worker = buildCanvasRunStepSubmission({ nodeKind: "audioTask", node: savedTask, incomingNodes: saved.nodes.filter((node) => node.id !== "task"), incomingEdges: saved.edges });
    expect(direct.text).toBe("@音频2 对 @音频1 说你好");
    expect(direct.references.map((ref) => ref.url)).toEqual(["/uploads/b.mp3", "/uploads/a.mp3"]);
    expect(worker).toMatchObject(direct);
    expect(worker).toMatchObject({ audioFormat: "ogg_opus", sampleRate: 48000 });
    expect((savedTask.data as any).referenceOrder).toEqual(["b", "a"]);
  });
  it("restores valid format/rate combinations and isolates MiniMax preferences", () => {
    const restored = restoreCanvasAudioModelPreference(task.data as any, "seed-audio-1.0", { audio: { byModel: { "seed-audio-1.0": { audioFormat: "ogg_opus", sampleRate: 24000, volume: 8 } } } });
    expect(restored).toMatchObject({ audioFormat: "ogg_opus", sampleRate: 48000, volume: 2 });
    expect(restoreCanvasAudioModelPreference(restored, "speech-2.8-hd", {}).audioFormat).toBeUndefined();
  });
  it("preserves an image connection through persistence, direct generation and worker submission", () => {
    const image: CanvasNode = { id: "image", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/uploads/ref.png" } };
    const document = parseCanvasDocumentV2({ ...createEmptyCanvasDocumentV2(), nodes: [image, task], edges: [{ id: "image-task", source: "image", target: "task" }] });
    expect(getCanvasConnectionDecision([image, task], { source: "image", target: "task" }).allowed).toBe(true);
    const direct = buildCanvasSeedAudioInput(document, "task", "根据图片用温柔的声音说你好");
    const savedTask = document.nodes.find((node) => node.id === "task")!;
    const worker = buildCanvasRunStepSubmission({ nodeKind: "audioTask", node: savedTask, incomingNodes: [image], incomingEdges: document.edges });
    expect(direct.references).toEqual([{ kind: "image", url: "/uploads/ref.png" }]);
    expect(worker).toMatchObject({ model: "seed-audio-1.0", references: direct.references });
  });
  it("keeps Seed selectable with images and disables both MiniMax models until references are removed", () => {
    const image: CanvasNode = { id: "image", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url: "/uploads/ref.png" } };
    expect(getCanvasAudioModelReferenceError("seed-audio-1.0", [{ kind: "image" }])).toBeNull();
    for (const model of ["speech-2.8-hd", "speech-2.8-turbo"]) {
      expect(getCanvasAudioModelReferenceError(model, [{ kind: "image" }])).toBe("该模型不支持图片参考");
      expect(getCanvasAudioModelReferenceError(model, [])).toBeNull();
      const node = { ...task, data: { ...task.data, model } } as CanvasNode;
      expect(() => buildCanvasRunStepSubmission({ nodeKind: "audioTask", node, incomingNodes: [image], incomingEdges: [{ id: "edge", source: "image", target: "task" }] })).toThrow("不支持图片");
    }
  });
});
