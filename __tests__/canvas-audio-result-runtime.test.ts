// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeCard } from "@/components/canvas/CanvasNodeCard";
import { CanvasAudioPlaybackProvider } from "@/components/canvas/CanvasAudioPlayback";
import type { CanvasNodeData } from "@/lib/canvas/document";
import { CanvasLodContext } from "@/components/canvas/canvas-runtime-context";

type AudioTask = Extract<CanvasNodeData, { kind: "audioTask" }>;
const previousResult: AudioTask = {
  kind: "audioTask", model: "speech-2.8-hd", prompt: "你好", voiceId: "female-shaonv",
  speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0,
  soundEffect: "", status: "success", outputUrl: "/uploads/previous.mp3", durationSeconds: 12,
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
const render = async (data: AudioTask) => {
  const node = React.createElement(CanvasNodeCard, {
    id: "audio", type: "audioTask", data, selected: true, dragging: false,
    isConnectable: true, zIndex: 0, draggable: true, selectable: true, deletable: true,
    positionAbsoluteX: 0, positionAbsoluteY: 0,
  });
  await act(async () => root.render(React.createElement(ReactFlowProvider, null,
    React.createElement(CanvasAudioPlaybackProvider, { nodeIds: ["audio"], children: node }),
  )));
};

describe("audio node generation results", () => {
  it("switches an empty text node from onboarding to a waiting placeholder only for incoming connections", async () => {
    const show = async (edges: Array<{ id: string; source: string; target: string }>, output?: string) => {
      await act(async () => root.render(React.createElement(ReactFlowProvider, { key: JSON.stringify([edges, output]), initialEdges: edges, children: null },
        React.createElement(CanvasNodeCard, {
          id: "text", type: "llm", data: { kind: "llm", prompt: "", status: "idle", output }, selected: true, dragging: false,
          width: 350, height: 350,
        } as any))));
    };
    await show([]);
    expect(host.querySelector('[data-canvas-text-start]')).not.toBeNull();
    await show([{ id: "out", source: "text", target: "other" }]);
    expect(host.querySelector('[data-canvas-text-start]')).not.toBeNull();
    await show([{ id: "in", source: "image", target: "text" }]);
    expect(host.querySelector('[data-canvas-text-start]')).toBeNull();
    expect(host.querySelector('[data-canvas-text-awaiting-prompt]')).not.toBeNull();
    await show([{ id: "in", source: "image", target: "text" }], "已有内容");
    expect(host.textContent).toContain("已有内容");
    expect(host.querySelector('[data-canvas-text-awaiting-prompt]')).toBeNull();
    await show([]);
    expect(host.querySelector('[data-canvas-text-start]')).not.toBeNull();
  });
  it("keeps new text-node actions and layout at low zoom and across remounts", async () => {
    const show = async (low: boolean, visible = true) => {
      await act(async () => root.render(React.createElement(ReactFlowProvider, null,
        React.createElement(CanvasLodContext.Provider, { value: low }, visible ? React.createElement(CanvasNodeCard, {
          id: "text", type: "llm", data: { kind: "llm", prompt: "", status: "idle" },
          selected: false, dragging: false, width: 350, height: 350,
        } as any) : null))));
    };
    await show(false);
    const before = host.querySelector("[data-canvas-task-workspace]")?.innerHTML;
    expect(before).toBeTruthy();
    expect(host.textContent).toContain("自己编写内容");
    await show(true, false);
    await show(true);
    expect(host.textContent).toContain("自己编写内容");
    expect(host.querySelector("[data-canvas-task-workspace]")?.innerHTML).toBe(before);
    expect(host.querySelector("[data-canvas-low-detail]")).toBeNull();
  });
  it("keeps the external node name without repeating a title or music icon inside the player", async () => {
    await render({ ...previousResult, outputName: "生成音频" });
    const player = host.querySelector("[data-canvas-audio-node]")!;
    expect(host.textContent).toContain("生成音频");
    expect(player.textContent).not.toContain("生成音频");
    expect(player.querySelectorAll("svg")).toHaveLength(2); // Waveform and play icon only.
    expect(player.querySelector("[data-canvas-audio-playhead]")).not.toBeNull();
    expect(player.textContent).toContain("00:00 / 00:12");
  });

  it("shows the audio result after success", async () => {
    await render(previousResult);
    expect(host.querySelector("[data-canvas-audio-node]")).not.toBeNull();
    expect(host.querySelector("[data-canvas-task-failure]")).toBeNull();
  });

  it("shows the new failure reason instead of a previous successful audio result", async () => {
    await render(previousResult);
    const failed: AudioTask = { ...previousResult, status: "failed", error: "停顿必须放在两段文字之间" };
    await render(failed);
    expect(host.querySelector("[data-canvas-task-failure]")?.textContent).toBe(failed.error);
    expect(host.querySelector("[data-canvas-audio-node]")).toBeNull();
    expect(failed.outputUrl).toBe(previousResult.outputUrl);
  });

  it("shows progress while regenerating, then the new successful audio", async () => {
    await render({ ...previousResult, status: "running" });
    expect(host.querySelector("[data-canvas-audio-node]")).toBeNull();
    expect(host.querySelector("[data-canvas-task-failure]")).toBeNull();
    await render({ ...previousResult, outputUrl: "/uploads/new.mp3", durationSeconds: 8 });
    expect(host.querySelector("[data-canvas-audio-node]")?.textContent).toContain("00:08");
  });
});
