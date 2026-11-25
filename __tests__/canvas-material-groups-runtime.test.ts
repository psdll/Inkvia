import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { expect, it, vi } from "vitest";
import CanvasLibraryPanel from "@/components/canvas/CanvasLibraryPanel";
import type { CanvasNode } from "@/lib/canvas/document";
import { readCanvasVideoPoster } from "@/lib/canvas/video-poster-cache";

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({ data, itemContent, computeItemKey }: any) => React.createElement("div", null, data.map((row: any, index: number) =>
    React.createElement(React.Fragment, { key: computeItemKey(index, row) }, itemContent(index, row)))),
}));
vi.mock("@/components/canvas/CanvasPersonalLibrary", () => ({ default: () => null }));
vi.mock("@/components/ui/media-image", () => ({ MediaImage: ({ src, alt, onError }: any) => React.createElement("img", { src, alt, onError }) }));
vi.mock("@/components/ui/video-poster-preview", () => ({ VideoPosterPreview: ({ videoSrc }: any) => React.createElement("div", { "data-video-poster-preview": true, "data-video-src": videoSrc }) }));
vi.mock("@/lib/canvas/video-poster-cache", () => ({ readCanvasVideoPoster: vi.fn(async () => null) }));

it("filters and locates audio tasks and both text nodes, retaining the text filter on reopen", async () => {
  window.localStorage.clear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const locate = vi.fn();
  const nodes: CanvasNode[] = [
    { id: "audio", type: "audioTask", position: { x: 0, y: 0 }, data: { kind: "audioTask", model: "speech", prompt: "配音", voiceId: "voice", speed: 1, pitch: 0, volume: 1, modifyPitch: 0, modifyIntensity: 0, modifyTimbre: 0, soundEffect: "", status: "running" } },
    { id: "text", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "文案", title: "产品文案" } },
    { id: "llm", type: "llm", position: { x: 0, y: 0 }, data: { kind: "llm", prompt: "", status: "idle" } },
  ];
  const render = () => act(async () => root.render(React.createElement(CanvasLibraryPanel, { ownerId: 0, canvasId: 910, nodes, onLocateNode: locate, onClose: vi.fn() })));
  const button = (name: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(el => (el.getAttribute("aria-label") || el.textContent?.trim()) === name)!;
  const items = () => Array.from(host.querySelectorAll<HTMLButtonElement>("[data-canvas-material-node-id]"));
  try {
    await render();
    expect(items()).toHaveLength(3);
    expect(host.textContent).toContain("共 3 个节点");
    await act(async () => button("筛选：全部").click());
    await act(async () => button("音频").click());
    expect(items().map(item => item.dataset.canvasMaterialNodeId)).toEqual(["audio"]);
    expect(items()[0].querySelector('[data-canvas-material-icon="audio"]')).not.toBeNull();
    expect(host.textContent).toContain("匹配 1 项素材");
    await act(async () => items()[0].click());
    expect(locate).toHaveBeenLastCalledWith("audio");
    nodes[0] = { ...nodes[0], data: { ...nodes[0].data, status: "success", outputUrl: "/voice.mp3", outputName: "音频节点2" } as CanvasNode["data"] };
    // Pass a fresh array, just as canvas document edits do.
    await act(async () => root.render(React.createElement(CanvasLibraryPanel, { ownerId: 0, canvasId: 910, nodes: [...nodes], onLocateNode: locate, onClose: vi.fn() })));
    expect(items()[0].textContent).toBe("音频节点2");
    expect(items()[0].dataset.canvasMaterialTemporary).toBeUndefined();
    await act(async () => button("筛选：音频").click());
    await act(async () => button("文本").click());
    expect(items().map(item => item.dataset.canvasMaterialNodeId)).toEqual(["text", "llm"]);
    expect(host.textContent).toContain("匹配 2 项素材");
    for (const item of items()) {
      expect(item.querySelector('[data-canvas-material-icon="text"]')).not.toBeNull();
      await act(async () => item.click());
      expect(locate).toHaveBeenLastCalledWith(item.dataset.canvasMaterialNodeId);
    }
    expect(host.querySelector("img, video, audio, [data-video-poster-preview]")).toBeNull();
    await act(async () => button("展示设置").click());
    await act(async () => button("宫格展示").click());
    expect(items()).toHaveLength(2);
    await act(async () => root.render(null));
    await render();
    expect(button("筛选：文本")).toBeDefined();
    expect(items()).toHaveLength(2);
    expect(host.querySelector('[data-library-layout="grid"]')).not.toBeNull();
  } finally { act(() => root.unmount()); host.remove(); }
});

it("toggles groups, locates a child, and synchronizes live rename and ungroup", async () => {
  window.localStorage.clear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const locate = vi.fn();
  const group: CanvasNode = { id: "g", type: "group", position: { x: 0, y: 0 }, data: { kind: "group", title: "产品", collapsed: false } };
  const child: CanvasNode = { id: "i", type: "image", parentId: "g", position: { x: 0, y: 0 }, data: { kind: "image", name: "椅子", url: "/chair.png" } };
  const render = (nodes: CanvasNode[]) => act(async () => root.render(React.createElement(CanvasLibraryPanel, {
    ownerId: 0, canvasId: 909, nodes, onLocateNode: locate, onClose: vi.fn(),
  })));
  const groupButton = () => host.querySelector<HTMLButtonElement>("[data-canvas-material-group-id]")!;
  const itemButton = () => host.querySelector<HTMLButtonElement>("[data-canvas-material-node-id]");
  const button = (name: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(el => (el.getAttribute("aria-label") || el.textContent?.trim()) === name)!;
  try {
    await render([child, group]);
    expect(host.textContent).toContain("共 2 个节点");
    expect(groupButton().textContent).toContain("产品");
    expect(itemButton()?.style.paddingLeft).toBe("44px");
    expect(itemButton()?.className).not.toMatch(/\bborder\b|bg-\[var\(--input-bg\)\]/);
    await act(async () => groupButton().click());
    expect(groupButton().getAttribute("aria-expanded")).toBe("false");
    expect(itemButton()).toBeNull();
    expect(host.textContent).toContain("共 2 个节点");
    await act(async () => groupButton().click());
    await act(async () => itemButton()!.click());
    expect(locate).toHaveBeenCalledWith("i");
    expect(host.querySelector("input")).toBeNull();
    await act(async () => button("搜索当前画布素材").click());
    const input = host.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "不匹配");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(itemButton()).toBeNull();
    expect(host.textContent).toContain("共 2 个节点");
    expect(host.textContent).toContain("匹配 0 项素材");
    await act(async () => button("关闭搜索").click());
    expect(host.querySelector("input")).toBeNull();
    expect(itemButton()).not.toBeNull();
    expect(host.textContent).not.toContain("匹配");
    await act(async () => button("筛选：全部").click());
    await act(async () => button("视频").click());
    expect(itemButton()).toBeNull();
    await act(async () => button("筛选：视频").click());
    await act(async () => button("全部").click());
    await act(async () => button("展示设置").click());
    await act(async () => button("收起全部分组").click());
    expect(itemButton()).toBeNull();
    await act(async () => button("展示设置").click());
    await act(async () => button("展开全部分组").click());
    expect(itemButton()).not.toBeNull();
    await act(async () => button("展示设置").click());
    await act(async () => button("宫格展示").click());
    expect(host.querySelector('[data-library-layout="grid"]')).not.toBeNull();
    await act(async () => itemButton()!.click());
    expect(locate).toHaveBeenCalledTimes(2);
    await act(async () => button("展示设置").click());
    await act(async () => button("列表展示").click());
    await render([child, { ...group, data: { kind: "group", title: "新组名", collapsed: false } }]);
    expect(groupButton().textContent).toContain("新组名");
    await render([{ ...child, parentId: undefined }]);
    expect(host.textContent).toContain("共 1 个节点");
    expect(groupButton()).toBeNull();
    expect(itemButton()?.style.paddingLeft).toBe("24px");
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

it.each([false, true])("falls back only the failed video thumbnail and refreshes it when the source changes (cached=%s)", async cached => {
  window.localStorage.clear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const locate = vi.fn();
  const cachedPoster = "data:image/jpeg;base64,cG9zdGVy";
  vi.mocked(readCanvasVideoPoster).mockResolvedValueOnce(cached ? { url: cachedPoster, tier: 480 } : null);
  const render = (url: string) => act(async () => root.render(React.createElement(CanvasLibraryPanel, {
    ownerId: 0, canvasId: 909, nodes: [{ id: "v", type: "video", position: { x: 0, y: 0 }, data: { kind: "video", url } }],
    onLocateNode: locate, onClose: vi.fn(),
  })));
  try {
    await render("/uploads/first.mp4");
    expect(host.querySelector("img")?.getAttribute("src")).toContain("poster=1");
    expect(host.querySelector("[data-video-poster-preview]")).toBeNull();
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(readCanvasVideoPoster).toHaveBeenCalledWith(0, "/uploads/first.mp4");
    if (cached) {
      expect(host.querySelector("img")?.getAttribute("src")).toBe(cachedPoster);
      expect(host.querySelector("[data-video-poster-preview]")).toBeNull();
      // A stale/invalid cached image can still reach the bounded decoder.
      await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    }
    expect(host.querySelector("[data-video-src]")?.getAttribute("data-video-src")).toBe("/uploads/first.mp4");
    await act(async () => host.querySelector<HTMLButtonElement>("[data-canvas-material-node-id]")!.click());
    expect(locate).toHaveBeenCalledWith("v");
    await render("/uploads/second.mp4");
    expect(host.querySelector("img")?.getAttribute("src")).toContain("second.mp4");
    expect(host.querySelector("[data-video-poster-preview]")).toBeNull();
  } finally { act(() => root.unmount()); host.remove(); }
});
