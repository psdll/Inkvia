import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasAudioNode } from "@/components/canvas/CanvasAudioNode";
import { CanvasAudioPlaybackProvider } from "@/components/canvas/CanvasAudioPlayback";

describe("canvas audio playhead seeking", () => {
  let host: HTMLDivElement;
  let root: Root;
  let audio: HTMLAudioElement;
  let paused: boolean;
  let captures: Set<number>;
  const onNodePointerDown = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    paused = true;
    captures = new Set();
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => { paused = true; });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => { paused = false; });
    vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(() => paused);
    vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(120);
    vi.stubGlobal("PointerEvent", MouseEvent);
    // jsdom has no native pointer capture; exercise the real handlers and shared player.
    Object.defineProperties(HTMLElement.prototype, {
      setPointerCapture: { configurable: true, value: (id: number) => captures.add(id) },
      hasPointerCapture: { configurable: true, value: (id: number) => captures.has(id) },
      releasePointerCapture: { configurable: true, value: (id: number) => captures.delete(id) },
    });
    onNodePointerDown.mockClear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    for (const key of ["setPointerCapture", "hasPointerCapture", "releasePointerCapture"]) {
      delete (HTMLElement.prototype as any)[key];
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  async function render(duration = 120, width = 200) {
    await act(async () => root.render(React.createElement(CanvasAudioPlaybackProvider, {
      nodeIds: ["audio"],
      children: React.createElement("div", { onPointerDown: onNodePointerDown },
        React.createElement(CanvasAudioNode, {
          id: "audio",
          data: { kind: "audio", url: "/test.mp3", name: "测试音频", durationSeconds: duration, waveformPeaks: [20, 40, 60, 30] },
          selected: false,
          onWaveformReady: () => undefined,
        })),
    })));
    audio = host.querySelector("audio")!;
    const track = host.querySelector<HTMLElement>("[data-canvas-audio-seek-track]");
    if (track) vi.spyOn(track, "getBoundingClientRect").mockReturnValue({ left: 100, width } as DOMRect);
  }

  function handle() {
    const element = host.querySelector<HTMLElement>('[role="slider"][aria-label="音频播放位置"]');
    expect(element, "audio should expose a draggable playhead").not.toBeNull();
    return element!;
  }

  async function pointer(target: Element, type: string, clientX: number, pointerId = 1, button = 0) {
    await act(async () => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button });
      Object.defineProperty(event, "pointerId", { value: pointerId });
      target.dispatchEvent(event);
    });
  }

  async function key(value: string) {
    await act(async () => handle().dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true })));
  }

  it("drags only the playhead, updates time and waveform, and keeps paused audio paused", async () => {
    await render();
    const slider = handle();
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    await pointer(slider, "pointerdown", 103);
    expect(document.activeElement).not.toBe(slider);
    await pointer(slider, "pointermove", 203);
    expect(audio.currentTime).toBe(60);
    expect(slider.getAttribute("aria-valuenow")).toBe("60");
    expect(host.textContent).toContain("01:00 / 02:00");
    expect(host.querySelector("clipPath rect")?.getAttribute("width")).toBe("160");
    expect(paused).toBe(true);
    expect(onNodePointerDown).not.toHaveBeenCalled();
    await pointer(slider, "pointerup", 223);
    expect(audio.currentTime).toBe(72);
    expect(captures.size).toBe(0);
    await pointer(slider, "pointermove", 283);
    expect(audio.currentTime).toBe(72);
    await pointer(host.querySelector("[data-waveform-ready]")!, "pointerdown", 150);
    expect(onNodePointerDown).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(72);
  });

  it("seeks during playback without pausing or restarting the audio", async () => {
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>("[data-canvas-audio-play-button]")!.click());
    expect(paused).toBe(false);
    await pointer(handle(), "pointerdown", 100);
    await pointer(handle(), "pointerup", 150);
    expect(audio.currentTime).toBe(30);
    expect(paused).toBe(false);
    expect(host.querySelector('[aria-label="暂停音频"]')).not.toBeNull();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  });

  it.each([140, 320, 560])("uses the displayed waveform width at %s px and clamps both ends", async (width) => {
    await render(120, width);
    await pointer(handle(), "pointerdown", 100);
    await pointer(handle(), "pointermove", 100 + width * 0.75);
    expect(audio.currentTime).toBe(90);
    await pointer(handle(), "pointermove", 100 + width + 50);
    expect(audio.currentTime).toBe(120);
    await pointer(handle(), "pointerup", 0);
    expect(audio.currentTime).toBe(0);
  });

  it.each(["pointercancel", "lostpointercapture"])("ends seeking on %s and ignores other pointers", async (event) => {
    await render();
    await pointer(handle(), "pointerdown", 100);
    await pointer(handle(), "pointermove", 200, 2);
    expect(audio.currentTime).toBe(0);
    await pointer(handle(), "pointermove", 150);
    expect(audio.currentTime).toBe(30);
    await pointer(handle(), event, 200);
    await pointer(handle(), "pointermove", 250);
    expect(audio.currentTime).toBe(30);
  });

  it("supports keyboard positioning without changing playback state", async () => {
    await render();
    await key("ArrowRight");
    expect(audio.currentTime).toBe(1);
    await key("End");
    expect(audio.currentTime).toBe(120);
    await key("ArrowLeft");
    expect(audio.currentTime).toBe(119);
    await key("Home");
    expect(audio.currentTime).toBe(0);
    expect(paused).toBe(true);
  });

  it.each([[0, 200], [120, 0]])("ignores seeking when duration=%s or width=%s is unavailable", async (duration, width) => {
    await render(duration, width);
    await pointer(handle(), "pointerdown", 100);
    await pointer(handle(), "pointerup", 200);
    expect(audio.currentTime).toBe(0);
    expect(audio.getAttribute("src")).toBeNull();
  });
});
