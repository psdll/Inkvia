/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GptImage25OutputSettings } from "@/components/image/gpt-image-25-output-settings";
import { BatchParameterDock } from "@/components/batch-workbench/batch-parameter-dock";
import { normalizeGptImage2OfficialBatchSettings } from "@/components/batch-workbench/batch-settings-panel";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function button(text: string) {
  const found = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === text);
  expect(found).toBeDefined();
  return found!;
}

it("clears transparency when switching a batch to an unsupported model", () => {
  const patch = normalizeGptImage2OfficialBatchSettings("nano-banana-pro", "2K", "1:1", "gpt-image-2.5-apimart");
  expect(patch).toMatchObject({ model: "nano-banana-pro", background: "auto", outputFormat: "png" });
  const sameFamily = normalizeGptImage2OfficialBatchSettings("gpt-image-2.5-apimart:pro", "2K", "1:1", "gpt-image-2.5-apimart");
  expect({ background: "transparent", outputFormat: "webp", ...sameFamily }).toMatchObject({ background: "transparent", outputFormat: "webp", gptImage25Mode: "sunburst" });
});

it.each(["gpt-image-2.5-apimart", "gpt-image-2.5-reapi", "gpt-image-2.5-aicoming-haiya", "gpt-image-2.5-sunburst-openrouter", "gpt-image-2.5-flare-openrouter"])("%s shows only the three background choices", async (model) => {
  let saved = { background: "auto" };
  function Harness() {
    const [settings, setSettings] = React.useState(saved);
    return React.createElement(GptImage25OutputSettings, { model, ...settings, onChange: (patch) => { saved = { ...settings, ...patch }; setSettings(saved); } });
  }
  await act(async () => root.render(React.createElement(Harness)));
  expect(Array.from(host.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["自适应", "透明", "不透明"]);
  expect(host.textContent).not.toMatch(/输出格式|JPEG|WebP/);
  await act(async () => button("透明").click());
  expect(saved).toEqual({ background: "transparent" });
  expect(button("透明").getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("不透明").click());
  expect(saved).toEqual({ background: "opaque" });
});

it.each(["nano-banana-pro", "gpt-image-2-apimart", "gpt-image-2-openrouter"])("hides unrelated controls for %s", async (model) => {
  await act(async () => root.render(React.createElement(GptImage25OutputSettings, { model, onChange: vi.fn() })));
  expect(host.textContent).toBe("");
});

it.each(["flare", "sunburst"])("batch %s uses the saved background and updates the actual settings", async (gptImage25Mode) => {
  let saved = { background: "opaque" };
  function Harness() {
    const [settings, setSettings] = React.useState(saved);
    return React.createElement(BatchParameterDock, { model: "gpt-image-2.5-aicoming-haiya", gptImage25Mode, ...settings,
      models: [{ id: "gpt-image-2.5-aicoming-haiya", label: "GPT-Image-2.5", provider: "aicoming-haiya" }],
      aspectRatio: "1:1", resolution: "2K", ratioOptions: [{ value: "1:1", label: "1:1" }], resolutionOptions: [{ value: "2K", label: "2K" }],
      disabled: false, onModelChange: vi.fn(), onAspectRatioChange: vi.fn(), onResolutionChange: vi.fn(),
      onOutputSettingsChange: (patch) => { saved = { ...settings, ...patch }; setSettings(saved); } });
  }
  await act(async () => root.render(React.createElement(Harness)));
  await act(async () => (host.querySelectorAll("button")[1] as HTMLButtonElement).click());
  await act(async () => button("透明").click());
  expect(saved).toEqual({ background: "transparent" });
});


it.each(["gpt-image-2.6-apimart", "gpt-image-2.6-flare-openrouter", "gpt-image-2.6-sunburst-openrouter"])("%s explicitly selects GIF output and exposes animation parameters", async (model) => {
  let saved: import("@/components/image/gpt-image-25-output-settings").ImageOutputSettingsPatch = { background: "transparent", outputFormat: "png" };
  function Harness() {
    const [settings, setSettings] = React.useState(saved);
    return React.createElement(GptImage25OutputSettings, { model, ...settings, onChange: patch => { saved = { ...settings, ...patch }; setSettings(saved); } });
  }
  await act(async () => root.render(React.createElement(Harness)));
  await act(async () => button("GIF 动图").click());
  expect(saved).toMatchObject({ outputFormat: "gif", background: "auto" });
  expect(host.querySelector('input[aria-label="GIF 帧数"]')?.getAttribute("max")).toBe(model.endsWith("apimart") ? "16" : "64");
  expect(host.textContent).toContain("1.80 秒");
  expect(host.textContent).not.toContain("不透明");
  await act(async () => button("静态图片").click());
  expect(saved.outputFormat).toBe("png");
  expect(button("透明")).toBeDefined();
});


it("clears GIF output when a batch changes from 2.6 to 2.5", () => {
  expect(normalizeGptImage2OfficialBatchSettings("gpt-image-2.5-apimart:fast", "2K", "auto", "gpt-image-2.6-apimart"))
    .toMatchObject({ model: "gpt-image-2.5-apimart", outputFormat: "png" });
});

it.each(["gpt-image-2.6-apimart", "gpt-image-2.6-flare-openrouter", "gpt-image-2.6-sunburst-openrouter"])("%s edits landscape, portrait and custom GIF dimensions without losing saved pixels", async (model) => {
  let saved: import("@/components/image/gpt-image-25-output-settings").ImageOutputSettingsPatch = { outputFormat: "gif", gifSize: "512x512", frameCount: 9 };
  function Harness() {
    const [settings, setSettings] = React.useState(saved);
    return React.createElement(GptImage25OutputSettings, { model, ...settings, onChange: patch => { saved = { ...settings, ...patch }; setSettings(saved); } });
  }
  await act(async () => root.render(React.createElement(Harness)));
  async function choose(label: string) {
    await act(async () => button(label.split(" · ").pop()!).click());
  }
  await choose("16:9 · 768 × 432");
  expect(saved.gifSize).toBe("768x432");
  await choose("9:16 · 432 × 768");
  expect(saved.gifSize).toBe("432x768");
  await choose("自定义尺寸");
  const width = host.querySelector('input[aria-label="GIF 单帧宽度"]') as HTMLInputElement;
  const height = host.querySelector('input[aria-label="GIF 单帧高度"]') as HTMLInputElement;
  expect(width.value).toBe("432");
  expect(height.value).toBe("768");
  const { Simulate } = await import("react-dom/test-utils");
  await act(async () => { width.value = "640"; Simulate.change(width); });
  await act(async () => { height.value = "432"; Simulate.change(height); });
  expect(saved.gifSize).toBe("640x432");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => root.render(React.createElement(GptImage25OutputSettings, { model, ...saved, onChange: vi.fn() })));
  expect((host.querySelector('input[aria-label="GIF 单帧宽度"]') as HTMLInputElement).value).toBe("640");
  expect((host.querySelector('input[aria-label="GIF 单帧高度"]') as HTMLInputElement).value).toBe("432");
});

it("explains invalid custom GIF sizes and offers only common size presets", async () => {
  await act(async () => root.render(React.createElement(GptImage25OutputSettings, { model: "gpt-image-2.6-apimart", outputFormat: "gif", gifSize: "1024x512", frameCount: 16, onChange: vi.fn() })));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("尺寸");
  const presets = Array.from(document.querySelectorAll("button")).filter(b => /^\d+ × \d+$/.test(b.textContent?.trim() || ""));
  expect(presets.map(b => b.textContent?.trim())).toEqual([
    "720 × 720", "768 × 432", "768 × 576",
    "432 × 768", "576 × 768",
  ]);
  expect(presets.every(b => !b.disabled)).toBe(true);
  expect(button("自定义尺寸").disabled).toBe(false);
});


it("lowers a saved maximum preset to medium and follows frame limits without resizing custom input", async () => {
  let saved: import("@/components/image/gpt-image-25-output-settings").ImageOutputSettingsPatch = { outputFormat: "gif", gifSize: "960x960", frameCount: 9 };
  function Harness() {
    const [settings, setSettings] = React.useState(saved);
    return React.createElement(GptImage25OutputSettings, { model: "gpt-image-2.6-apimart", ...settings, onChange: patch => { saved = { ...settings, ...patch }; setSettings(saved); } });
  }
  await act(async () => root.render(React.createElement(Harness)));
  expect(saved.gifSize).toBe("768x768");
  const { Simulate } = await import("react-dom/test-utils");
  const frames = host.querySelector('input[aria-label="GIF 帧数"]') as HTMLInputElement;
  await act(async () => { frames.value = "16"; Simulate.change(frames); });
  expect(saved).toMatchObject({ gifSize: "720x720", frameCount: 16 });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => { frames.value = "9"; Simulate.change(frames); });
  expect(saved.gifSize).toBe("768x768");
  await act(async () => button("自定义尺寸").click());
  const width = host.querySelector('input[aria-label="GIF 单帧宽度"]') as HTMLInputElement;
  const height = host.querySelector('input[aria-label="GIF 单帧高度"]') as HTMLInputElement;
  await act(async () => { width.value = "640"; Simulate.change(width); });
  await act(async () => { height.value = "432"; Simulate.change(height); });
  await act(async () => { frames.value = "16"; Simulate.change(frames); });
  expect(saved).toMatchObject({ gifSize: "640x432", frameCount: 16 });
});


it.each(["gpt-image-2.6-apimart", "gpt-image-2.6-flare-openrouter", "gpt-image-2.6-sunburst-openrouter"])("%s can select a GIF ratio inside the batch parameter panel with a real pointer sequence", async model => {
  let saved: import("@/components/image/gpt-image-25-output-settings").ImageOutputSettingsPatch = { outputFormat: "gif", gifSize: "512x512", frameCount: 9 };
  function Harness() {
    const [settings, setSettings] = React.useState(saved);
    return React.createElement(BatchParameterDock, { model, ...settings,
      models: [{ id: model, label: "GPT-Image-2.6", provider: model.endsWith("apimart") ? "apimart" : "openrouter" }],
      aspectRatio: "1:1", resolution: "2K", ratioOptions: [{ value: "1:1", label: "1:1" }], resolutionOptions: [{ value: "2K", label: "2K" }],
      disabled: false, onModelChange: vi.fn(), onAspectRatioChange: vi.fn(), onResolutionChange: vi.fn(),
      onOutputSettingsChange: patch => { saved = { ...settings, ...patch }; setSettings(saved); } });
  }
  await act(async () => root.render(React.createElement(Harness)));
  await act(async () => (host.querySelectorAll("button")[1] as HTMLButtonElement).click());
  expect(saved.gifSize).toBe("768x768");
  const option = button("768 × 432");
  expect(option.querySelector("svg")).toBeNull();
  await act(async () => option.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  expect(option.isConnected).toBe(true);
  await act(async () => option.click());
  expect(saved.gifSize).toBe("768x432");
  expect(option.getAttribute("aria-pressed")).toBe("true");
  await act(async () => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  expect(document.querySelector('[aria-label="GIF 单帧尺寸"]')).toBeNull();
});

it("keeps canvas size choices inline without a second overlapping dropdown", async () => {
  const onChange = vi.fn();
  await act(async () => root.render(React.createElement(GptImage25OutputSettings, {
    canvas: true, model: "gpt-image-2.6-apimart", outputFormat: "gif", gifSize: "768x768", frameCount: 9, onChange,
  })));
  const sizes = host.querySelector('[aria-label="GIF 单帧尺寸"]')!;
  expect(sizes.querySelectorAll("button")).toHaveLength(6);
  expect(document.querySelector('[data-frosted-select-menu]')).toBeNull();
  await act(async () => button("432 × 768").click());
  expect(onChange).toHaveBeenCalledWith({ gifSize: "432x768" });
});

it.each(["gpt-image-2.6-apimart", "gpt-image-2.6-flare-openrouter", "gpt-image-2.6-sunburst-openrouter"])("%s sliders update saved values, size limits and loop duration together", async model => {
  let saved = { outputFormat: "gif", gifSize: "768x768", frameCount: 9, frameDurationMs: 200 };
  function Harness() {
    const [settings, setSettings] = React.useState(saved);
    return React.createElement(GptImage25OutputSettings, { model, ...settings, onChange: patch => { saved = { ...settings, ...patch }; setSettings(saved); } });
  }
  await act(async () => root.render(React.createElement(Harness)));
  const { Simulate } = await import("react-dom/test-utils");
  const frames = host.querySelector('input[aria-label="GIF 帧数滑块"]') as HTMLInputElement;
  const duration = host.querySelector('input[aria-label="GIF 每帧时长滑块"]') as HTMLInputElement;
  expect(frames.type).toBe("range");
  expect(frames.max).toBe(model.endsWith("apimart") ? "16" : "64");
  await act(async () => { frames.value = "16"; Simulate.change(frames); });
  await act(async () => { duration.value = "300"; Simulate.change(duration); });
  expect(saved).toMatchObject({ frameCount: 16, frameDurationMs: 300, gifSize: model.endsWith("apimart") ? "720x720" : "768x768" });
  expect(host.querySelector('output[aria-label="GIF 单轮时长"]')?.textContent).toBe("4.80 秒");
  expect((host.querySelector('input[aria-label="GIF 帧数"]') as HTMLInputElement).value).toBe("16");
});

it("disables all GIF controls when the parent is disabled", async () => {
  await act(async () => root.render(React.createElement(GptImage25OutputSettings, {
    model: "gpt-image-2.6-apimart", outputFormat: "gif", gifSize: "768x768", disabled: true, onChange: vi.fn(),
  })));
  expect(Array.from(host.querySelectorAll("button, input")).every(control => (control as HTMLInputElement).disabled)).toBe(true);
});
