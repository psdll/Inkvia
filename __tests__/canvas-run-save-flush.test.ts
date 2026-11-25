import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2, type CanvasNodeData } from "@/lib/canvas/document";
import { canvasInternalNode } from './helpers/canvas-runtime-harness';

const state = vi.hoisted(() => ({ props: null as any, editor: null as any, context: null as any, submit: vi.fn(), submitAudio: vi.fn(), submitImage: vi.fn(), wait: vi.fn(), audioNodeIds: [] as string[] }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/canvas/use-canvas-models", () => ({ useCanvasModels: () => null, resolveCanvasModelId: () => "test-model" }));
vi.mock("@/lib/client/inflight-json", () => ({ fetchJsonOnce: async () => ({ ok: true, json: { success: true, items: [] } }) }));
vi.mock("@/components/canvas/CanvasViewportChrome", () => ({ CanvasViewportChrome: () => null }));
vi.mock("@/components/canvas/CanvasAudioPlayback", () => ({ CanvasAudioPlaybackProvider: ({ children, nodeIds }: any) => { state.audioNodeIds = nodeIds; return children; } }));
vi.mock("@/lib/canvas/audio-waveform", () => ({ analyzeAudioUrlCached: () => new Promise(() => {}) }));
vi.mock("@/components/canvas/CanvasMediaPrefetch", () => ({ CanvasMediaPrefetch: () => null }));
vi.mock("@/components/canvas/CanvasNodeCard", async () => {
  const React = await import("react"); state.context = React.createContext(null);
  return { CanvasNodeCard: () => null, CanvasNodeEditorContext: state.context };
});
vi.mock("@/components/canvas/run-node", () => ({
  CANVAS_GENERATION_FOREGROUND_WAIT_MS: 1000, shouldResumeCanvasGeneration: () => false,
  submitVideoGen: state.submit, submitAudioGen: state.submitAudio, submitImageGen: state.submitImage, waitForGenerationResult: state.wait,
  waitForGenerationOutputs: async (...args: any[]) => {
    const value = await state.wait(...args);
    return Array.isArray(value) ? value : [{ url: value }];
  },
}));
vi.mock("@xyflow/react", async original => {
  const actual = await original<typeof import("@xyflow/react")>(); const React = await import("react");
  const flow = {
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }), getZoom: () => 1,
    setViewport: vi.fn(), fitView: vi.fn(),
    screenToFlowPosition: (point: any) => point, flowToScreenPosition: (point: any) => point,
    getNodes: () => state.props.nodes, getNode: (id: string) => state.props.nodes.find((node: any) => node.id === id),
    getInternalNode: (id: string) => canvasInternalNode(state.props?.nodes, id),
    getNodesBounds: actual.getNodesBounds,
  };
  return { ...actual,
    useReactFlow: () => flow, useStore: (selector: any) => selector({ transform: [0, 0, 1] }),
    useStoreApi: () => ({ getState: () => ({ transform: [0, 0, 1] }), setState: vi.fn() }),
    ReactFlowProvider: ({ children }: any) => children,
    ReactFlow: (props: any) => { state.props = props; state.editor = React.useContext(state.context); return React.createElement("div", null, props.children); },
    Panel: ({ children }: any) => children, ViewportPortal: ({ children }: any) => children,
  };
});
import SmartCanvasBoard from "@/components/canvas/SmartCanvasBoard";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  state.submit.mockReset().mockResolvedValue({ generationId: 1 });
  state.submitAudio.mockReset().mockResolvedValue({ generationId: 2, url: "/new.mp3", durationSeconds: 8 });
  state.submitImage.mockReset().mockResolvedValue({ generationId: 3 });
  state.wait.mockReset().mockResolvedValue("/test-output.mp4");
  state.audioNodeIds = [];
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function mount(onChange: (document: CanvasDocumentV2) => void, onBeforeServerRun: () => Promise<string>, data: CanvasNodeData = { kind: "videoTask", model: "test-model", prompt: "old", mediaPaths: [], status: "idle" }) {
  await act(async () => root.render(React.createElement(SmartCanvasBoard, {
    canvasId: 57, editorSessionId: "test-session", preferenceOwnerId: "guest", onChange, onBeforeServerRun,
    initial: { ...createEmptyCanvasDocumentV2(), nodes: [{ id: "video", type: data.kind, position: { x: 0, y: 0 }, data }] },
  })));
}
describe("generation flushes the board's throttled changes", () => {
  it.each(["imageTask", "videoTask", "audioTask"] as const)("starts a fresh %s request after moderation failure without retaining the failed generation ID", async kind => {
    const data: CanvasNodeData = kind === "imageTask"
      ? { kind, task: { references: [], settings: { model: "test-model", prompt: "test", count: 1, aspectRatio: "1:1", resolution: "2K", quality: "" }, batches: [] } }
      : kind === "videoTask"
        ? { kind, model: "test-model", prompt: "test", mediaPaths: [], status: "idle" }
        : { kind, model: "speech-2.8-hd", prompt: "test", voiceId: "female-shaonv", speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", status: "idle" };
    const submit = kind === "imageTask" ? state.submitImage : kind === "videoTask" ? state.submit : state.submitAudio;
    submit.mockResolvedValueOnce({ generationId: 101 });
    state.wait.mockRejectedValueOnce(new Error("生成内容未通过平台审核。"));
    await mount(() => {}, async () => "2", data);
    const current = () => {
      const value = state.props.nodes[0].data;
      return kind === "imageTask" ? value.task.batches.at(-1).outputs[0] : value;
    };
    await act(async () => { expect(await state.editor.runNode("video")).toBe(false); });
    expect(current()).toMatchObject({ status: "failed", generationId: 101, error: "生成内容未通过平台审核。" });
    let resolveSubmission!: (value: { generationId: number }) => void;
    submit.mockImplementationOnce(() => new Promise(resolve => { resolveSubmission = resolve; }));
    let retry!: Promise<boolean>;
    await act(async () => { retry = state.editor.runNode("video"); });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0].requestKey).not.toBe(submit.mock.calls[0][0].requestKey);
    expect(current().status).toBe("submitting");
    // Resolve before assertions so a failed regression does not leave a pending run.
    const pending = { ...current() };
    await act(async () => { resolveSubmission({ generationId: 102 }); expect(await retry).toBe(true); });
    expect(pending.generationId).toBeUndefined();
    expect(pending.error).toBeUndefined();
    expect(current()).toMatchObject({ status: "success", generationId: 102 });
  });

  it("replaces the video without carrying the previous media identity or poster into the new result", async () => {
    await mount(() => {}, async () => "2", {
      kind: "videoTask", model: "test-model", prompt: "again", mediaPaths: [], status: "success",
      outputUrl: "/old.mp4", mediaId: "old-media", variants: { original: { url: "/old.mp4" }, poster: { url: "/old-poster.png" } },
    });
    await act(async () => { expect(await state.editor.runNode("video")).toBe(true); });
    const data = state.props.nodes[0].data;
    expect(data).toMatchObject({ status: "success", outputUrl: "/test-output.mp4" });
    expect(data.mediaId).toBeUndefined();
    expect(data.variants).toBeUndefined();
  });

  it("stops retaining the old audio during regeneration and clears its waveform on success", async () => {
    let resolveSubmission!: (result: unknown) => void;
    state.submitAudio.mockReturnValue(new Promise(resolve => { resolveSubmission = resolve; }));
    await mount(() => {}, async () => "2", {
      kind: "audioTask", model: "speech-2.8-hd", prompt: "again", voiceId: "female-shaonv",
      speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "",
      status: "success", outputUrl: "/old.mp3", waveformPeaks: [.2, .7], durationSeconds: 12,
    });
    expect(state.audioNodeIds).toEqual(["video"]);
    let run!: Promise<boolean>;
    await act(async () => { run = state.editor.runNode("video"); });
    expect(state.props.nodes[0].data.status).toBe("submitting");
    expect(state.audioNodeIds).toEqual([]);
    await act(async () => {
      resolveSubmission({ generationId: 2, url: "/new.mp3", durationSeconds: 8 });
      expect(await run).toBe(true);
    });
    expect(state.props.nodes[0].data).toMatchObject({ status: "success", outputUrl: "/new.mp3", durationSeconds: 8 });
    expect(state.props.nodes[0].data.waveformPeaks).toBeUndefined();
    expect(state.audioNodeIds).toEqual(["video"]);
  });

  it("submits a video generation with a valid request key on HTTP", async () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    await mount(() => {}, async () => "2");
    await act(async () => { expect(await state.editor.runNode("video")).toBe(true); });
    expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({
      requestKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    }));
  });

  it("saves inserted reference order before an immediate generation click", async () => {
    let published: CanvasDocumentV2 | undefined;
    const save = vi.fn(async () => {
      expect(published?.nodes[0].data).toMatchObject({
        referenceOrder: ["configured:/b.png", "configured:/a.png", "configured:/c.png"],
        prompt: "@图片2 靠近 @图片3",
      });
      expect(state.submit).not.toHaveBeenCalled();
      return "11";
    });
    await mount(document => { published = document; }, save);
    await act(async () => {
      state.editor.updateData("video", (data: any) => ({ ...data, prompt: "@图片1 靠近 @图片3", mediaPaths: ["/a.png", "/b.png", "/c.png"] }));
      state.editor.reorderTaskReferences("video", ["configured:/b.png", "configured:/a.png", "configured:/c.png"]);
      expect(await state.editor.runNode("video")).toBe(true);
    });
    expect(save).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({
      mediaPaths: ["/b.png", "/a.png", "/c.png"], prompt: "@图片2 靠近 @图片3",
    }));
  });

  it("publishes the latest prompt and normalized settings before awaiting save, without waiting for the 250ms timer", async () => {
    let published: CanvasDocumentV2 | undefined;
    const save = vi.fn(async () => {
      expect(published?.nodes[0].data).toMatchObject({ prompt: "new prompt" });
      expect(state.submit).not.toHaveBeenCalled();
      return "10";
    });
    await mount(document => { published = document; }, save);
    await act(async () => {
      state.editor.updateData("video", (data: any) => ({ ...data, prompt: "new prompt", ratio: "16:9" }));
      expect(await state.editor.runNode("video")).toBe(true);
    });
    expect(save).toHaveBeenCalledOnce();
    expect(state.submit).toHaveBeenCalledWith(expect.objectContaining({ prompt: "new prompt" }));
  });
  it("does not submit a generation request when the save barrier rejects", async () => {
    await mount(() => {}, async () => { throw new Error("保存暂时不可用"); });
    await act(async () => { expect(await state.editor.runNode("video")).toBe(false); });
    expect(state.submit).not.toHaveBeenCalled();
  });
});
