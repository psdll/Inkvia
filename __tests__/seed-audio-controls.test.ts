/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasSeedAudioOutputOptions, CanvasSeedAudioParameters } from "@/components/canvas/CanvasSeedAudioParameters";
import { buildSeedAudioRequest } from "@/lib/seed-audio-models";
import { FrostedSelect } from "@/components/ui/frosted-select";
import { getCanvasAudioModelReferenceError } from "@/lib/canvas/seed-audio";
import type { CanvasNodeData } from "@/lib/canvas/document";

type AudioTask = Extract<CanvasNodeData, { kind: "audioTask" }>;
const initial: AudioTask = { kind: "audioTask", model: "seed-audio-1.0", prompt: "雨声", audioFormat: "wav", sampleRate: 24000, voiceId: "female-shaonv", speed: 1, volume: 1, pitch: 0, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", status: "idle" };
let current: AudioTask;
let root: Root;
let host: HTMLDivElement;
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
function Harness() {
  const [value, setValue] = React.useState(initial);
  current = value;
  const onChange = (patch: Partial<AudioTask>) => setValue((previous) => ({ ...previous, ...patch }));
  return React.createElement(React.Fragment, null,
    React.createElement(CanvasSeedAudioOutputOptions, { value, onChange }),
    React.createElement(CanvasSeedAudioParameters, { value, onChange }),
  );
}
const click = async (button: HTMLButtonElement) => act(async () => { button.click(); });
const option = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"][aria-label="音频输出设置"] button')).find((button) => button.textContent === text)!;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  if (originalScrollIntoView) Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("Seed Audio output controls", () => {
  it("renders unsupported models disabled with an image, then restores selection after disconnecting", async () => {
    let selected = "seed-audio-1.0";
    function ModelHarness() {
      const [hasImage, setHasImage] = React.useState(true);
      const [value, setValue] = React.useState(selected);
      selected = value;
      return React.createElement(React.Fragment, null,
        React.createElement(FrostedSelect, { value, onChange: setValue, ariaLabel: "音频模型", options: ["seed-audio-1.0", "speech-2.8-hd", "speech-2.8-turbo"].map((model) => ({ value: model, label: model, disabled: Boolean(getCanvasAudioModelReferenceError(model, hasImage ? [{ kind: "image" }] : [])) })) }),
        React.createElement("button", { onClick: () => setHasImage(false) }, "断开图片"),
      );
    }
    await act(async () => root.render(React.createElement(ModelHarness)));
    await click(host.querySelector<HTMLButtonElement>("[aria-label='音频模型']")!);
    const hd = () => document.querySelector<HTMLButtonElement>("button[role='option'][data-value='speech-2.8-hd']")
      || Array.from(document.querySelectorAll<HTMLButtonElement>("button[role='option']")).find((button) => button.textContent?.includes("speech-2.8-hd"))!;
    expect(hd().disabled).toBe(true);
    await click(hd()); expect(selected).toBe("seed-audio-1.0");
    await click(Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "断开图片")!);
    const trigger = host.querySelector<HTMLButtonElement>("[aria-label='音频模型']")!;
    if (trigger.getAttribute("aria-expanded") !== "true") await click(trigger);
    expect(hd().disabled).toBe(false);
    await click(hd()); expect(selected).toBe("speech-2.8-hd");
  });
  it("updates the actual request and disables invalid Opus sample rates", async () => {
    await click(host.querySelector<HTMLButtonElement>("[aria-label='音频输出设置']")!);
    expect(option("24k").getAttribute("aria-pressed")).toBe("true");
    await click(option("ogg_opus"));
    expect(current).toMatchObject({ audioFormat: "ogg_opus", sampleRate: 48000 });
    expect(option("8k").disabled).toBe(true);
    expect(option("24k").disabled).toBe(true);
    expect(option("48k").disabled).toBe(false);
    expect(buildSeedAudioRequest({ ...current, model: "seed-audio-1.0", text: current.prompt }).body.audio_config).toMatchObject({ format: "ogg_opus", sample_rate: 48000 });
    await click(option("mp3")); await click(option("16k"));
    expect(current).toMatchObject({ audioFormat: "mp3", sampleRate: 16000 });
    expect(host.querySelector("[aria-label='音频输出设置']")?.textContent).toContain("16k · mp3");
  });
  it("renders only the three requested advanced controls using the shared numeric display", () => {
    const advanced = host.querySelector("[aria-label='Seed Audio 高级设置']")!;
    expect(advanced.querySelectorAll("input[type='range']")).toHaveLength(3);
    expect(advanced.querySelector<HTMLInputElement>("[aria-label='语速数值']")?.value).toBe("1");
    expect(advanced.querySelector<HTMLInputElement>("[aria-label='音量数值']")?.value).toBe("1");
    expect(advanced.textContent).not.toContain("音色");
  });
});
