/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CanvasMiniMaxVoiceCloneDialog } from "@/components/canvas/CanvasMiniMaxVoiceCloneDialog";
import { prepareVoiceCloneUpload } from "@/lib/canvas/voice-clone-upload";

vi.mock("@/lib/canvas/voice-clone-upload", () => ({ prepareVoiceCloneUpload: vi.fn() }));

let root: Root;
let host: HTMLDivElement;
let port: { onmessage: ((event: { data: Float32Array }) => void) | null; close: ReturnType<typeof vi.fn> };
let stopTrack: ReturnType<typeof vi.fn>;
let closeContext: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(prepareVoiceCloneUpload).mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  stopTrack = vi.fn();
  closeContext = vi.fn().mockResolvedValue(undefined);
  port = { onmessage: null, close: vi.fn() };
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  vi.stubGlobal("AudioContext", class {
    sampleRate = 16_000;
    state = "running";
    destination = {};
    audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    createMediaStreamSource = node;
    createGain = () => ({ ...node(), gain: { value: 1 } });
    close = closeContext;
  });
  vi.stubGlobal("AudioWorkletNode", class {
    port = port;
    connect = vi.fn();
    disconnect = vi.fn();
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

async function openUpload() {
  await act(async () => root.render(React.createElement(CanvasMiniMaxVoiceCloneDialog, {
    open: true, model: "speech-2.8-hd", onCreated: vi.fn(), onClose: vi.fn(),
  })));
  await act(async () => button("上传音频").click());
}

async function selectFile(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

async function dragUpload(type: string, files: File[], target = document.querySelector(".canvas-minimax-voice-upload")!) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files, types: ["Files"], dropEffect: "none" } });
  await act(async () => target.dispatchEvent(event));
  return event;
}

it("accepts a dropped audio file with hover feedback and prevents browser navigation", async () => {
  const file = new File(["mp3"], "dropped.mp3");
  vi.mocked(prepareVoiceCloneUpload).mockResolvedValue({ file: new File(["wav"], "dropped.wav"), durationSeconds: 12 });
  await openUpload();
  const zone = document.querySelector(".canvas-minimax-voice-upload")!;
  await dragUpload("dragenter", [file]);
  expect(zone.getAttribute("data-dragging")).toBe("true");
  expect((await dragUpload("dragover", [file])).defaultPrevented).toBe(true);
  expect((await dragUpload("drop", [file])).defaultPrevented).toBe(true);
  expect(zone.hasAttribute("data-dragging")).toBe(false);
  expect(prepareVoiceCloneUpload).toHaveBeenCalledWith(file);
  expect(document.body.textContent).toContain("dropped.mp3");
  expect(button("生成音色").disabled).toBe(true);
});

it("rejects multiple dropped files and reports validation errors for a single file", async () => {
  await openUpload();
  await dragUpload("drop", [new File(["a"], "a.mp3"), new File(["b"], "b.mp3")]);
  expect(prepareVoiceCloneUpload).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("一次只能上传一个音频文件");
  vi.mocked(prepareVoiceCloneUpload).mockRejectedValue(new Error("请选择 MP3、M4A 或 WAV 音频文件"));
  await dragUpload("drop", [new File(["x"], "bad.txt")]);
  expect(document.body.textContent).toContain("请选择 MP3、M4A 或 WAV 音频文件");
  expect(button("生成音色").disabled).toBe(true);
});

it("keeps the dropped filename visible when duration validation fails", async () => {
  vi.mocked(prepareVoiceCloneUpload).mockRejectedValue(new Error("音频时长为 5.23 秒，需为 10 秒到 5 分钟，请更换音频"));
  await openUpload();
  await dragUpload("drop", [new File(["mp3"], "短声音.mp3")]);
  expect(document.querySelector(".canvas-minimax-voice-upload-name")?.textContent).toContain("短声音.mp3");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("5.23 秒");
  expect(button("重新选择文件")).toBeDefined();
  expect(button("生成音色").disabled).toBe(true);
  vi.mocked(prepareVoiceCloneUpload).mockResolvedValue({ file: new File(["wav"], "完整声音.wav"), durationSeconds: 12 });
  await dragUpload("drop", [new File(["mp3"], "完整声音.mp3")]);
  expect(document.querySelector(".canvas-minimax-voice-upload-name")?.textContent).toContain("完整声音.mp3");
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("does not replace an upload while it is being prepared", async () => {
  vi.mocked(prepareVoiceCloneUpload).mockReturnValue(new Promise(() => {}));
  await openUpload();
  await dragUpload("drop", [new File(["a"], "a.mp3")]);
  await dragUpload("drop", [new File(["b"], "b.mp3")]);
  expect(prepareVoiceCloneUpload).toHaveBeenCalledTimes(1);
});

it("submits the prepared upload only after consent and a generate click", async () => {
  const prepared = new File(["wav"], "sample.wav", { type: "audio/wav" });
  vi.mocked(prepareVoiceCloneUpload).mockResolvedValue({ file: prepared, durationSeconds: 12 });
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, voiceId: "voice123" }) });
  vi.stubGlobal("fetch", fetchMock);
  await openUpload();
  await selectFile(new File(["mp3"], "sample.mp3"));
  expect(document.body.textContent).toContain("sample.mp3");
  expect(document.body.textContent).toContain("00:12");
  expect(button("生成音色").disabled).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(button("生成音色").disabled).toBe(false);
  await act(async () => button("生成音色").click());
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/canvas/speech/clone");
  expect(options.body.get("file")).toBe(prepared);
  expect(options.body.get("model")).toBe("speech-2.8-hd");
  expect(document.body.textContent).toContain("音色已生成");
});

it("clears the previous upload when a replacement fails validation", async () => {
  vi.mocked(prepareVoiceCloneUpload).mockResolvedValueOnce({ file: new File(["wav"], "sample.wav"), durationSeconds: 12 })
    .mockRejectedValueOnce(new Error("音频时长需为 10 秒到 5 分钟"));
  await openUpload();
  await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await selectFile(new File(["mp3"], "sample.mp3"));
  expect(button("生成音色").disabled).toBe(false);
  await selectFile(new File(["short"], "short.mp3"));
  expect(button("生成音色").disabled).toBe(true);
  expect(document.body.textContent).toContain("音频时长需为 10 秒到 5 分钟");
});

it("ignores a pending upload after switching back to recording", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof prepareVoiceCloneUpload>>) => void;
  vi.mocked(prepareVoiceCloneUpload).mockReturnValue(new Promise(done => { resolve = done; }));
  await openUpload();
  await selectFile(new File(["mp3"], "sample.mp3"));
  expect(button("生成音色").disabled).toBe(true);
  await act(async () => button("现场录音").click());
  await act(async () => resolve({ file: new File(["wav"], "sample.wav"), durationSeconds: 12 }));
  await act(async () => button("上传音频").click());
  expect(document.body.textContent).not.toContain("sample.mp3");
  expect(button("生成音色").disabled).toBe(true);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  Reflect.deleteProperty(navigator, "mediaDevices");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const button = (label: string) => Array.from(document.querySelectorAll("button"))
  .find((item) => item.textContent?.trim() === label)!;

it("enables voice generation after stopping a ten-second 16 kHz recording", async () => {
  await act(async () => root.render(React.createElement(CanvasMiniMaxVoiceCloneDialog, {
    open: true, model: "speech-2.8-hd", onCreated: vi.fn(), onClose: vi.fn(),
  })));
  await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(button("生成音色").disabled).toBe(true);
  await act(async () => button("开始录音").click());
  expect(button("停止录音")).toBeDefined();
  port.onmessage!({ data: new Float32Array(16_000 * 10).fill(0.25) });
  await act(async () => button("停止录音").click());
  expect(button("重新录制")).toBeDefined();
  expect(button("生成音色").disabled).toBe(false);
  expect(document.body.textContent).toContain("00:10 / 05:00");
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(closeContext).toHaveBeenCalledOnce();
});
