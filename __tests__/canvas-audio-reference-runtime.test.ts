// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { readFileSync } from "node:fs";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeCard, CanvasNodeEditorContext } from "@/components/canvas/CanvasNodeCard";
import { CanvasAudioPlaybackProvider, useCanvasAudioPlayback } from "@/components/canvas/CanvasAudioPlayback";
import type { PromptReferenceAsset } from "@/lib/prompt-asset-references";

vi.mock("@/components/canvas/use-canvas-models", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/canvas/use-canvas-models")>(),
  useCanvasModels: () => null,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const audio: PromptReferenceAsset = { id: "audio-ref", sourceNodeId: "audio-node", token: "音频1", kind: "audio", url: "/uploads/test.mp3", durationSeconds: 116.84 };
let host: HTMLDivElement, root: Root;
const remove = vi.fn(), mention = vi.fn(), reorder = vi.fn();
function SourceControl() {
  const { snapshot, toggle } = useCanvasAudioPlayback("audio-node");
  return React.createElement("button", { "data-source-player": true, onClick: () => void toggle(audio.url!, audio.durationSeconds) }, snapshot.isPlaying ? "暂停来源" : "播放来源");
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("Image", class { async decode() {} });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
async function render(assets = [audio]) {
  await act(async () => root.render(React.createElement(ReactFlowProvider, null,
    React.createElement(CanvasAudioPlaybackProvider, { nodeIds: ["audio-node"], children:
      React.createElement(CanvasNodeEditorContext.Provider, { value: {
        getTaskAssets: () => assets, isPanelVisible: () => true, isTaskPanelVisible: () => true,
        getTaskResultName: () => "测试任务", getMediaName: () => "测试任务",
        reorderTaskReferences: reorder, removeTaskReference: remove, mentionTaskReference: mention,
      } as any }, React.createElement(React.Fragment, null,
        React.createElement(SourceControl),
        React.createElement(CanvasNodeCard, {
          id: "video-task", type: "videoTask", data: { kind: "videoTask", model: "", prompt: "", mediaPaths: [], status: "idle" },
          selected: true, dragging: false, isConnectable: true, zIndex: 0, draggable: true,
          selectable: true, deletable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
        }),
      )),
    }),
  )));
}
const card = () => host.querySelector<HTMLElement>(".canvas-reference-card")!;
const play = () => card().querySelector<HTMLButtonElement>("[data-canvas-reference-audio-play]")!;
const click = async (element: HTMLElement) => { await act(async () => { element.click(); }); };
const hover = async (element: HTMLElement) => {
  act(() => element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  await act(async () => { vi.advanceTimersByTime(450); });
};

describe("canvas audio reference card", () => {
  it("hides playback until the card is hovered or the button is keyboard-focused", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const base = css.match(/\n\[data-canvas-reference-audio-play\] \{([^}]+)\}/)?.[1] || "";
    expect(base).toContain("opacity: 0");
    expect(base).toContain("pointer-events: none");
    const reveal = css.match(/\.canvas-reference-card:hover \[data-canvas-reference-audio-play\],\s*\[data-canvas-reference-audio-play\]:focus-visible \{([^}]+)\}/)?.[1] || "";
    expect(reveal).toContain("opacity: 1");
    expect(reveal).toContain("pointer-events: auto");
    expect(css).not.toContain('.canvas-reference-card:focus-within [data-canvas-reference-audio-play]');
  });
  it("uses the reference gray tile and outlined corner controls with shared theme tokens", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain('background: color-mix(in srgb, var(--canvas-controls-bg) 92%, var(--canvas-controls-text))');
    const audioControls = css.slice(css.indexOf('.canvas-reference-card[data-canvas-reference-kind="audio"] [data-canvas-reference-remove]'));
    expect(audioControls.slice(0, audioControls.indexOf("}") + 1)).toContain('border: 1px solid var(--canvas-controls-text-muted)');
  });
  it("shows a play control and decimal seconds, without an image sequence badge", async () => {
    await render();
    expect(play()).not.toBeNull();
    expect(play().getAttribute("aria-label")).toBe("播放音频1");
    expect(card().querySelector(".canvas-reference-duration")?.textContent).toBe("116.8s");
    expect(card().querySelector("[data-canvas-reference-sequence]")).toBeNull();
  });
  it("does not open a hover preview for audio", async () => {
    await render(); await hover(card());
    expect(document.querySelector("[data-canvas-task-asset-hover-preview]")).toBeNull();
  });
  it.each(["image", "video"] as const)("preserves hover preview and sequence for %s", async (kind) => {
    await render([{ ...audio, kind, url: `/uploads/test.${kind === "image" ? "png" : "mp4"}` }]);
    await hover(card());
    expect(document.querySelector("[data-canvas-task-asset-hover-preview]")).not.toBeNull();
    expect(card().querySelector("[data-canvas-reference-sequence]")?.textContent).toBe("1");
  });
  it("plays and pauses through the same player as its source node", async () => {
    await render();
    expect(play()).not.toBeNull();
    await click(play());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(play().getAttribute("aria-label")).toBe("暂停音频1");
    const source = host.querySelector<HTMLElement>("[data-source-player]")!;
    expect(source.textContent).toBe("暂停来源");
    await click(source);
    expect(play().getAttribute("aria-label")).toBe("播放音频1");
    expect(host.querySelectorAll("audio")).toHaveLength(1);
    expect(reorder).not.toHaveBeenCalled();
  });
  it("reads metadata when older references have no saved duration", async () => {
    await render([{ ...audio, durationSeconds: undefined }]);
    const metadata = card().querySelector("audio");
    expect(metadata).not.toBeNull();
    expect(metadata?.getAttribute("preload")).toBe("metadata");
    Object.defineProperty(metadata!, "duration", { value: 65.25, configurable: true });
    act(() => metadata!.dispatchEvent(new Event("loadedmetadata")));
    expect(card().querySelector(".canvas-reference-duration")?.textContent).toBe("65.3s");
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it("returns to play after ending or a rejected play request", async () => {
    await render(); expect(play()).not.toBeNull(); await click(play());
    const player = host.querySelector("audio")!;
    act(() => player.dispatchEvent(new Event("ended")));
    expect(play().getAttribute("aria-label")).toBe("播放音频1");
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("load failed"));
    await click(play());
    expect(play().getAttribute("aria-label")).toBe("播放音频1");
    expect(play().getAttribute("title")).toContain("播放失败");
  });
  it("keeps remove and mention actions on the reference card", async () => {
    await render();
    await click(card().querySelector<HTMLElement>("[data-canvas-reference-mention]")!);
    await click(card().querySelector<HTMLElement>("[data-canvas-reference-remove]")!);
    expect(mention).toHaveBeenCalledWith("video-task", "音频1");
    expect(remove).toHaveBeenCalledWith("video-task", "audio-ref");
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
});
