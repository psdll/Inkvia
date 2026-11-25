// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasNodeData } from "@/lib/canvas/document";

const state = vi.hoisted(() => ({ zoom: 1, toggle: vi.fn(), cancel: vi.fn(), run: vi.fn(), models: null as any }));
vi.mock("@xyflow/react", async original => ({
  ...await original<any>(),
  Handle: () => null,
  NodeToolbar: ({ children }: React.PropsWithChildren) => React.createElement("div", { "data-test-result-toolbar": true }, children),
  useNodeId: () => "task",
  useConnection: () => false,
  useUpdateNodeInternals: () => () => {},
  useStore: (select: any) => select({ transform: [0, 0, state.zoom], nodeLookup: new Map(), edges: [] }),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/canvas/CanvasMiniMaxVoiceDialog", () => ({ CanvasMiniMaxVoiceDialog: () => null }));
vi.mock("@/components/canvas/use-canvas-models", async original => ({ ...await original<any>(), useCanvasModels: () => state.models }));
vi.mock("@/components/canvas/CanvasAudioPlayback", () => ({ useCanvasAudioPlayback: () => ({ snapshot: { active: false }, toggle: state.toggle, seek: vi.fn() }) }));
vi.mock("@/components/canvas/CanvasMediaImage", () => ({
  CanvasMediaImage: ({ src, alt }: { src: string; alt: string }) => React.createElement("img", { src, alt }),
}));
vi.mock("@/components/canvas/use-canvas-image-resolution", () => ({ useCanvasImageResolution: () => undefined }));
import { CanvasNodeCard, CanvasNodeEditorContext } from "@/components/canvas/CanvasNodeCard";
import { getCanvasImageModelParams } from "@/lib/canvas/image-task";
import { normalizeCanvasVideoTaskForModel } from "@/lib/canvas/task-preferences";
import { getVideoDisplaySpec } from "@/lib/video-resolution-visibility";

type TaskKind = "imageTask" | "videoTask" | "audioTask";
type Status = "success" | "submitting" | "running" | "failed" | "cancelled";
const settings = { model: "", prompt: "", aspectRatio: "1:1", resolution: "2K", quality: "", count: 1 };
const task = (kind: TaskKind, status: Status, fresh = false): CanvasNodeData => {
  const url = `/${fresh ? "new" : "old"}.${kind === "imageTask" ? "png" : kind === "videoTask" ? "mp4" : "mp3"}`;
  if (kind === "imageTask") return { kind, task: { references: [], settings, batches: [
    { id: "previous", createdAt: 1, settings, outputs: [{ id: "old", status: "success", url: "/old.png" }] },
    { id: "current", createdAt: 2, settings, outputs: [{ id: "current", status, url: status === "success" ? url : undefined, error: status === "failed" ? "本轮生成失败" : undefined }] },
  ] } };
  const result = { status, outputUrl: url, error: status === "failed" ? "本轮生成失败" : undefined };
  return kind === "videoTask" ? { kind, model: "", prompt: "", mediaPaths: [], ...result }
    : { kind, model: "", prompt: "", voiceId: "", speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", waveformPeaks: [.2, .5], durationSeconds: fresh ? 8 : 12, ...result };
};
const editor = {
  isPanelVisible: () => false, isTaskPanelVisible: () => true,
  getTaskAssets: () => [], getTaskResultName: () => "结果", cancelNode: state.cancel,
  runNode: state.run,
} as unknown as NonNullable<React.ContextType<typeof CanvasNodeEditorContext>>;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  state.zoom = 1; state.models = null; vi.clearAllMocks(); vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const render = async (data: CanvasNodeData) => {
  await act(async () => root.render(React.createElement(ReactFlowProvider, null,
    React.createElement(CanvasNodeEditorContext.Provider, { value: editor }, React.createElement(CanvasNodeCard, {
      id: "task", type: data.kind, data, selected: false, dragging: false, width: 350, height: 350,
      isConnectable: true, zIndex: 0, draggable: true, selectable: true, deletable: true,
      positionAbsoluteX: 0, positionAbsoluteY: 0,
    })),
  )));
};
const results = () => host.querySelectorAll("[data-canvas-task-result] img, [data-canvas-task-result] video, [data-canvas-audio-node]");

it("uses the clicked output for angle generation without changing other image tools", async () => {
  state.models = { image: [{ id: "gpt-image-1", label: "Test image", provider: "test", category: "image", params: getCanvasImageModelParams("gpt-image-1") }], video: [], audio: [], chat: [] };
  const data = task("imageTask", "success");
  if (data.kind !== "imageTask") throw new Error("Expected image task");
  data.task.batches.at(-1)!.outputs.push({ id: "second", status: "success", url: "/second.png" });
  data.task.batches.at(-1)!.expanded = true;
  const generate = vi.fn();
  editor.generateAngle = generate;
  try {
    await render(data);
    act(() => host.querySelector<HTMLImageElement>('img[alt="生成结果 2"]')!.click());
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="角度"]')!.click());
    expect(document.querySelector('[data-angle-subject] image')?.getAttribute("href")).toBe("/second.png");
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="生成新角度"]')!.click());
    expect(generate).toHaveBeenCalledWith("task", "/second.png", expect.objectContaining({ azimuth: 0, elevation: 0, zoom: 5 }), expect.objectContaining({ model: "gpt-image-1" }));
    expect(data.task.batches.at(-1)!.outputs).toHaveLength(2);
  } finally { delete editor.generateAngle; }
});

describe.each([1, .1])("canvas regeneration at zoom %s", zoom => {
  it.each(["imageTask", "videoTask", "audioTask"] as const)("shows the new %s generation before replacing the result", async kind => {
    state.zoom = zoom;
    await render(task(kind, "success"));
    for (const status of ["submitting", "running"] as const) {
      await render(task(kind, status));
      expect(host.querySelector("[data-canvas-generation-status]")).not.toBeNull();
      expect(host.querySelector("[data-canvas-generation-status]")?.textContent).toBe("");
      expect(host.querySelector(".canvas-generation-sweep")).not.toBeNull();
      expect(host.querySelector('[aria-label="取消生成"]')).not.toBeNull();
      expect(results()).toHaveLength(0);
      expect(host.querySelector("[data-test-result-toolbar]")).toBeNull();
    }
    act(() => host.querySelector<HTMLButtonElement>("[data-canvas-generation-status] button")!.click());
    expect(state.cancel).toHaveBeenCalledWith("task");
    await render(task(kind, "success", true));
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(host.querySelector("[data-canvas-generation-status]")).toBeNull();
    if (kind === "audioTask") {
      state.zoom = 1;
      await render(task(kind, "success", true));
      act(() => host.querySelector<HTMLButtonElement>("[data-canvas-audio-play-button]")!.click());
      expect(state.toggle).toHaveBeenCalledWith("/new.mp3", 8);
    } else {
      expect(Array.from(results()).some(element => element.getAttribute("src") === (kind === "imageTask" ? "/new.png" : "/new.mp4"))).toBe(true);
      expect(Array.from(results()).some(element => element.getAttribute("src")?.includes("/old."))).toBe(false);
    }
  });
  it.each(["imageTask", "videoTask", "audioTask"] as const)("does not restore an old %s result on failure or cancellation", async kind => {
    state.zoom = zoom;
    await render(task(kind, "success"));
    await render(task(kind, "failed"));
    expect(host.querySelector("[data-canvas-task-failure]")?.textContent).toBe("本轮生成失败");
    expect(results()).toHaveLength(0);
    await render(task(kind, "cancelled"));
    expect(results()).toHaveLength(0);
    expect(host.querySelector("[data-canvas-generation-status]")).toBeNull();
  });
});

it("keeps showing batch progress while another image in the new batch is still running", async () => {
  const data = task("imageTask", "success", true);
  if (data.kind !== "imageTask") throw new Error("expected image task");
  data.task.batches.at(-1)!.outputs.push({ id: "pending", status: "running" });
  await render(data);
  expect(host.querySelector("[data-canvas-generation-status]")).not.toBeNull();
  expect(results()).toHaveLength(0);
});

it("uses the effect for text regeneration and restores the completed text", async () => {
  await render({ kind: "llm", prompt: "test", output: "旧结果", status: "running" });
  expect(host.querySelector("[data-canvas-generation-status]")?.textContent).toBe("");
  expect(host.querySelector(".canvas-generation-sweep")).not.toBeNull();
  expect(host.querySelector("[data-canvas-llm-result]")?.textContent).not.toContain("旧结果");
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="取消生成"]')!.click());
  expect(state.cancel).toHaveBeenCalledWith("task");
  await render({ kind: "llm", prompt: "test", output: "新结果", status: "success" });
  expect(host.querySelector("[data-canvas-generation-status]")).toBeNull();
  expect(host.querySelector("[data-canvas-llm-result]")?.textContent).toContain("新结果");
});

it.each(["imageTask", "videoTask", "audioTask"] as const)("enables the %s generate button after a moderation failure and prevents clicks while running", async kind => {
  state.models = {
    image: [{ id: "gpt-image-1", label: "Test image", provider: "test", category: "image", params: getCanvasImageModelParams("gpt-image-1") }],
    video: [{ id: "sora2", label: "Test video", provider: "test", category: "video", supportedResolutions: ["720p"] }],
    audio: [{ id: "speech-2.8-hd", label: "Test audio", provider: "test", category: "audio" }],
    chat: [], capabilityStatus: "loaded", canvasDefault: { status: "unavailable" },
  };
  let data = task(kind, "failed");
  if (data.kind === "imageTask") {
    data.task.settings = { ...data.task.settings, model: "gpt-image-1", prompt: "test" };
    data.task.batches.at(-1)!.outputs[0].error = "生成内容未通过平台审核。";
  } else if (data.kind === "videoTask") {
    data = normalizeCanvasVideoTaskForModel({ ...data, model: "sora2", prompt: "test", error: "生成内容未通过平台审核。" }, "sora2", getVideoDisplaySpec("sora2", state.models.video), false);
  } else if (data.kind === "audioTask") {
    data = { ...data, model: "speech-2.8-hd", prompt: "test", error: "生成内容未通过平台审核。" };
  }
  await render(data);
  const button = () => host.querySelector<HTMLButtonElement>(".canvas-task-submit-button")!;
  expect(button()).not.toBeNull();
  expect(button().disabled).toBe(false);
  act(() => button().click());
  expect(state.run).toHaveBeenCalledWith("task");
  if (data.kind === "imageTask") data.task.batches.at(-1)!.outputs[0].status = "running";
  else if (data.kind === "videoTask" || data.kind === "audioTask") data = { ...data, status: "running" };
  await render({ ...data });
  expect(button().disabled).toBe(true);
  act(() => button().click());
  expect(state.run).toHaveBeenCalledTimes(1);
});
