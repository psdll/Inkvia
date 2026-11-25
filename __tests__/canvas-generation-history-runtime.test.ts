import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CanvasGenerationHistory from "@/components/canvas/CanvasGenerationHistory";

vi.mock("@/components/ui/resilient-image", () => ({ warmResilientImageCandidatesBatch: () => () => {} }));
vi.mock("@/components/ui/media-image", () => ({ MediaImage: ({ src, alt, className }: any) => React.createElement("img", { src, alt, className }) }));
vi.mock("@/lib/generation-deletion-events", () => ({ subscribeGenerationDeleted: () => () => {}, isKnownDeletedGenerationId: () => false, publishGenerationDeleted: vi.fn() }));

let root: Root, host: HTMLDivElement, client: QueryClient;
const add = vi.fn(), close = vi.fn(), fetchMock = vi.fn();
let gridWidth = 1000, gridHeight = 400;
const resizeCallbacks = new Set<() => void>();
const resizeGrid = async (width: number, height = 400) => {
  await act(async () => { gridWidth = width; gridHeight = height; resizeCallbacks.forEach(callback => callback()); });
};
const assets = (kind = "image", count = 60) => Array.from({ length: count }, (_, index) => ({ id: index + 1, canvasId: 8, type: kind === "image" ? "image_edit" : "video_gen", displayKind: kind, localPath: `/uploads/${index + 1}.${kind === "video" ? "mp4" : "png"}`, thumbUrl: kind === "video" ? null : `/uploads/thumb-${index + 1}.png`, posterUrl: null, previewUrl: null, createdAt: "2026-09-10T03:00:00Z" }));
const response = (payload: unknown, status = 200) => Promise.resolve({ ok: status === 200, status, json: async () => payload });
const render = async (open = true, owner: number = 7, selectionKind?: "image" | "video" | "audio") => {
  await act(async () => { root.render(React.createElement(QueryClientProvider, { client }, React.createElement(CanvasGenerationHistory, { open, owner, canvasId: 8, onClose: close, onAdd: add, selectionKind }))); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
};
function button(label: string) {
  const element = [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.getAttribute("aria-label") === label || node.textContent?.trim() === label);
  if (!element) throw new Error(`Missing button: ${label}`);
  return element;
}
const click = async (label: string) => { await act(async () => button(label).click()); await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  gridWidth = 1000; gridHeight = 400; resizeCallbacks.clear();
  vi.stubGlobal("ResizeObserver", class { constructor(private callback: () => void) {} observe() { resizeCallbacks.add(this.callback); } unobserve() {} disconnect() { resizeCallbacks.delete(this.callback); } });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => gridWidth });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => gridHeight });
  sessionStorage.clear(); localStorage.clear();
  add.mockReset(); close.mockReset(); fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, options?: RequestInit) => {
    if (url === "/api/toolbox/model-display-names") return response({ displayNames: { "示例模型": "用户模型名称" } });
    if (options?.method === "DELETE") return response({ success: true });
    if (/\/api\/assets\/\d+/.test(url)) return response({ item: { ...assets()[0], prompt: "测试提示词", model: "示例模型", creator: "测试用户", params: { resolution: "2K", seed: 12 }, references: [{ url: "/uploads/reference.png", kind: "image" }, { url: "/uploads/reference.mp3", kind: "audio" }] } });
    const params = new URL(url, "http://localhost").searchParams;
    if (params.get("count") === "1") return response({ image: 60, video: 1, audio: 0 });
    return response({ items: assets(params.get("type") || "image", params.get("type") === "video" ? 1 : 60), nextCursor: null, hasMore: false });
  });
  vi.stubGlobal("fetch", fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("canvas generation history interactions", () => {
  it("hides raw image dimensions while preserving resolution and other parameters", async () => {
    client.setQueryData(["canvas-generation-history-v2", 7, "detail", 1], {
      ...assets()[0], prompt: "测试提示词", model: "gpt-image-2.5-reapi", creator: null,
      params: { customSize: "1024x1024", resolution: "2K", aspectRatio: "3:4", quality: "medium" },
      references: [],
    });
    await render(); await click("图片 1");
    const parameters = document.querySelector(".history-parameters")!;
    expect(parameters.textContent).not.toContain("1024x1024");
    expect(parameters.textContent).not.toContain("尺寸");
    expect(parameters.textContent).toContain("分辨率 2K");
    expect(parameters.textContent).toContain("比例 3:4");
    expect(parameters.textContent).toContain("画质 标准");
    expect(parameters.textContent).not.toContain("medium");
  });
  it.each([
    ["gpt-image-2.5-reapi", "low", "画质 低"],
    ["gpt-image-2.5-reapi", "high", "画质 高"],
    ["gpt-image-2.5-reapi", "xhigh", "画质 超高"],
    ["gpt-image-2.5-reapi", "max", "画质 极致"],
    ["gpt-image-2.5-apimart", "medium", "画质 标准"],
    ["gpt-image-2.5-flare-openrouter", "medium", "画质 标准"],
    ["gpt-image-2-apimart", "low", "画质 快速"],
    ["gpt-image-2-apimart", "medium", "画质 标准画质"],
    ["qwen-image-3.0", "standard", "图片质量 标准"],
    ["qwen-image-3.0", "pro", "图片质量 Pro"],
    ["gpt-image-2.5-reapi", "legacy-quality", "画质 legacy-quality"],
  ])("uses parameter-panel labels for %s quality %s", async (model, quality, expected) => {
    const detail = { ...assets()[0], prompt: "测试", model, creator: null, params: { quality, aspectRatio: "auto", resolution: "2K" }, references: [] };
    client.setQueryData(["canvas-generation-history-v2", 7, "detail", 1], detail);
    await render(); await click("图片 1");
    const parameters = document.querySelector(".history-parameters")!;
    expect(parameters.textContent).toContain(expected);
    expect(parameters.textContent).toContain("比例 自适应");
    expect(parameters.textContent).toContain(model === "qwen-image-3.0" ? "清晰度 2K" : "分辨率 2K");
    expect(detail.params.quality).toBe(quality);
  });
  it("warms six first pages and switches to cached video and current-canvas history immediately", async () => {
    await render();
    for (const scope of [null, 8]) for (const kind of ["image", "video", "audio"]) {
      expect(client.getQueryData(["canvas-generation-history-v2", 7, "pages", scope, kind, "desc"])).toBeDefined();
      expect(sessionStorage.getItem(`canvas-history-page-v2:7:${scope}:${kind}:desc`)).not.toBeNull();
    }
    const listCalls = () => fetchMock.mock.calls.filter(([url]) => url.startsWith("/api/assets?") && !url.includes("count=1"));
    expect(listCalls()).toHaveLength(6);
    await act(async () => document.querySelectorAll<HTMLButtonElement>(".history-tabs button")[1].click());
    expect(document.querySelector(".history-switch-loading")).toBeNull();
    expect(document.querySelector(".history-tile")?.getAttribute("aria-label")).toBe("视频 1");
    await click("本画布");
    expect(document.querySelector(".history-switch-loading")).toBeNull();
    await render(false); await render(true);
    expect(listCalls()).toHaveLength(6);
  });
  it("zooms images with the wheel and controls, supports dragging, and resets on navigation", async () => {
    await render(); await click("图片 1"); await click("放大查看图片");
    const viewport = document.querySelector<HTMLDivElement>(".history-lightbox-image-viewport")!;
    const image = () => document.querySelector<HTMLImageElement>(".history-lightbox-image")!;
    const wheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    await act(async () => viewport.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    expect(button("重置图片缩放").textContent).toBe("122%");
    viewport.setPointerCapture = vi.fn(); viewport.hasPointerCapture = () => true; viewport.releasePointerCapture = vi.fn();
    const pointerStart = { button: 0, pointerId: 1, clientX: 10, clientY: 10 };
    const pointerEnd = { pointerId: 1, clientX: 40, clientY: 30 };
    await act(async () => Simulate.pointerDown(viewport, pointerStart));
    await act(async () => Simulate.pointerMove(viewport, pointerEnd));
    expect(image().style.transform).toContain("translate(30px, 20px)");
    await act(async () => Simulate.pointerUp(viewport, pointerEnd));
    await click("重置图片缩放");
    expect(image().style.transform).toBe("translate(0px, 0px) scale(1)");
    await click("放大图片"); expect(button("重置图片缩放").textContent).toBe("120%");
    await click("缩小图片"); expect(button("重置图片缩放").textContent).toBe("100%");
    await act(async () => { for (let i = 0; i < 30; i++) viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true })); });
    expect(button("放大图片").disabled).toBe(true);
    expect(button("重置图片缩放").textContent).toBe("500%");
    await click("下一个图片");
    expect(button("重置图片缩放").textContent).toBe("100%");
    expect(image().style.transform).toBe("translate(0px, 0px) scale(1)");
    const nextViewport = document.querySelector(".history-lightbox-image-viewport")!;
    await act(async () => { for (let i = 0; i < 30; i++) nextViewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true })); });
    expect(button("缩小图片").disabled).toBe(true);
    expect(button("重置图片缩放").textContent).toBe("25%");
    expect(close).not.toHaveBeenCalled();
  });
  it.each(["image", "audio"] as const)("opens %s in the shared lightbox and preserves history when closing", async kind => {
    const original = fetchMock.getMockImplementation()!;
    const label = kind === "image" ? "图片" : "音频";
    const extension = kind === "image" ? "png" : "mp3";
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      const params = new URL(url, "http://localhost").searchParams;
      if (params.get("type") === kind && params.get("count") !== "1") return response({ items: assets(kind, 2).map(item => ({ ...item, localPath: `/uploads/${item.id}.${extension}` })), nextCursor: null, hasMore: false });
      return original(url, options);
    });
    await render();
    if (kind === "audio") {
      await act(async () => document.querySelectorAll<HTMLButtonElement>(".history-tabs button")[2].click());
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    }
    await click(`${label} 1`);
    expect(document.querySelector("audio")).toBeNull();
    await click(kind === "image" ? "放大查看图片" : "播放音频");
    const media = () => document.querySelector(`[aria-label="历史${label}预览"] ${kind === "image" ? "img" : "audio"}`);
    expect(media()?.getAttribute("src")).toBe(`/uploads/1.${extension}`);
    if (kind === "audio") expect(media()?.hasAttribute("controls")).toBe(true);
    await click(`下一个${label}`);
    expect(media()?.getAttribute("src")).toBe(`/uploads/2.${extension}`);
    await click(`上一个${label}`);
    expect(media()?.getAttribute("src")).toBe(`/uploads/1.${extension}`);
    await click(`关闭${label}预览`);
    expect(document.querySelector(".history-media-lightbox")).toBeNull();
    expect(document.querySelector("audio")).toBeNull();
    expect(document.querySelector("[data-canvas-generation-history]")).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
  });
  it("restricts replacement history to the node kind and requires explicit single selection confirmation", async () => {
    await render(true, 7, "video");
    expect(document.querySelector('[aria-label="媒体分类"]')?.textContent).not.toContain("图片");
    expect(button("确认替换").disabled).toBe(true);
    await click("视频 1");
    expect(add).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="素材详情"]')).toBeNull();
    await click("确认替换");
    expect(add).toHaveBeenCalledWith([expect.objectContaining({ kind: "video", url: "/uploads/1.mp4" })]);
  });
  it("expands long prompts from the ellipsis, copies the full prompt and collapses on another asset", async () => {
    const longPrompt = "第一行提示词\n第二行提示词\n第三行提示词\n第四行完整内容";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function(this: HTMLElement) { return this.classList.contains("history-prompt") ? 82 : 0; });
    for (const id of [1, 2]) client.setQueryData(["canvas-generation-history-v2", 7, "detail", id], { ...assets()[id - 1], prompt: longPrompt, model: "示例模型", creator: null, params: {}, references: [] });
    await render(); await click("图片 1");
    expect(document.querySelector(".history-section-label h4")?.textContent).toBe("提示词");
    expect(document.querySelector(".history-prompt")?.classList.contains("is-collapsed")).toBe(true);
    expect(button("展开完整提示词").textContent).toBe("...");
    expect(button("展开完整提示词").getAttribute("aria-expanded")).toBe("false");
    await click("展开完整提示词");
    expect(document.querySelector(".history-prompt")?.classList.contains("is-collapsed")).toBe(false);
    expect(document.querySelector(".history-prompt")?.textContent).toBe(longPrompt);
    await click("复制提示词");
    expect(writeText).toHaveBeenCalledWith(longPrompt);
    await click("收起提示词");
    expect(document.querySelector(".history-prompt")?.classList.contains("is-collapsed")).toBe(true);
    await click("展开完整提示词"); await click("图片 2");
    expect(button("展开完整提示词").getAttribute("aria-expanded")).toBe("false");
  });
  it("shows short prompts without an ellipsis", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(20);
    await render(); await click("图片 1");
    expect(document.querySelector(".history-prompt")?.textContent).toBe("测试提示词");
    expect(document.querySelector(".history-prompt-expand")).toBeNull();
  });
  it("prefetches detail on pointer intent and never replaces the sidebar with a loading spinner", async () => {
    await render();
    await act(async () => Simulate.mouseEnter(button("图片 1")));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    const detailRequests = () => fetchMock.mock.calls.filter(([url]) => /\/api\/assets\/\d+/.test(url)).length;
    expect(detailRequests()).toBe(1);
    await click("图片 1");
    expect(detailRequests()).toBe(1);
    expect(document.querySelector('[aria-label="素材详情"]')?.textContent).toContain("测试提示词");
    expect(document.querySelector('[aria-label="素材详情"]')?.textContent).toContain("用户模型名称");
    expect(document.querySelector('[aria-label="素材详情"]')?.textContent).not.toContain("示例模型");
    let finish!: (value: any) => void;
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, options) => url.includes("/api/assets/2?") ? new Promise(resolve => { finish = resolve; }) : original(url, options));
    await click("图片 2");
    const sidebar = document.querySelector('[aria-label="素材详情"]')!;
    expect(sidebar.querySelector(".animate-spin")).toBeNull();
    expect(sidebar.textContent).not.toContain("正在加载");
    expect(sidebar.textContent).not.toContain("测试提示词");
    expect(sidebar.textContent).toContain("创建时间");
    await act(async () => finish(await response({ item: { ...assets()[1], prompt: "第二张素材", model: null, creator: null, params: {}, references: [] } })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(sidebar.textContent).toContain("第二张素材");
  });
  it("keeps thumbnails mounted through detail opening, width changes, refresh and repeated selections", async () => {
    await render();
    const thumbnails = [...document.querySelectorAll<HTMLImageElement>(".history-tile img")];
    const scroller = document.querySelector(".history-grid-scroll");
    await click("图片 1"); await resizeGrid(700);
    const visible = [...document.querySelectorAll<HTMLImageElement>(".history-tile img")];
    expect(thumbnails.filter(img => visible.some(node => node.src === img.src)).every(img => img.isConnected)).toBe(true);
    const first = button("图片 1").querySelector("img");
    await click("图片 2"); await click("关闭素材详情"); await resizeGrid(1000);
    await click("刷新生成历史"); await click("批量操作"); await click("退出批量");
    expect(first?.isConnected).toBe(true);
    expect(document.querySelector(".history-grid-scroll")).toBe(scroller);
    expect(document.body.textContent).not.toMatch(/已(展示|加载)全部/);
  });
  it("reorders existing thumbnails without remounting and returns to cached media without requesting again", async () => {
    client.setQueryData(["canvas-generation-history-v2", 7, "pages", null, "image", "desc"], { pages: [{ items: assets("image", 12), nextCursor: null, hasMore: false }], pageParams: [null] });
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, options) => url.includes("order=asc") && !url.includes("count=1") ? response({ items: assets("image", 12).reverse(), nextCursor: null, hasMore: false }) : original(url, options));
    await render();
    const thumbnails = [...document.querySelectorAll<HTMLImageElement>(".history-tile img")];
    await click("时间倒序");
    expect([...document.querySelectorAll(".history-tile")].map(node => node.getAttribute("aria-label"))).toEqual(assets("image", 12).reverse().map(item => `图片 ${item.id}`));
    expect(thumbnails.every(img => img.isConnected)).toBe(true);
    await click("时间正序");
    await act(async () => document.querySelectorAll<HTMLButtonElement>(".history-tabs button")[1].click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    const calls = fetchMock.mock.calls.length;
    await act(async () => document.querySelectorAll<HTMLButtonElement>(".history-tabs button")[0].click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(document.querySelector(".history-skeletons")).toBeNull();
    expect(document.body.textContent).not.toMatch(/已(展示|加载)全部/);
  });
  it("bounds the DOM for 50,000 assets and restores a deep scroll after resize, filter switching and reopening", async () => {
    client.setQueryData(["canvas-generation-history-v2", 7, "pages", null, "image", "desc"], { pages: [{ items: assets("image", 50000), nextCursor: null, hasMore: false }], pageParams: [null] });
    await render();
    expect(document.querySelectorAll(".history-tile").length).toBeLessThan(100);
    const scroller = document.querySelector<HTMLDivElement>(".history-grid-scroll")!;
    await act(async () => { scroller.scrollTop = 100000; scroller.dispatchEvent(new Event("scroll")); });
    const candidates = [...document.querySelectorAll<HTMLDivElement>(".history-grid-cell")];
    const anchor = candidates.find(cell => Number.parseFloat(cell.style.top) >= 100000)!;
    const label = anchor.querySelector("button")!.getAttribute("aria-label")!;
    expect(document.querySelectorAll(".history-tile").length).toBeLessThan(100);
    await resizeGrid(700);
    expect(anchor.isConnected).toBe(true);
    const resizedTop = scroller.scrollTop;
    expect(resizedTop).toBeGreaterThan(100000);
    await click("本画布");
    expect(scroller.scrollTop).toBe(0);
    await click("全部画布");
    expect(scroller.scrollTop).toBe(resizedTop);
    await render(false); await render(true);
    expect(document.querySelector<HTMLDivElement>(".history-grid-scroll")!.scrollTop).toBe(resizedTop);
    expect(button(label).isConnected).toBe(true);
    expect(document.querySelectorAll(".history-tile").length).toBeLessThan(100);
  });
  it("retains every visible thumbnail element when resizing the grid and toggling batch selection", async () => {
    await render();
    const thumbnails = [...document.querySelectorAll<HTMLImageElement>(".history-tile img")];
    const slider = document.querySelector<HTMLInputElement>('input[type="range"]')!;
    await act(async () => { Simulate.change(slider, { target: { value: "160" } } as any); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    const visible = [...document.querySelectorAll<HTMLImageElement>(".history-tile img")];
    const retained = thumbnails.filter(img => visible.some(node => node.src === img.src));
    expect(retained.length).toBeGreaterThan(3);
    expect(retained.every(img => img.isConnected)).toBe(true);
    await click("批量操作"); await click("图片 1");
    expect(retained.every(img => img.isConnected)).toBe(true);
  });
  it("keeps the current gallery visible until an uncached filter is ready", async () => {
    await render();
    client.removeQueries({ queryKey: ["canvas-generation-history-v2", 7, "pages", 8, "image", "desc"], exact: true });
    sessionStorage.removeItem("canvas-history-page-v2:7:8:image:desc");
    const first = document.querySelector(".history-tile img");
    let finish!: (value: any) => void;
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url, options) => url.includes("canvasId=8") && !url.includes("count=1") ? new Promise(resolve => { finish = resolve; }) : original(url, options));
    await click("本画布");
    expect(first?.isConnected).toBe(true);
    expect(document.querySelector(".history-skeletons")).toBeNull();
    expect(document.querySelector('.history-grid')?.getAttribute("aria-busy")).toBe("true");
    // Holding a previous view for a slow response must not persist it under the new filter.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
    expect(sessionStorage.getItem("canvas-history-page-v2:7:8:image:desc")).toBeNull();
    await act(async () => { finish(await response({ items: assets(), nextCursor: null, hasMore: false })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(first?.isConnected).toBe(true);
    expect(document.querySelector('.history-grid')?.getAttribute("aria-busy")).toBe("false");
  });
  it("renders a virtual gallery, loads detail on selection, and adds reference media", async () => {
    await render();
    expect(document.querySelector('[aria-label="媒体分类"]')?.textContent).toContain("图片60");
    expect(document.querySelectorAll(".history-tile").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".history-tile").length).toBeLessThan(60);
    expect(fetchMock.mock.calls.some(([url]) => /\/api\/assets\/\d+/.test(url))).toBe(false);
    await click("图片 1");
    expect(document.querySelector('[aria-label="素材详情"]')?.textContent).toContain("测试提示词");
    expect(document.body.textContent).not.toContain("评级");
    await click("查看参考图片 1");
    expect(document.querySelector(".history-lightbox-image")?.getAttribute("src")).toBe("/uploads/reference.png");
    await click("关闭图片预览");
    await click("添加到画布");
    expect(add).toHaveBeenCalledWith([{ url: "/uploads/reference.png", kind: "image" }]);
    await click("返回生成素材");
    await click("添加到画布");
    expect(add.mock.calls[1][0][0]).toMatchObject({ url: "/uploads/1.png", prompt: "测试提示词", model: "示例模型" });
  });
  it("opens the clicked reference directly with zoom, reference-only navigation and current-file download", async () => {
    const references = [1, 2, 3].map(index => ({ url: `/uploads/reference-${index}.png`, kind: "image", name: `参考 ${index}` }));
    client.setQueryData(["canvas-generation-history-v2", 7, "detail", 1], {
      ...assets()[0], prompt: "测试", model: null, creator: null, params: {}, references,
    });
    const downloads: Array<{ url: string; name: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push({ url: this.getAttribute("href") || "", name: this.download });
    });
    await render(); await click("图片 1"); await click("查看参考图片 2");
    const image = () => document.querySelector<HTMLImageElement>(".history-lightbox-image")!;
    expect(image().getAttribute("src")).toBe("/uploads/reference-2.png");
    expect(document.querySelector(".history-lightbox-footer")?.textContent).toContain("2 / 3");
    await click("放大图片");
    expect(button("重置图片缩放").textContent).toBe("120%");
    await click("下一个图片");
    expect(image().getAttribute("src")).toBe("/uploads/reference-3.png");
    expect(button("重置图片缩放").textContent).toBe("100%");
    await act(async () => document.querySelector<HTMLButtonElement>(".history-lightbox-footer button")!.click());
    expect(downloads).toEqual([{ url: "/uploads/reference-3.png", name: "参考 3.png" }]);
    await click("下一个图片");
    expect(image().getAttribute("src")).toBe("/uploads/reference-1.png");
    await click("上一个图片");
    expect(image().getAttribute("src")).toBe("/uploads/reference-3.png");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true })));
    expect(image().getAttribute("src")).toBe("/uploads/reference-2.png");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(document.querySelector(".history-media-lightbox")).toBeNull();
    expect(button("图片 1").getAttribute("aria-pressed")).toBe("true");
    expect(close).not.toHaveBeenCalled();
    await click("放大查看图片");
    expect(document.querySelector(".history-lightbox-footer")?.textContent).toContain("2 / 3");
  });
  it("opens audio references directly and switches within mixed reference media", async () => {
    await render(); await click("图片 1"); await click("查看参考音频 2");
    expect(document.querySelector('.history-media-lightbox audio')?.getAttribute("src")).toBe("/uploads/reference.mp3");
    expect(document.querySelector(".history-lightbox-footer")?.textContent).toContain("2 / 2");
    await click("上一个音频");
    expect(document.querySelector(".history-lightbox-image")?.getAttribute("src")).toBe("/uploads/reference.png");
    expect(document.querySelector('.history-media-lightbox audio')).toBeNull();
    await click("关闭图片预览");
    expect(close).not.toHaveBeenCalled();
  });
  it("opens a single reference without navigation arrows", async () => {
    client.setQueryData(["canvas-generation-history-v2", 7, "detail", 1], {
      ...assets()[0], prompt: "测试", model: null, creator: null, params: {},
      references: [{ url: "/uploads/only-reference.png", kind: "image" }],
    });
    await render(); await click("图片 1"); await click("查看参考图片 1");
    expect(document.querySelector(".history-lightbox-image")?.getAttribute("src")).toBe("/uploads/only-reference.png");
    expect(document.querySelector(".history-lightbox-footer")?.textContent).toContain("1 / 1");
    expect(document.querySelector(".history-lightbox-next")).toBeNull();
    expect(document.querySelector(".history-lightbox-previous")).toBeNull();
  });
  it("preserves detail and feed cache on close/reopen without refetching all pages", async () => {
    await render(); await click("图片 1");
    const requests = fetchMock.mock.calls.length;
    await render(false); expect(document.querySelector('[data-canvas-generation-history]')).toBeNull();
    await render(true);
    expect(document.querySelector('[aria-label="素材详情"]')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(requests);
  });
  it("filters current canvas and videos on the API and never mounts a video player for grid tiles", async () => {
    await render(); await click("本画布");
    const videoTab = document.querySelectorAll<HTMLButtonElement>(".history-tabs button")[1];
    await act(async () => videoTab.click()); await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(fetchMock.mock.calls.some(([url]) => url.includes("canvasId=8") && url.includes("type=video") && !url.includes("count=1"))).toBe(true);
    expect(document.querySelector("video")).toBeNull();
    await click("视频 1");
    expect(document.querySelector("video")).toBeNull();
    await click("播放视频");
    expect(document.querySelector('[aria-label="历史视频预览"] video')?.getAttribute("src")).toBe("/uploads/1.mp4");
    await click("关闭视频预览");
    expect(document.querySelector("video")).toBeNull();
    expect(document.querySelector(".history-detail")).not.toBeNull();
  });
  it("adds multiple selected materials together and clears selections when changing scope", async () => {
    await render(); await click("批量操作"); await click("图片 1"); await click("图片 2"); await click("添加到画布");
    expect(add.mock.calls[0][0]).toHaveLength(2);
    await click("本画布");
    expect(document.querySelector(".history-batch")?.textContent).toContain("已选 0");
  });
  it("opens the selected video in a lightbox, navigates, and closes only the lightbox with Escape", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      const params = new URL(url, "http://localhost").searchParams;
      if (params.get("type") === "video" && params.get("count") !== "1") return response({ items: assets("video", 2).map(item => ({ ...item, posterUrl: `/uploads/poster-${item.id}.jpg` })), nextCursor: null, hasMore: false });
      return original(url, options);
    });
    await render();
    await act(async () => document.querySelectorAll<HTMLButtonElement>(".history-tabs button")[1].click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    await click("视频 2");
    expect(document.querySelector("video")).toBeNull();
    expect(document.querySelector(".history-video-cover img")).not.toBeNull();
    await click("播放视频");
    expect(document.querySelector("video")?.getAttribute("src")).toBe("/uploads/2.mp4");
    await click("上一个视频");
    expect(document.querySelector("video")?.getAttribute("src")).toBe("/uploads/1.mp4");
    await click("下一个视频");
    expect(document.querySelector("video")?.getAttribute("src")).toBe("/uploads/2.mp4");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(document.querySelector('[aria-label="历史视频预览"]')).toBeNull();
    expect(document.querySelector("[data-canvas-generation-history]")).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
  });
  it("waits for canvas insertion and shows failures without claiming success", async () => {
    let reject!: (error: Error) => void;
    add.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    await render(); await click("图片 1"); await click("添加到画布");
    expect(button("添加到画布").disabled).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toContain("正在添加");
    await act(async () => reject(new Error("无法读取素材尺寸，请重试")));
    expect(button("添加到画布").disabled).toBe(false);
    expect(document.querySelector('[role="status"]')?.textContent).toContain("无法读取素材尺寸");
  });
  it("reuses the existing asset delete URL and reports a failed deletion for retry", async () => {
    await render(); await click("图片 1"); await click("删除");
    fetchMock.mockImplementation((url: string, options?: RequestInit) => options?.method === "DELETE" ? response({ error: "test failure" }, 500) : response({}));
    const confirms = [...document.querySelectorAll<HTMLButtonElement>("button")].filter(node => node.textContent === "删除");
    await act(async () => confirms.at(-1)!.click());
    expect(fetchMock.mock.calls.some(([url, options]) => url === "/api/assets/1?view=canvas-history" && options.method === "DELETE")).toBe(true);
    expect(document.body.textContent).toContain("删除失败");
    expect(document.querySelector('[aria-label="素材详情"]')).not.toBeNull();
  });
});

it('selects a date across virtualized rows and reflects partial selection', async () => {
  await render(); await click('批量操作');
  expect(document.body.textContent).not.toContain('选择已加载素材');
  const day = document.querySelector('input[aria-label="选择 2026-09-10 全部素材"]') as HTMLInputElement;
  await act(async () => Simulate.change(day, { target: { checked: true } } as any));
  expect(document.querySelector('.history-batch')?.textContent).toContain('已选 60');
  await click('图片 1');
  expect(day.indeterminate).toBe(true);
  expect(document.querySelector('.history-batch')?.textContent).toContain('已选 59');
  await act(async () => Simulate.change(day, { target: { checked: false } } as any));
  expect(document.querySelector('.history-batch')?.textContent).toContain('已选 0');
});

it('shows the shared back-to-top button after scrolling the history list', async () => {
  await render();
  const topButton = document.querySelector('button[aria-label="回到顶部"]') as HTMLButtonElement;
  const scroller = document.querySelector('.history-grid-scroll') as HTMLElement;
  expect(topButton.getAttribute('aria-hidden')).toBe('true');
  await act(async () => { scroller.scrollTop = 900; scroller.dispatchEvent(new Event('scroll')); });
  expect(topButton.getAttribute('aria-hidden')).toBe('false');
  await click('回到顶部');
  expect(scroller.scrollTop).toBe(0);
  await act(async () => { scroller.scrollTop = 0; scroller.dispatchEvent(new Event('scroll')); });
  expect(topButton.getAttribute('aria-hidden')).toBe('true');
});
