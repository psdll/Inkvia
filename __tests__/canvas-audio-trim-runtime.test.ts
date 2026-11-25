import * as React from "react";
import { act, Simulate } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CanvasAudioTrimProvider, CanvasAudioTrimButton, CanvasAudioTrimSelection, CanvasAudioSpeedButton } from "@/components/canvas/CanvasAudioTrim";
import { CanvasReadOnlyContext } from "@/components/canvas/CanvasReadOnlyContext";
import { trimCanvasAudio } from "@/lib/canvas/audio-trim";
import { changeCanvasAudioSpeed } from "@/lib/canvas/audio-speed";
import { CanvasAudioNode } from "@/components/canvas/CanvasAudioNode";
import { CanvasAudioPlaybackProvider } from "@/components/canvas/CanvasAudioPlayback";

vi.mock("@xyflow/react", () => ({ Position: { Bottom: "bottom" }, NodeToolbar: ({ children }: any) => children }));
vi.mock("@/lib/canvas/audio-trim", () => ({ trimCanvasAudio: vi.fn() }));
vi.mock("@/lib/canvas/audio-speed", () => ({ changeCanvasAudioSpeed: vi.fn(), CANVAS_AUDIO_SPEED_MIN: .1, CANVAS_AUDIO_SPEED_MAX: 4 }));
let host: HTMLDivElement, root: Root;
const save = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  save.mockReset().mockResolvedValue(undefined);
  vi.mocked(trimCanvasAudio).mockReset().mockResolvedValue({ blob: new Blob(["clip"]), waveformPeaks: [50], durationSeconds: 2 });
  vi.mocked(changeCanvasAudioSpeed).mockReset().mockResolvedValue({ blob: new Blob(["speed"]), waveformPeaks: [50], durationSeconds: 2 });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(readOnly = false) {
  await act(async () => root.render(React.createElement(CanvasReadOnlyContext.Provider, { value: readOnly },
    React.createElement(CanvasAudioTrimProvider, { nodeId: "a", src: "/audio.wav", durationSeconds: 4, onExport: save,
      children: React.createElement(React.Fragment, null, React.createElement(CanvasAudioTrimButton), React.createElement(CanvasAudioSpeedButton),
        React.createElement("div", { style: { position: "relative", width: 400, height: 120 } }, React.createElement(CanvasAudioTrimSelection))),
    }),
  )));
}
const button = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(el => el.textContent === label || el.getAttribute("aria-label") === label)!;
const pointer = (pointerId: number, clientX: number) => ({ pointerId, clientX, button: 0 });
const input = (label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;

it("opens, edits decimal times, exports once and closes the selection", async () => {
  await render();
  await act(async () => button("截取音频").click());
  expect(host.textContent).toContain("2.00 s");
  act(() => { const start = input("截取开始时间（秒）"); start.value = "0.25"; Simulate.change(start); });
  act(() => { const end = input("截取结束时间（秒）"); end.value = "1.75"; Simulate.change(end); });
  expect(host.textContent).toContain("1.50 s");
  await act(async () => { button("生成").click(); button("生成").click(); });
  expect(trimCanvasAudio).toHaveBeenCalledTimes(1);
  expect(trimCanvasAudio).toHaveBeenCalledWith("/audio.wav", .25, 1.75);
  expect(save).toHaveBeenCalledTimes(1);
  expect(host.querySelector("[data-canvas-audio-trim-selection]")).toBeNull();
});

it("moves and resizes the selection in waveform coordinates", async () => {
  await render(); await act(async () => button("截取音频").click());
  const overlay = host.querySelector<HTMLElement>("[data-canvas-audio-trim-selection]")!;
  overlay.getBoundingClientRect = () => ({ width: 400 } as DOMRect);
  overlay.setPointerCapture = vi.fn(); overlay.hasPointerCapture = () => false;
  act(() => Simulate.pointerDown(input("截取终点"), pointer(1, 200)));
  act(() => Simulate.pointerMove(overlay, pointer(1, 300)));
  act(() => Simulate.pointerUp(overlay, pointer(1, 300)));
  expect(input("截取结束时间（秒）").value).toBe("3");
  act(() => Simulate.pointerDown(input("截取起点").parentElement!, pointer(2, 150)));
  act(() => Simulate.pointerMove(overlay, pointer(2, 250)));
  act(() => Simulate.pointerUp(overlay, pointer(2, 250)));
  expect(input("截取开始时间（秒）").value).toBe("1");
  expect(input("截取结束时间（秒）").value).toBe("4");
  act(() => button("取消截取").click());
  expect(save).not.toHaveBeenCalled();
});

it("keeps the range for retry after upload failure and hides editing in read-only mode", async () => {
  await render(); await act(async () => button("截取音频").click());
  save.mockRejectedValueOnce(new Error("上传失败"));
  await act(async () => button("生成").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("上传失败");
  expect(host.querySelector("[data-canvas-audio-trim-selection]")).not.toBeNull();
  await act(async () => button("生成").click());
  expect(host.querySelector("[data-canvas-audio-trim-selection]")).toBeNull();
  await render(true);
  expect(button("截取音频")).toBeUndefined();
  expect(button("音频变速")).toBeUndefined();
});

it("synchronizes the speed slider and numeric input, validates bounds and exports the chosen rate once", async () => {
  await render();
  act(() => button("音频变速").click());
  expect(input("音频变速倍率").value).toBe("1.00");
  act(() => { const slider = input("音频变速滑杆"); slider.value = "1.4"; Simulate.change(slider); });
  expect(input("音频变速倍率").value).toBe("1.40");
  for (const value of ["0", "4.1", ""]) {
    act(() => { const field = input("音频变速倍率"); field.value = value; Simulate.change(field); });
    expect(button("生成变速音频").disabled).toBe(true);
  }
  act(() => { const field = input("音频变速倍率"); field.value = "0.5"; Simulate.change(field); });
  expect(input("音频变速滑杆").value).toBe("0.5");
  await act(async () => { button("生成变速音频").click(); button("生成变速音频").click(); });
  expect(changeCanvasAudioSpeed).toHaveBeenCalledTimes(1);
  expect(changeCanvasAudioSpeed).toHaveBeenCalledWith("/audio.wav", .5);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 2 }), .5);
  expect(button("取消变速")).toBeUndefined();
});

it("switches editing modes exclusively and allows speed retry or cancel without altering the source", async () => {
  await render(); await act(async () => button("截取音频").click());
  act(() => button("音频变速").click());
  expect(host.querySelector("[data-canvas-audio-trim-selection]")).toBeNull();
  save.mockRejectedValueOnce(new Error("上传失败"));
  await act(async () => button("生成变速音频").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("上传失败");
  expect(input("音频变速倍率").value).toBe("1.00");
  await act(async () => button("生成变速音频").click());
  act(() => button("音频变速").click());
  act(() => button("取消变速").click());
  expect(save).toHaveBeenCalledTimes(2);
  await act(async () => button("截取音频").click());
  expect(host.querySelector("[data-canvas-audio-trim-selection]")).not.toBeNull();
  expect(button("生成变速音频")).toBeUndefined();
});

it("steps speed using stacked arrows and respects both limits", async () => {
  await render(); act(() => button("音频变速").click());
  act(() => button("增加变速倍率").click());
  expect(input("音频变速倍率").value).toBe("1.01");
  expect(input("音频变速滑杆").value).toBe("1.01");
  act(() => button("减少变速倍率").click());
  expect(input("音频变速倍率").value).toBe("1.00");
  act(() => { const field = input("音频变速倍率"); field.value = "4"; Simulate.change(field); Simulate.blur(field); });
  expect(button("增加变速倍率").disabled).toBe(true);
  act(() => { const field = input("音频变速倍率"); field.value = "0.1"; Simulate.change(field); Simulate.blur(field); });
  expect(button("减少变速倍率").disabled).toBe(true);
});

it("auditions from the selected start and stops at its end", async () => {
  let paused = true;
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => { paused = true; });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => { paused = false; });
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(() => paused);
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(4);
  await act(async () => root.render(React.createElement(CanvasAudioPlaybackProvider, { nodeIds: ["a"],
    children: React.createElement(CanvasAudioTrimProvider, { nodeId: "a", src: "/audio.wav", durationSeconds: 4, onExport: save,
      children: React.createElement(React.Fragment, null, React.createElement(CanvasAudioTrimButton), React.createElement(CanvasAudioNode, {
        id: "a", data: { kind: "audio", url: "/audio.wav", durationSeconds: 4, waveformPeaks: [20, 80] }, selected: false, onWaveformReady: () => {},
      })),
    }),
  })));
  await act(async () => button("截取音频").click());
  act(() => { const start = input("截取开始时间（秒）"); start.value = "0.5"; Simulate.change(start); });
  await act(async () => button("播放音频").click());
  const audio = host.querySelector("audio")!;
  expect(audio.currentTime).toBe(.5);
  expect(paused).toBe(false);
  await act(async () => { audio.currentTime = 2; audio.dispatchEvent(new Event("timeupdate")); });
  expect(paused).toBe(true);
  expect(button("播放音频")).toBeDefined();
});
