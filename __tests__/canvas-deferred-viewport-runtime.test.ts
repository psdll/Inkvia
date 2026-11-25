import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { CanvasLru, CanvasMountQueue } from "@/lib/canvas/render-runtime";
vi.mock("@/components/canvas/CanvasNodeCard", () => ({
  getCanvasLowDetailImageUrl: (data: any) => data.kind === "image" ? data.url : undefined,
  CanvasNodeCard: ({ id, data, deferContent }: any) => React.createElement("div", { "data-real-node": id, "data-deferred": deferContent, style: { background: data.backgroundColor } }, data.text || data.output || data.name),
}));
vi.mock("@/components/canvas/CanvasNodeSubscriptions", () => ({ CanvasNodeSubscription: ({ children }: any) => children }));
vi.mock("@/components/canvas/CanvasMediaImage", () => ({ CanvasMediaImage: ({ src, thumbnailSize }: any) => React.createElement("div", { "data-queued-preview": src, "data-preview-tier": thumbnailSize }) }));
vi.mock("@xyflow/react", async original => ({ ...await original<any>(), Handle: () => React.createElement("span", { "data-handle": true }) }));
import { CanvasDeferredNode } from "@/components/canvas/CanvasDeferredNode";
import { CanvasInteractingContext, CanvasRuntimeContext } from "@/components/canvas/canvas-runtime-context";
let root: Root, host: HTMLDivElement, mounts: CanvasMountQueue;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); mounts = new CanvasMountQueue(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function render(ids: string[], busy = true, selected = false, caches = {}, data?: any, runtime = { mounts, ...caches }) {
  act(() => root.render(React.createElement(CanvasRuntimeContext.Provider, { value: runtime as any },
    React.createElement(CanvasInteractingContext.Provider, { value: busy }, ids.map(id => React.createElement(CanvasDeferredNode, {
      key: id, id, type: data?.kind ?? "image", data: data ?? { kind: "image", url: `/uploads/${id}.jpg` },
      width: 350, height: 240, selected, dragging: false,
    } as any))))));
}
it.each([
  { kind: "imageTask", task: { batches: [] } },
  { kind: "videoTask", status: "idle", prompt: "" },
  { kind: "audioTask", status: "idle", prompt: "" },
  { kind: "llm", status: "idle", prompt: "" },
  { kind: "prompt", text: "已输入的文本", title: "笔记" },
  { kind: "llm", output: "已生成的文本", prompt: "要求", status: "success" },
  { kind: "audio", url: "/audio.mp3", name: "旁白", waveformPeaks: [.2, .8], durationSeconds: 12 },
  { kind: "audioTask", prompt: "旁白内容", status: "success", outputUrl: "/audio.mp3", waveformPeaks: [.3, .9], durationSeconds: 8 },
  { kind: "loop", items: ["第一项"], status: "idle", mode: "serial", concurrency: 1 },
  { kind: "compare", beforeUrl: "/before.jpg", afterUrl: "/after.jpg", slider: .5 },
])("restores the original $kind renderer without a temporary replacement", data => {
  render(["node"], true, false, {}, data);
  const preview = host.querySelector("[data-real-node]");
  expect(preview).not.toBeNull();
  const content = preview?.innerHTML;
  expect(host.querySelector("[data-canvas-deferred-node]")).toBeNull();
  render([], true, false, {}, data);
  expect(host.querySelector("[data-real-node]")).toBeNull();
  render(["node"], true, false, {}, data);
  expect(host.querySelector("[data-real-node]")?.innerHTML).toBe(content);
  expect(host.querySelector("[data-real-node]")?.hasAttribute("data-deferred")).toBe(false);
  expect(mounts.size).toBe(0);
  act(() => mounts.flush(false));
  expect(host.querySelector("[data-real-node]")).not.toBeNull();
});
it("uses current text on return instead of a stale cached snapshot", () => {
  render(["text"], true, false, {}, { kind: "prompt", text: "旧内容" });
  render(["text"], true, false, {}, { kind: "prompt", text: "新内容" });
  expect(host.textContent).toContain("新内容");
  expect(host.textContent).not.toContain("旧内容");
});
it("keeps a decoded deferred preview visible while the admitted node loads its replacement", () => {
  const previews = new CanvasLru<any>(10), decoded = new CanvasLru<any>(10);
  previews.set("/uploads/near.jpg", { url: "/thumb.jpg", original: false });
  decoded.set("/thumb.jpg", { complete: true, naturalWidth: 100 });
  render(["near"], true, false, { previews, decoded });
  const image = host.querySelector("img")!;
  Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 100 } });
  act(() => image.dispatchEvent(new Event("load")));
  act(() => mounts.flush(false));
  expect(host.querySelector("[data-real-node]")).not.toBeNull();
  expect(host.querySelector(".canvas-thumbnail-handoff")?.getAttribute("src")).toContain("/thumb.jpg");
});
it("keeps newly visible images as placeholders during a pan and upgrades one per frame", () => {
  const ids = Array.from({ length: 100 }, (_, i) => String(i));
  render(ids);
  expect(host.querySelectorAll("[data-canvas-deferred-node]")).toHaveLength(100);
  expect(host.querySelector("[data-real-node]")).toBeNull();
  expect(host.querySelector("[data-handle]")).not.toBeNull();
  act(() => mounts.flush(true));
  expect(host.querySelectorAll("[data-real-node]")).toHaveLength(1);
  act(() => mounts.flush(false));
  expect(host.querySelectorAll("[data-real-node]")).toHaveLength(5);
  render([]);
  expect(mounts.size).toBe(0);
  expect(mounts.has("0")).toBe(false);
  render(["0"]);
  expect(host.querySelector("[data-real-node]")).toBeNull();
  expect(host.querySelector("[data-canvas-deferred-node]")).not.toBeNull();
  act(() => mounts.flush(false));
  expect(host.querySelector("[data-real-node]")).not.toBeNull();
});
it.each(["video", "videoTask"])("restores %s captured posters while the full node remains queued", kind => {
  const videoPosters = new CanvasLru<any>(1);
  const url = "data:image/jpeg;base64,cachedFrame";
  videoPosters.set("/video.mp4", { url, tier: 100 });
  const data = kind === "video" ? { kind, url: "/video.mp4" } : { kind, status: "success", outputUrl: "/video.mp4" };
  render(["video"], true, false, { videoPosters }, data);
  expect(host.querySelector("img")?.getAttribute("src")).toBe(url);
  expect(host.querySelector("video")).toBeNull();
  expect(host.querySelector("[data-real-node]")).toBeNull();
  render([], true, false, { videoPosters }, data);
  render(["video"], true, false, { videoPosters }, data);
  expect(host.querySelector("img")?.getAttribute("src")).toBe(url);
  expect(mounts.size).toBe(1);
  // Replacing the media on the same node must not show its previous frame.
  render(["video"], true, false, { videoPosters }, { ...data, url: "/other.mp4", outputUrl: "/other.mp4" });
  expect(host.querySelector("img")).toBeNull();
  videoPosters.set("/other.mp4", { url, tier: 100 });
  render(["video"], true, false, { videoPosters }, data);
  expect(host.querySelector("img")).toBeNull();
});
it("does not let a decoded preview bypass the paused node mount queue", () => {
  const previews = new CanvasLru<any>(10), decoded = new CanvasLru<any>(10);
  previews.set("/uploads/near.jpg", { url: "/thumb.jpg", original: false });
  decoded.set("/thumb.jpg", { complete: true, naturalWidth: 100 });
  render(["near"], true, false, { previews, decoded });
  expect(host.querySelector("[data-real-node]")).toBeNull();
  expect(mounts.size).toBe(1);
  expect(host.querySelector("[data-canvas-deferred-preview]")?.getAttribute("src")).toBe("/thumb.jpg");
  act(() => mounts.flush(false));
  expect(host.querySelector("[data-real-node]")).not.toBeNull();
});
it("does not mistake an evicted image's URL record for decoded pixels", () => {
  const previews = new CanvasLru<any>(10), decoded = new CanvasLru<any>(10);
  previews.set("/uploads/near.jpg", { url: "/thumb.jpg", original: false });
  render(["near"], true, false, { previews, decoded });
  expect(host.querySelector("[data-real-node]")).toBeNull();
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector("[data-queued-preview]")?.getAttribute("data-queued-preview")).toBe("/uploads/near.jpg");
  expect(host.querySelector("[data-queued-preview]")?.getAttribute("data-preview-tier")).toBe("100");
});
it("reuses cached pixels after leaving the screen without retaining a full node", () => {
  const previews = new CanvasLru<any>(10), decoded = new CanvasLru<any>(10);
  previews.set("/uploads/near.jpg", { url: "/thumb.jpg", original: false });
  decoded.set("/thumb.jpg", { complete: true, naturalWidth: 100 });
  const caches = { previews, decoded };
  render(["near"], true, false, caches);
  render([], true, false, caches);
  expect(host.querySelector("img")).toBeNull();
  expect(mounts.size).toBe(0);
  render(["near"], true, false, caches);
  expect(host.querySelector("img")?.getAttribute("src")).toBe("/thumb.jpg");
  expect(host.querySelector("[data-real-node]")).toBeNull();
  render(["different"], true, false, caches);
  expect(host.querySelector("img")).toBeNull();
});
it.each([
  { original: true, complete: true, naturalWidth: 100 },
  { original: false, complete: false, naturalWidth: 100 },
  { original: false, complete: true, naturalWidth: 0 },
])("does not display original or unready pixels: %j", value => {
  const previews = new CanvasLru<any>(10), decoded = new CanvasLru<any>(10);
  previews.set("/uploads/near.jpg", { url: "/thumb.jpg", original: value.original });
  decoded.set("/thumb.jpg", value);
  render(["near"], true, false, { previews, decoded });
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector("[data-real-node]")).toBeNull();
});
it("keeps already mounted and selected content visible when panning begins", () => {
  render(["existing"], false);
  const content = host.querySelector("[data-real-node]");
  render(["existing"], true);
  expect(host.querySelector("[data-real-node]")).toBe(content);
  render(["selected"], true, true);
  expect(host.querySelector("[data-real-node]")).not.toBeNull();
});
it.each(["video", "videoTask"])("admits only the hovered queued %s before other visible nodes", kind => {
  const data = kind === "video" ? { kind, url: "/video.mp4" } : { kind, status: "success", outputUrl: "/video.mp4" };
  const ids = Array.from({ length: 100 }, (_, i) => String(i));
  const runtime = { mounts };
  render(ids, true, false, {}, data, runtime);
  render(ids, false, false, {}, data, runtime);
  const last = host.querySelectorAll('[data-canvas-deferred-node]')[99];
  act(() => last.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })));
  expect(host.querySelector('[data-real-node="99"]')).not.toBeNull();
  expect(host.querySelectorAll('[data-real-node]')).toHaveLength(1);
  expect(mounts.has("99")).toBe(true);
  expect(mounts.size).toBe(99);
});
it("defers hovered video admission until panning settles, even without another mouse-enter", () => {
  const data = { kind: "video", url: "/video.mp4" };
  const runtime = { mounts };
  render(["a", "b"], true, false, {}, data, runtime);
  const last = host.querySelectorAll('[data-canvas-deferred-node]')[1];
  vi.spyOn(last, "matches").mockImplementation(selector => selector === ":hover");
  act(() => last.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })));
  expect(host.querySelector('[data-real-node]')).toBeNull();
  render(["a", "b"], false, false, {}, data, runtime);
  expect(host.querySelector('[data-real-node="b"]')).not.toBeNull();
  expect(host.querySelectorAll('[data-real-node]')).toHaveLength(1);
  expect(mounts.size).toBe(1);
});
