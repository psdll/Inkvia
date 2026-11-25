/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BatchParameterDock } from "@/components/batch-workbench/batch-parameter-dock";
import { normalizeGptImage2OfficialBatchSettings } from "@/components/batch-workbench/batch-settings-panel";
import type { BatchSettings } from "@/components/batch-workbench/types";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  Element.prototype.scrollIntoView = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("selects Pro and Fast as separate models, persists the chosen upstream mode and removes the mode control", async () => {
  let saved: BatchSettings = { model: "gpt-image-2.5-reapi", gptImage25Mode: "sunburst", quality: "high", aspectRatio: "9:16", resolution: "4K" };
  function Harness() {
    const [settings, setSettings] = React.useState(saved);
    return React.createElement(BatchParameterDock, {
      model: settings.model!,
      gptImage25Mode: settings.gptImage25Mode,
      quality: settings.quality,
      aspectRatio: settings.aspectRatio!,
      resolution: settings.resolution!,
      models: [{ id: "gpt-image-2.5-reapi", label: "GPT-Image-2.5", provider: "reapi" }],
      ratioOptions: [{ value: "9:16", label: "9:16" }],
      resolutionOptions: [{ value: "4K", label: "4K" }],
      disabled: false,
      onModelChange: (value) => {
        saved = { ...settings, ...normalizeGptImage2OfficialBatchSettings(value, settings.resolution!, settings.aspectRatio!, settings.model) };
        setSettings(saved);
      },
      onAspectRatioChange: vi.fn(),
      onResolutionChange: vi.fn(),
      onQualityChange: vi.fn(),
    });
  }
  await act(async () => root.render(React.createElement(Harness)));
  expect(host.textContent).toContain("GPT-Image-2.5 Pro");
  for (const [label, mode] of [["GPT-Image-2.5 Fast", "flare"], ["GPT-Image-2.5 Pro", "sunburst"]]) {
    await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
    const options = Array.from(document.querySelectorAll("button")).filter((button) => button.textContent?.trim() === label);
    expect(options).toHaveLength(1);
    await act(async () => options[0].click());
    expect(host.textContent).toContain(label);
    expect(saved).toMatchObject({ model: "gpt-image-2.5-reapi", gptImage25Mode: mode, quality: "high", resolution: "4K", aspectRatio: "9:16" });
  }
  await act(async () => (host.querySelectorAll("button")[1] as HTMLButtonElement).click());
  expect(document.body.textContent).toContain("画质");
  expect(document.body.textContent).not.toContain("快速生成");
  expect(document.body.textContent).not.toContain("精细编辑");
});
