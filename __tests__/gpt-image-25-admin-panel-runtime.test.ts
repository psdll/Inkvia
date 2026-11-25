import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/client/inflight-json", () => ({ fetchJsonOnce: mocks.load }));
vi.mock("@/lib/toolbox-model-visibility-events", () => ({ publishToolboxModelVisibilityChanged: mocks.publish }));
import ImageEditModelsPanel from "@/components/admin/ImageEditModelsPanel";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

it("shows API tool models as read-only rows while retaining media switches", async () => {
  mocks.load.mockResolvedValue({ ok: true, json: {
    success: true,
    providers: [{ id: "volcengine-mediakit", name: "火山引擎 AI MediaKit", enabled: true }],
    models: [
      { id: "subtitle", modelId: "erase-video-subtitle-pro-v5", label: "erase-video-subtitle-pro-v5", provider: "volcengine-mediakit", category: "video", visibilityControl: false },
      { id: "regular", label: "常规模型", provider: "volcengine-mediakit", category: "video" },
    ],
    visibility: { regular: true }, resolutionVisibility: {}, durationVisibility: {}, displayNames: {},
  } });
  await act(async () => root.render(React.createElement(ImageEditModelsPanel)));
  const row = host.querySelector('[aria-label="erase-video-subtitle-pro-v5 · 火山引擎 AI MediaKit"]')!;
  expect(row.textContent).toContain("无需显示开关");
  expect(row.querySelector('[role="switch"]')).toBeNull();
  expect(row.querySelector('[aria-label^="修改名称"]')).toBeNull();
  expect(host.querySelectorAll('[role="switch"]')).toHaveLength(1);
});

it("omits empty providers but keeps providers whose existing models are hidden", async () => {
  const previousSelection = sessionStorage.getItem("admin-page:display-provider");
  sessionStorage.setItem("admin-page:display-provider", "jiekou");
  mocks.load.mockResolvedValue({ ok: true, json: {
    success: true,
    providers: [{ id: "jiekou", name: "接口AI", enabled: true }, { id: "bigmodel", name: "智谱 BigModel", enabled: false }],
    models: [{ id: "llm", modelId: "glm-5.3", label: "GLM-5.3", provider: "bigmodel", category: "llm" }],
    visibility: { llm: false }, resolutionVisibility: {}, durationVisibility: {}, displayNames: {},
  } });
  try {
    await act(async () => root.render(React.createElement(ImageEditModelsPanel)));
    const sidebar = host.querySelector('[aria-label="模型供应商"]')!;
    expect(sidebar.textContent).not.toContain("接口AI");
    expect(sidebar.textContent).toContain("智谱 BigModel");
    expect(host.querySelector('[aria-label="GLM-5.3 · 智谱 BigModel"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="开启 GLM-5.3 bigmodel"]')).not.toBeNull();
  } finally {
    if (previousSelection === null) sessionStorage.removeItem("admin-page:display-provider");
    else sessionStorage.setItem("admin-page:display-provider", previousSelection);
  }
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("shows separate editable Fast and Pro rows and saves only the toggled switch", async () => {
  const base = "gpt-image-2.5-aicoming-haiya";
  const overview = {
    success: true,
    providers: [{ id: "aicoming-haiya", name: "aicoming-haiya", enabled: true }],
    models: ["Fast", "Pro"].map((name) => ({ id: `${base}:${name.toLowerCase()}`, label: `GPT-Image-2.5 ${name}（hai）`, provider: "aicoming-haiya", category: "image" })),
    visibility: { [`${base}:fast`]: true, [`${base}:pro`]: true },
    resolutionVisibility: {}, durationVisibility: {}, displayNames: {},
  };
  mocks.load.mockResolvedValue({ ok: true, json: overview });
  const save = vi.fn(async (_url: string, options: RequestInit) => ({ ok: true, json: async () => ({ ...overview, ...JSON.parse(String(options.body)) }) }));
  vi.stubGlobal("fetch", save);
  await act(async () => root.render(React.createElement(ImageEditModelsPanel)));
  expect(Array.from(host.querySelectorAll('button[aria-label^="修改名称"]')).map(button => button.textContent)).toEqual(["GPT-Image-2.5 Fast（hai）", "GPT-Image-2.5 Pro（hai）"]);
  await act(async () => (host.querySelector('[aria-label="关闭 GPT-Image-2.5 Fast（hai） aicoming-haiya"]') as HTMLButtonElement).click());
  expect(host.querySelector('[aria-label="开启 GPT-Image-2.5 Fast（hai） aicoming-haiya"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="关闭 GPT-Image-2.5 Pro（hai） aicoming-haiya"]')).not.toBeNull();
  const saveButton = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("保存全部修改"))!;
  await act(async () => saveButton.click());
  expect(save).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(save.mock.calls[0][1].body)).visibility).toEqual({ [`${base}:fast`]: false, [`${base}:pro`]: true });
  expect(mocks.publish).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[aria-label="开启 GPT-Image-2.5 Fast（hai） aicoming-haiya"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="关闭 GPT-Image-2.5 Pro（hai） aicoming-haiya"]')).not.toBeNull();
});
