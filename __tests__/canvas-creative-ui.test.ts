// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imageAnglePrompt, anglePresets } from "@/lib/canvas/creative-presets/angle";
import { CanvasAngleButton, CanvasAngleEditor } from "@/components/canvas/creative/CanvasAngleEditor";
import { CanvasPanelHiddenContext } from "@/components/canvas/canvas-runtime-context";
import type { CanvasCreativeSettings } from "@/lib/canvas/creative-presets/types";
vi.mock("@xyflow/react", async importOriginal => ({
  ...await importOriginal<typeof import("@xyflow/react")>(),
  NodeToolbar: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
}));
vi.mock("@/components/canvas/use-canvas-models", () => ({
  useCanvasModels: () => ({ image: [{ id: "nano-banana-pro", label: "Nano Banana Pro" }] }),
  resolveCanvasModelId: (models: { id: string }[], requested: string) => models.some(model => model.id === requested) ? requested : models[0]?.id || "",
}));
vi.mock("@/components/canvas/use-canvas-image-resolution", () => ({ useCanvasImageResolution: () => "2752 × 1536" }));
let root: Root, host: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function click(text: string) { await act(async () => { const btn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.getAttribute("aria-label") === text || b.textContent === text); expect(btn, text).toBeTruthy(); btn!.click(); }); }
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
describe("creative panel interactions", () => {
  it("moves the camera and prompt in the same direction for all four controls", async () => {
    act(() => root.render(React.createElement(CanvasAngleEditor, { imageUrl: "/ref.png", onApply: vi.fn(), onClose: vi.fn() })));
    await click("启用补充提示词");
    const camera = () => {
      const line = document.querySelector('[data-angle-sightline] line')!;
      return { x: Number(line.getAttribute("x1")), y: Number(line.getAttribute("y1")) };
    };
    const prompt = () => imageAnglePrompt({
      azimuth: Number(document.querySelector<HTMLInputElement>('input[aria-label="水平环绕"]')!.value),
      elevation: Number(document.querySelector<HTMLInputElement>('input[aria-label="垂直俯仰"]')!.value), zoom: 5,
    });
    const origin = camera();
    await click("向右环绕");
    expect(camera().x).toBeGreaterThan(origin.x);
    expect(prompt()).toContain("水平环绕 45°：相对原图向右环绕 45°");
    await click("向左环绕"); expect(camera()).toEqual(origin);
    await click("向左环绕");
    expect(camera().x).toBeLessThan(origin.x);
    expect(prompt()).toContain("水平环绕 315°：相对原图向左环绕 45°");
    await click("向右环绕"); expect(camera()).toEqual(origin);
    await click("抬高机位");
    expect(camera().y).toBeLessThan(origin.y);
    expect(prompt()).toContain("俯仰 30°：相对原图向上环绕 30°，抬高机位俯拍");
    await click("降低机位"); expect(camera()).toEqual(origin);
    await click("降低机位");
    expect(camera().y).toBeGreaterThan(origin.y);
    expect(prompt()).toContain("俯仰 -30°：相对原图向下环绕 30°，降低机位仰拍");
  });
  it("edits supplements independently, swaps preset phrases without losing user text, and submits them", async () => {
    const apply = vi.fn();
    act(() => root.render(React.createElement(CanvasAngleEditor, { imageUrl: "/ref.png", onApply: apply, onClose: vi.fn() })));
    await click("启用补充提示词");
    expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("");
    const write = async (value: string) => act(async () => {
      const field = document.querySelector<HTMLTextAreaElement>("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await write("保留原图材质");
    await click("鱼眼视角");
    const fish = `保留原图材质\n${anglePresets[0].prompt}`;
    expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(fish);
    await click("鱼眼视角");
    expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(fish);
    await click("倾斜视角");
    const tilted = `保留原图材质\n${anglePresets[1].prompt}`;
    expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(tilted);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="水平环绕"]')!.value).toBe("45");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="垂直俯仰"]')!.value).toBe("-30");
    await click("向右环绕");
    expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(tilted);
    await write(`${tilted}，稍微倾斜`);
    await click("启用补充提示词");
    await click("生成新角度");
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ azimuth: 90, elevation: -30 }), expect.objectContaining({ prompt: "" }));
    await click("启用补充提示词");
    expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(`${tilted}，稍微倾斜`);
    await click("生成新角度");
    expect(apply).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ prompt: `${tilted}，稍微倾斜` }));
    await click("向上俯拍");
    expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("保留原图材质\n，稍微倾斜");
  });
  it("automatically enables both effect presets but does not hide their effects in angle metadata", async () => {
    const apply = vi.fn();
    act(() => root.render(React.createElement(CanvasAngleEditor, { imageUrl: "/ref.png", onApply: apply, onClose: vi.fn() })));
    for (const preset of anglePresets.slice(0, 2)) {
      await click(preset.name);
      expect(document.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
      expect(document.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(preset.prompt);
      await click("生成新角度");
      expect(apply).toHaveBeenLastCalledWith(preset.value, expect.objectContaining({ prompt: preset.prompt }));
      await click("启用补充提示词");
    }
  });
  it("notifies the host to swap panels and restores it on close or deselection", async () => {
    const changed = vi.fn();
    act(() => root.render(React.createElement(CanvasAngleButton, { imageUrl: "/ref.png", onApply: vi.fn(), onOpenChange: changed })));
    await click("角度");
    expect(changed).toHaveBeenLastCalledWith(true);
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-modal")).toBe("false");
    await click("关闭角度面板");
    expect(changed).toHaveBeenLastCalledWith(false);
    await click("角度");
    act(() => root.render(null));
    expect(changed).toHaveBeenLastCalledWith(false);
  });
  it("uses the image parameter popover and submits the selected ratio and resolution", async () => {
    const apply = vi.fn();
    act(() => root.render(React.createElement(CanvasAngleEditor, { inline: true, imageUrl: "/ref.png", onApply: apply, onClose: vi.fn() })));
    await click("角度生成参数");
    expect(document.querySelector(".canvas-image-parameter-ratio-grid")).toBeTruthy();
    await click("4K"); await click("9:16");
    expect(document.querySelector('[aria-label="角度生成参数"]')?.textContent).toContain("9:16 · 4K");
    await click("生成新角度");
    expect(apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ model: "nano-banana-pro", aspectRatio: "9:16", resolution: "4K" }));
  });
  it("inserts the fisheye supplement, resets, and blocks double submit", async () => {
    let resolve!: () => void;
    const apply = vi.fn((_angle: import("@/lib/canvas/creative-presets/types").ImageAngle) => new Promise<void>(done => { resolve = done; })), close = vi.fn();
    act(() => root.render(React.createElement(CanvasAngleEditor, { imageUrl: "/ref.png", onApply: apply, onClose: close })));
    expect(document.querySelector('[aria-label="角度生成模型"]')?.textContent).toContain("Nano Banana Pro");
    expect(document.querySelector('[aria-label="角度生成参数"]')?.textContent).toContain("原图比例");
    expect(document.querySelector('[aria-label="角度生成参数"]')?.textContent).toContain("2K");
    await click("鱼眼视角");
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(anglePresets[0].prompt);
    expect(document.querySelector("pre")).toBeNull();
    await click("重置参数");
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
    await click("反向视角"); await click("生成新角度"); await click("生成新角度");
    expect(apply).toHaveBeenCalledTimes(1); expect(apply.mock.calls[0][0]).toMatchObject({ azimuth: 180, elevation: 0, zoom: 5 });
    await act(async () => { resolve(); }); expect(close).toHaveBeenCalledTimes(1);
  });
  it("moves the orbit with arrows and keys, clamps poles, and consumes wheel without scrolling the canvas", async () => {
    const apply = vi.fn();
    act(() => root.render(React.createElement(CanvasAngleEditor, { imageUrl: "/ref.png", onApply: apply, onClose: vi.fn() })));
    const surface = document.querySelector<HTMLElement>('[aria-label="拖动球形轨道调整视角"]')!;
    const value = (name: string) => Number(document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!.value);
    const sightline = document.querySelector('[data-angle-sightline]')!;
    const sourceImage = document.querySelector('[data-angle-subject] image')!;
    expect(document.querySelector('[data-angle-subject] rect')).toBeNull();
    expect(sourceImage.compareDocumentPosition(sightline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sightline.querySelector("line")!.getAttribute("x2")).toBe("120");
    expect(sightline.querySelector("line")!.getAttribute("y2")).toBe("120");
    // Browsers round a range value to its step; jsdom does not. Fine drag/key values must remain representable.
    expect(document.querySelector<HTMLInputElement>('input[aria-label="垂直俯仰"]')!.step).toBe("1");
    await click("向左环绕"); expect(value("水平环绕")).toBe(315);
    await click("向右环绕"); expect(value("水平环绕")).toBe(0);
    for (let i = 0; i < 4; i++) await click("降低机位");
    expect(value("垂直俯仰")).toBe(-90);
    expect(document.querySelector<HTMLButtonElement>('[aria-label="降低机位"]')!.disabled).toBe(true);
    await act(async () => { surface.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true })); });
    expect(value("垂直俯仰")).toBe(-85);
    const wheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    const subjectBefore = document.querySelector('[data-angle-subject]')!.getAttribute("transform");
    const screenWidthBefore = Number(document.querySelector('[data-angle-screen-preview]')?.getAttribute("width"));
    const parentWheel = vi.fn(); document.body.addEventListener("wheel", parentWheel);
    try {
      await act(async () => { surface.dispatchEvent(wheel); });
      expect(wheel.defaultPrevented).toBe(true); expect(parentWheel).not.toHaveBeenCalled();
      expect(value("景别缩放")).toBe(5.3);
      expect(document.querySelector('[data-angle-subject]')!.getAttribute("transform")).not.toBe(subjectBefore);
      expect(Number(document.querySelector('[data-angle-screen-preview]')?.getAttribute("width"))).toBeGreaterThan(screenWidthBefore);
    } finally { document.body.removeEventListener("wheel", parentWheel); }
    await click("启用补充提示词"); expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
    await click("生成新角度"); expect(apply).toHaveBeenCalledWith(expect.objectContaining({ azimuth: 0, elevation: -85, zoom: 5.3 }), expect.objectContaining({ model: "nano-banana-pro", aspectRatio: "auto", resolution: "2K" }));
  });
});
