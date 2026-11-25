// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const view = vi.hoisted(() => ({ zoom: 1 }));
vi.mock("@xyflow/react", async original => ({
  ...await original<typeof import("@xyflow/react")>(),
  Handle: () => null,
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) => selector({ transform: [0, 0, view.zoom] }),
}));
vi.mock("@/components/canvas/CanvasMediaImage", async () => {
  const React = await import("react");
  return { CanvasMediaImage: ({ src, alt }: { src: string; alt: string }) => React.createElement("img", { src, alt }) };
});

import { CanvasBreakdownNode } from "@/components/canvas/CanvasBreakdownNode";
import { CanvasNodeEditorContext, type NodeEditor } from "@/components/canvas/CanvasNodeCard";
import type { CanvasBreakdownData } from "@/lib/canvas/document";
import { applyBreakdownEvent, createBreakdownData } from "@/lib/canvas/shot-breakdown/client-state";
import { breakdownOverviewSchema, breakdownSegmentSchema, breakdownShotSchema } from "@/lib/canvas/shot-breakdown/types";

const models = [
  { providerId: "volcengine", modelId: "doubao-seed-evolving", label: "Doubao-Seed-Evolving" },
  { providerId: "bigmodel", modelId: "glm-5.3-flash", label: "GLM-5.3-Flash" },
];

function finished(): CanvasBreakdownData {
  let data = createBreakdownData({ sourceNodeId: "video-1", sourceUrl: "/uploads/ad.mp4", sourceName: "广告.mp4", providerId: "volcengine", model: "doubao-seed-evolving", now: 1 });
  data = applyBreakdownEvent(data, { type: "video", video: { duration: 6, width: 1280, height: 720, fps: 24, hasAudio: true } });
  data = applyBreakdownEvent(data, { type: "shots", shots: [
    breakdownShotSchema.parse({ index: 1, start: 0, end: 2.5, frameUrl: "/uploads/canvas_breakdowns/1.jpg", description: "女主推门进入洗衣房", shotSize: "全景", angle: "平视", movement: "固定", imagePrompt: "洗衣房，女主推门", motionPrompt: "缓慢推门" }),
    breakdownShotSchema.parse({ index: 2, start: 2.5, end: 6, frameUrl: "/uploads/canvas_breakdowns/2.jpg", description: "特写洗衣机滚筒", shotSize: "特写", angle: "俯拍", movement: "推镜" }),
  ] });
  data = applyBreakdownEvent(data, { type: "overview", overview: breakdownOverviewSchema.parse({ logline: "日常小事里的松弛感", visualDna: [{ dimension: "色调", value: "暖白" }], characters: [{ name: "女主", role: "主角", appearance: "白衬衫、马尾" }] }) });
  data = applyBreakdownEvent(data, { type: "segments", segments: [breakdownSegmentSchema.parse({ index: 1, title: "进门", start: 0, end: 6, shots: [1, 2], videoPrompt: "【成片规格】6秒 16:9" })] });
  return applyBreakdownEvent(data, { type: "done" }, 9);
}

let host: HTMLDivElement;
let root: Root;
const editorFor = () => ({
  breakdownModels: models,
  updateData: vi.fn(),
  rerunBreakdown: vi.fn(),
  cancelBreakdown: vi.fn(),
  breakdownToImageTask: vi.fn(),
  breakdownToVideoTask: vi.fn(),
  expandBreakdownFrames: vi.fn(),
}) as unknown as NodeEditor & Record<string, ReturnType<typeof vi.fn>>;

function render(data: CanvasBreakdownData, editor = editorFor(), selected = true) {
  act(() => root.render(React.createElement(CanvasNodeEditorContext.Provider, { value: editor },
    React.createElement(CanvasBreakdownNode, { id: "breakdown-1", data, width: 1040, height: 660, selected }))));
  return editor;
}
const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.includes(label));
const click = (element: Element | null | undefined) => act(() => { (element as HTMLElement).click(); });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  view.zoom = 1;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("拉片 node on the canvas", () => {
  it("makes a running breakdown unmistakable: percent, live step details and a stop button", () => {
    let data = createBreakdownData({ sourceNodeId: "video-1", sourceUrl: "/uploads/ad.mp4", sourceName: "广告.mp4", providerId: "volcengine", model: "doubao-seed-evolving", now: Date.now() - 65_000 });
    data = applyBreakdownEvent(data, { type: "video", video: { duration: 6, width: 1280, height: 720, fps: 24, hasAudio: true } });
    data = applyBreakdownEvent(data, { type: "shots", shots: [1, 2, 3, 4].map(index => breakdownShotSchema.parse({ index, start: index - 1, end: index, frameUrl: `/f/${index}.jpg`, ...(index < 3 ? { description: "已拆" } : {}) })) });
    data = applyBreakdownEvent(data, { type: "stage", stage: "shots", progress: 0.5, message: "逐镜拆解 2/4" });
    const editor = render(data);
    expect(host.querySelector(".canvas-breakdown-pill")?.textContent).toBe("拉片中");
    expect(host.querySelector(".canvas-breakdown-percent")?.textContent).toBe("50%");
    // Overview and shot analysis run side by side: both show as in progress.
    const active = [...host.querySelectorAll(".canvas-breakdown-checklist li[data-state=active]")].map(item => item.textContent);
    expect(active).toEqual([expect.stringContaining("通看全片"), expect.stringContaining("2/4")]);
    expect([...host.querySelectorAll(".canvas-breakdown-checklist li[data-state=done]")].map(item => item.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("4 个镜头")]));
    expect(host.textContent).toMatch(/用时 1 分 0[45] 秒/);
    expect(host.querySelectorAll(".canvas-breakdown-filmstrip img")).toHaveLength(4);
    click(button("停止"));
    expect(editor.cancelBreakdown).toHaveBeenCalledWith("breakdown-1");
  });

  it("summarises a finished run and jumps to what it placed on the canvas", () => {
    const editor = Object.assign(editorFor(), { locateCanvasNode: vi.fn() });
    render({ ...finished(), outputs: { overview: "doc-overview", styles: ["s1", "s2"], segments: [{ index: 1, clip: "clip-1", doc: "doc-1" }] } }, editor);
    expect(host.querySelector(".canvas-breakdown-pill")?.textContent).toBe("已完成");
    expect([...host.querySelectorAll(".canvas-breakdown-stats b")].map(item => item.textContent).slice(0, 3)).toEqual(["6.0s", "2", "1"]);
    const outputs = [...host.querySelectorAll<HTMLButtonElement>(".canvas-breakdown-output")];
    expect(outputs.map(item => item.querySelector("b")?.textContent)).toEqual(["全片创作拆解", "风格参考 ×2", "复刻片段 ×1"]);
    click(outputs[2]);
    expect(editor.locateCanvasNode).toHaveBeenCalledWith("doc-1");
  });

  it("re-runs with whichever model the user picks", () => {
    const editor = render(finished());
    const select = host.querySelector<HTMLSelectElement>("select[aria-label=拉片模型]")!;
    expect(select.value).toBe("volcengine:doubao-seed-evolving");
    act(() => {
      select.value = "bigmodel:glm-5.3-flash";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(button("重新拉片"));
    expect(editor.rerunBreakdown).toHaveBeenCalledWith("breakdown-1", models[1]);
  });

  it("keeps a failed run's reason visible with a retry", () => {
    const failed = applyBreakdownEvent(finished(), { type: "error", error: "视频上传到云存储超时（网络繁忙），请稍后重新拉片" });
    const editor = render(failed);
    expect(host.querySelector(".canvas-breakdown-pill")?.textContent).toBe("失败");
    expect(host.querySelector("[role=alert]")?.textContent).toContain("视频上传到云存储超时");
    click(button("重新拉片"));
    expect(editor.rerunBreakdown).toHaveBeenCalledWith("breakdown-1", models[0]);
  });

  it("stays readable when zoomed far out", () => {
    view.zoom = 0.2;
    const running = applyBreakdownEvent(createBreakdownData({ sourceNodeId: "v", sourceUrl: "/a.mp4", sourceName: "广告", providerId: "p", model: "m" }), { type: "stage", stage: "overview", progress: 0.2, message: "通看全片" });
    render(running);
    expect(host.querySelector("[data-canvas-breakdown-glance] b")?.textContent).toBe("拉片中 20%");
    expect(button("停止")).toBeUndefined();
  });

  it("opens the full shot table with per-shot actions and exports, and closes on Escape", () => {
    const editor = render(finished(), editorFor(), false);
    click(host.querySelector("button[aria-label=全屏查看]"));
    const dialog = document.querySelector("[role=dialog]")!;
    expect(dialog.querySelectorAll("thead th")).toHaveLength(18);
    expect(dialog.querySelectorAll("tbody tr")).toHaveLength(2);
    expect([...dialog.querySelectorAll("button")].map(item => item.textContent)).toEqual(expect.arrayContaining(["复制 Markdown", "下载 Markdown", "下载 CSV"]));
    click([...dialog.querySelectorAll("button")].find(item => item.textContent === "生成首帧"));
    expect(editor.breakdownToImageTask).toHaveBeenCalledWith("breakdown-1", 1);
    expect(document.querySelector("[role=dialog]")).toBeNull();
    click(host.querySelector("button[aria-label=全屏查看]"));
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
});
