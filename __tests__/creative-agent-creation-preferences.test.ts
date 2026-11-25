// @vitest-environment jsdom
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreationPreferencesPanel, { type CreationModelCatalog } from "@/components/creative-agent/CreationPreferencesPanel";
import { creationPreferencesKey, emptyCreationPreferences, readCreationPreferences, saveCreationPreferences, type CreationPreferences } from "@/components/creative-agent/creation-preferences-cache";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { getVideoModelSpec, SEEDANCE_20_MODEL_ID, SEEDANCE_25_MODEL_ID } from "@/lib/sora2";
let root: Root, host: HTMLElement;
let onChange: ReturnType<typeof vi.fn>, onClose: ReturnType<typeof vi.fn>;
const catalog: CreationModelCatalog = {
  chat: [{ providerId: "deepseek", modelId: "deepseek-flash", thinkingLevels: ["default", "low", "high", "max"], thinkingDefault: "high" }],
  image: ["gpt-image-2-apimart", "gpt-image-2-jiekou", "nano-banana-2-1"].map(id => ({ id, label: id, params: getImageModelParams(id) })),
  video: [SEEDANCE_20_MODEL_ID, SEEDANCE_25_MODEL_ID].map(id => ({ id, label: id, params: getVideoModelSpec(id) })),
};
function PreferenceHarness({ initialValue, models }: { initialValue: CreationPreferences; models: CreationModelCatalog }) {
  const [value, setValue] = React.useState(initialValue);
  return React.createElement(CreationPreferencesPanel, { anchorRef: { current: null }, composerRef: { current: null }, value, catalog: models, loading: false, error: "", onChange: next => { setValue(next); onChange(next); }, onClose });
}
const render = async (value = emptyCreationPreferences(), models = catalog) => act(async () => root.render(React.createElement(PreferenceHarness, { initialValue: value, models })));
const button = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.startsWith(label) || button.getAttribute("aria-label") === label)!;
const click = async (label: string) => act(async () => { expect(button(label), label).toBeDefined(); button(label).click(); });
const group = (label: string) => document.body.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`)!;
const choice = (label: string, value: string) => group(label)?.querySelector<HTMLButtonElement>(`button[data-value="${value}"]`);
const select = async (label: string, value: string) => {
  if (label === "视频时长（秒）" && !document.body.querySelector(`select[aria-label="${label}"]`)) await click("自定义时长");
  await act(async () => {
    const element = document.body.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
    if (element) {
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      expect(choice(label, value), label).not.toBeNull();
      choice(label, value)!.click();
    }
  });
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  onChange = vi.fn(); onClose = vi.fn();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals(); });

describe("creation preference media controls", () => {
  it("shows renamed LLMs and saves their original provider/model identity", async () => {
    await render(emptyCreationPreferences(), { ...catalog, chat: [
      { providerId: "one", modelId: "shared", label: "One · 文本助手" },
      { providerId: "two", modelId: "shared", label: "Two · 备用助手" },
    ] });
    await click("推理模型");
    expect(button("文本助手")).toBeDefined();
    await click("备用助手");
    expect(onChange.mock.calls.at(-1)![0].model).toBe("two::shared");
  });
  it("does not recreate hidden models from saved preferences", async () => {
    await render({ model: "test::hidden-chat", thinkingLevel: "default", media: { image: { mode: "explicit", model: "hidden-image" }, video: { mode: "explicit", model: "hidden-video" } } });
    for (const tab of ["推理模型", "图片偏好", "视频偏好"]) {
      await click(tab);
      expect(document.body.querySelector('[role="tabpanel"]')?.textContent).not.toContain("hidden-");
      expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
    }
  });
  it.each(["视频偏好", "图片偏好"])("defaults %s to smart matching without an unset option", async tab => {
    const value = emptyCreationPreferences();
    await render(value); await click(tab);
    expect(document.body.querySelector('[role="tabpanel"]')?.textContent).not.toContain("未选择");
    expect(document.body.querySelector('[data-model-choice][aria-pressed="true"]')?.textContent).toContain("智能匹配模型");
    expect(group(tab === "视频偏好" ? "视频比例" : "图片比例")).not.toBeNull();
    expect(value.media).toEqual({ image: { mode: "auto" }, video: { mode: "auto" } });
    expect(onChange).not.toHaveBeenCalled();
    await click("智能匹配模型");
    expect(onChange.mock.calls.at(-1)![0].media).toEqual({ image: { mode: "auto" }, video: { mode: "auto" } });
  });
  it("saves explicit image parameters from real model capabilities", async () => {
    await render(); await click("图片偏好"); await click("gpt-image-2-apimart");
    await select("图片比例", "16:9"); await select("图片分辨率", "2K"); await select("图片质量", "high");
    expect(onChange.mock.calls.at(-1)![0].media.image).toEqual({ mode: "explicit", model: "gpt-image-2-apimart", params: { aspectRatio: "16:9", resolution: "2K", quality: "high" } });
    expect(onChange.mock.calls.at(-1)![0].media.video).toEqual({ mode: "auto" });
  });
  it("saves auto video constraints and preserves explicit false for audio", async () => {
    await render(); await click("视频偏好"); await click("智能匹配模型");
    await select("视频分辨率", "1080p"); await select("视频时长（秒）", "10"); await select("视频声音", "false");
    expect(onChange.mock.calls.at(-1)![0].media.video).toEqual({ mode: "auto", params: { resolution: "1080p", duration: 10, generateAudio: false } });
  });
  it.each([{ id: SEEDANCE_25_MODEL_ID, ratio: "adaptive" }, { id: "grok-video-1.5", ratio: "auto" }])("labels $ratio as 自适应 while saving its original ratio value", async ({ id, ratio }) => {
    await render(emptyCreationPreferences(), { ...catalog, video: [{ id, label: id, params: getVideoModelSpec(id) }] });
    await click("视频偏好"); await click(id);
    expect(choice("视频比例", ratio)?.textContent).toBe("自适应");
    await select("视频比例", ratio);
    expect(onChange.mock.calls.at(-1)![0].media.video.params.ratio).toBe(ratio);
  });
  it("applies model changes while keeping incompatible parameters visible until reset", async () => {
    await render({ ...emptyCreationPreferences(), media: { image: { mode: "explicit", model: "gpt-image-2-apimart", params: { quality: "high" } } } });
    await click("图片偏好"); await click("nano-banana-2-1");
    expect(choice("图片质量", "high")?.getAttribute("aria-pressed")).toBe("true");
    expect(group("图片质量").getAttribute("aria-invalid")).toBe("true");
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("图片固定参数");
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
    await select("图片质量", "");
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
    expect(onChange.mock.calls.at(-1)![0].media.image.params).toEqual({});
  });
  it("rejects auto constraints if no single available model fits their combination", async () => {
    const constrained: CreationPreferences = { ...emptyCreationPreferences(), media: { video: { mode: "auto", params: { duration: 30, resolution: "4k" } } } };
    await render(constrained); await click("视频偏好");
    // Seedance 2.0 supports 4k and 15s; 2.5 supports 30s but not 4k.
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("视频固定参数");
    expect(document.body.querySelector<HTMLSelectElement>('select[aria-label="视频时长（秒）"]')?.value).toBe("30");
    await select("视频分辨率", "1080p");
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });
  it("uses linked image ratio/resolution restrictions without clearing the saved combination", async () => {
    await render({ ...emptyCreationPreferences(), media: { image: { mode: "explicit", model: "gpt-image-2-jiekou", params: { aspectRatio: "1:3", resolution: "1K" } } } });
    await click("图片偏好");
    const expected = getImageModelParams("gpt-image-2-jiekou", "1K", "1:3");
    expect(choice("图片比例", "1:3")?.getAttribute("aria-pressed")).toBe("true");
    for (const option of expected.aspectRatios) expect(choice("图片比例", option.value)?.disabled).toBe(Boolean(option.disabled));
    expect(Boolean(document.body.querySelector('[role="alert"]'))).toBe(expected.aspectRatios.find(option => option.value === "1:3")?.disabled === true || expected.resolutions.find(option => option.value === "1K")?.disabled === true);
  });
  it("reports unavailable preferences without showing hidden choices and lets the user return to smart matching", async () => {
    await render({ ...emptyCreationPreferences(), model: "removed::llm", media: { image: { mode: "explicit", model: "removed-image", params: { background: "transparent" } } } });
    expect(document.body.textContent).toContain("对话模型已不可用"); expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
    await click("图片偏好"); expect(document.body.textContent).toContain("图片模型已不可用");
    expect(document.body.querySelector('[aria-label="图片背景"]')).not.toBeNull();
    await click("智能匹配模型");
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
    await click("全部参数恢复智能"); await click("推理模型");
    await click("deepseek-flash");
    expect(onChange.mock.calls.at(-1)![0].media.image).toEqual({ mode: "auto", params: {} });
  });
  it("traps Tab focus and does not treat child pointer events as backdrop dismissal", async () => {
    await render();
    await act(async () => button("默认").focus());
    await act(async () => button("默认").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(button("视频偏好"));
    await act(async () => button("视频偏好").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(button("默认"));
    await act(async () => button("关闭创作偏好").dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();
  });
  it("returns custom duration to automatic without clearing other video constraints", async () => {
    await render(); await click("视频偏好"); await click("智能匹配模型");
    await select("视频分辨率", "1080p"); await select("视频时长（秒）", "10");
    await click("智能时长");
    expect(document.body.querySelector('select[aria-label="视频时长（秒）"]')).toBeNull();
    expect(onChange.mock.calls.at(-1)![0].media.video).toEqual({ mode: "auto", params: { resolution: "1080p" } });
  });
});

describe("account and conversation preference cache", () => {
  it.each(["broken-json", JSON.stringify({ media: { image: "invalid" } }), JSON.stringify({ media: { video: { mode: "explicit" } } }), JSON.stringify({ media: { video: { mode: "auto", params: { duration: -1 } } } })])("ignores corrupted preferences %s", saved => {
    const key = creationPreferencesKey("7", 17, "s"); localStorage.setItem(key, saved);
    expect(readCreationPreferences(key, 17, "s")).toEqual(emptyCreationPreferences());
  });
  it("never reads or writes anonymous records", () => {
    localStorage.setItem("creative-agent:preferences:v1:17:s", JSON.stringify({ model: "old::llm" }));
    expect(creationPreferencesKey("", 17, "s")).toBe(""); expect(readCreationPreferences("", 17, "s")).toEqual(emptyCreationPreferences());
    saveCreationPreferences("", emptyCreationPreferences()); expect(localStorage.length).toBe(1);
  });
  it("keeps users, canvases and sessions separate across reload without claiming unowned v1", () => {
    const first = creationPreferencesKey("7", 17, "s"), otherUser = creationPreferencesKey("8", 17, "s"), otherCanvas = creationPreferencesKey("7", 18, "s"), otherSession = creationPreferencesKey("7", 17, "other");
    localStorage.setItem("creative-agent:preferences:v1:17:s", JSON.stringify({ model: "old::llm", media: { image: "old-image" }, thinkingLevel: "high" }));
    const migrated = readCreationPreferences(first, 17, "s");
    expect(migrated).toEqual(emptyCreationPreferences());
    expect(readCreationPreferences(otherUser, 17, "s")).toEqual(emptyCreationPreferences());
    expect(readCreationPreferences(otherCanvas, 18, "s")).toEqual(emptyCreationPreferences());
    expect(readCreationPreferences(otherSession, 17, "other")).toEqual(emptyCreationPreferences());
    expect(readCreationPreferences(first, 17, "s")).toEqual(migrated);
  });
});

it("migrates scoped v2 preferences in memory without writing on read", () => {
 const old = "creative-agent:preferences:v2:7:17:s", key = creationPreferencesKey("7", 17, "s");
 localStorage.setItem(old, JSON.stringify({ model: "test::llm", media: { imageModel: "legacy", video: { mode: "explicit", model: "video" } } }));
 const write = vi.spyOn(Storage.prototype, "setItem");
 expect(key).toBe("creative-agent:preferences:v3:7:17:s");
 expect(readCreationPreferences(key, 17, "s").media).toEqual({ image: { mode: "explicit", model: "legacy" }, video: { mode: "explicit", model: "video" } });
 expect(write).not.toHaveBeenCalled(); write.mockRestore();
});

it("never persists per-turn requirements or effective overrides with saved defaults", () => {
  const key = creationPreferencesKey("7", 17, "s");
  const value = { model: "test::llm", thinkingLevel: "default" as const, media: { image: { mode: "explicit" as const, model: "saved" } }, effectivePreferences: { image: { mode: "explicit", model: "temporary" } }, requirements: { revision: 3 } };
  saveCreationPreferences(key, value);
  const stored = JSON.parse(localStorage.getItem(key)!);
  expect(stored).not.toHaveProperty("effectivePreferences"); expect(stored).not.toHaveProperty("requirements");
  expect(readCreationPreferences(key, 17, "s").media.image?.model).toBe("saved");
});

it('shows only the server-visible image parameters, intersected with linked combinations', async () => {
 const params=getImageModelParams('gpt-image-2-apimart');
 await render(emptyCreationPreferences(),{...catalog,image:[{id:'gpt-image-2-apimart',label:'Visible',params:{...params,resolutions:params.resolutions.filter(p=>p.value==='1K')}}]});
 await click('图片');expect(choice('图片分辨率','2K')).toBeNull();expect(choice('图片分辨率','1K')).not.toBeNull();
});
it('expands only administrator-enabled variants in the ordinary preference selector', async () => {
 await render(emptyCreationPreferences(),{...catalog,image:[{id:'gpt-image-2.5-reapi',label:'Image',params:getImageModelParams('gpt-image-2.5-reapi'),gptImage25Variants:[{mode:'sunburst',label:'Only Pro'}]}]});
 await click('图片');expect(document.body.textContent).toContain('Only Pro');expect(document.body.textContent).not.toContain('快速生成');
 await click('Only Pro');expect(onChange.mock.calls.at(-1)?.[0].media.image).toMatchObject({mode:'explicit',model:'gpt-image-2.5-reapi:pro'});
});
