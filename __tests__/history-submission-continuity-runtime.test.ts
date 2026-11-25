import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/ui/media-lightbox", () => ({ MediaLightbox: () => null }));
vi.mock("@/components/ui/canvas-board", () => ({ CanvasBoard: ({ src, preview }: { src: string; preview?: React.ReactNode }) => React.createElement("div", null, React.createElement("img", { src, "data-result": true }), preview) }));
vi.mock("@/components/ui/video-poster-preview", () => ({ VideoPosterPreview: ({ videoSrc, posterSrc, fit }: { videoSrc: string; posterSrc?: string; fit?: string }) => React.createElement("div", { "data-poster-video": videoSrc, "data-poster-src": posterSrc, "data-poster-fit": fit }) }));
vi.mock("@/components/ui/media-image", () => ({ MediaImage: ({ src, previewSize }: { src: string; previewSize?: { width: number } }) => React.createElement("img", { src, "data-media-image": true, "data-preview-width": previewSize?.width }) }));
vi.mock("@/components/ui/resilient-image", () => ({ ResilientImage: () => null }));

import { UnifiedHistoryPanel, type UnifiedHistoryPanelHandle } from "@/components/history/unified-history-panel";

let host: HTMLDivElement;
let root: Root;
let panel: React.RefObject<UnifiedHistoryPanelHandle>;
let userIndex = 0;
let records: any[];
const submittedAt = new Date().toISOString();
const metadata = { prompt: "A reference-preserving image", model: "nano-banana-pro", params: { aspectRatio: "16:9", resolution: "2K", taskType: "image_edit" } };
const record = (id: number, batchId: string, extra = {}) => ({
  id, type: "image_edit", status: "running", localPath: null, createdAt: submittedAt,
  ...metadata, params: { ...metadata.params, batch: { id: batchId, index: 1, size: 1, submittedAt } }, ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  records = [];
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const parsed = new URL(url, window.location.origin);
    if (parsed.pathname === "/api/history/summary") return new Response(JSON.stringify({ inProgressCount: 0, completedCount: 0 }));
    if (parsed.pathname === "/api/history") {
      const id = parsed.searchParams.get("id");
      return new Response(JSON.stringify(id ? { item: records.find(item => String(item.id) === id) } : { items: records, hasMore: false }));
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  panel = React.createRef();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount() {
  await act(async () => root.render(React.createElement(VirtuosoMockContext.Provider, {
    value: { viewportHeight: 1200, itemHeight: 72 },
  }, React.createElement(UnifiedHistoryPanel, {
    ref: panel, userId: `continuity-${++userIndex}`, staticVideoPreviews: true,
  }))));
}
async function submit(batchId: string) {
  let ids: string[] = [];
  await act(async () => { ids = panel.current!.addPendingItems({ type: "image_edit", batchId, count: 1, submittedAt, ...metadata }); });
  return ids[0];
}
const stage = () => host.querySelector(".history-generating-indicator--default");
const sweep = () => stage()?.querySelector(".history-generating-indicator__sweep");
const thumbnail = () => host.querySelector(".history-generating-indicator--thumbnail");

describe("submission history continuity", () => {
  it.each(["https://example.com/result.mp4", "https://example.com/playback?id=42"])("shows a saving video using its available preview %s in both surfaces", async (previewUrl) => {
    records = [record(910, "saving-video", { type: "video_gen", phase: "saving", displayKind: "video", displayUrl: previewUrl, previewUrl })];
    await mount();
    const video = host.querySelector<HTMLVideoElement>("[data-app-video-player] video")!;
    expect(video?.getAttribute("src")).toBe(previewUrl);
    expect(video.preload).toBe("auto");
    expect(host.querySelector("[data-result]")).toBeNull();
    const posters = [...host.querySelectorAll("[data-poster-video]")];
    expect(posters).toHaveLength(2);
    expect(posters.map(el => el.getAttribute("data-poster-video"))).toEqual([previewUrl, previewUrl]);
    expect(host.querySelector("[data-app-video-player]")?.classList.contains("opacity-0")).toBe(false);
    act(() => video.dispatchEvent(new Event("loadeddata")));
    expect(video.dataset.videoReady).toBe("true");
    expect(host.querySelector('[data-poster-fit="contain"]')).toBeNull();

    records = [record(910, "saving-video", { type: "video_gen", phase: "ready", status: "success", displayKind: "video", localPath: "/saved.mp4", displayUrl: "/poster.webp", posterUrl: "/poster.webp" })];
    await act(async () => panel.current!.reload());
    expect(host.querySelector("[data-result]")).toBeNull();
    expect(video.getAttribute("src")).toBe("/saved.mp4");
    expect(video.dataset.videoReady).toBe("false");
    expect(host.querySelector('[data-poster-fit="contain"]')?.getAttribute("data-poster-src")).toBe("/poster.webp");
    act(() => video.dispatchEvent(new Event("loadeddata")));
    expect(host.querySelector('[data-poster-fit="contain"]')).toBeNull();
  });

  it("shows a video poster without feeding that image URL to the player", async () => {
    records = [record(911, "poster-before-video", { type: "video_gen", phase: "saving", displayKind: "video", displayUrl: "/poster.webp", previewUrl: "/poster.webp", posterUrl: "/poster.webp" })];
    await mount();
    expect(host.querySelector("[data-result]")).toBeNull();
    expect(host.querySelector("[data-app-video-player]")).toBeNull();
    const posters = [...host.querySelectorAll("[data-poster-src]")];
    expect(posters).toHaveLength(2);
    expect(posters.every(el => el.getAttribute("data-poster-src") === "/poster.webp")).toBe(true);
    expect(posters.every(el => el.getAttribute("data-poster-video") === "")).toBe(true);
  });

  it("uses the same thumbnail source and size while the full image is loading", async () => {
    records = [record(912, "image-preview", { status: "success", localPath: "/original.png", displayUrl: "/preview.webp" })];
    await mount();
    const images = [...host.querySelectorAll('[data-media-image][src="/preview.webp"]')];
    expect(images).toHaveLength(2);
    expect(images.map(el => el.getAttribute("data-preview-width"))).toEqual(["192", "192"]);
    expect(host.querySelector("[data-result]")?.getAttribute("src")).toBe("/preview.webp");
  });

  it.each(["image_edit", "video_gen"])("keeps the selected history result while a %s submission is acknowledged and completed", async (type) => {
    const oldRecord = record(900, "browsed-history", { status: "success", localPath: "/browsed-result.png" });
    records = [oldRecord];
    await mount();
    let id = "";
    await act(async () => {
      id = type === "image_edit"
        ? panel.current!.addPendingItems({ type, batchId: "browsing-submit", count: 1, ...metadata })[0]
        : panel.current!.addPendingItem(type, "browsing-submit", metadata);
    });
    expect(host.querySelector("[data-result]")).toBeNull();
    const historyButton = host.querySelector<HTMLButtonElement>('[data-history-thumbnail="item:900"] button')!;
    expect(historyButton).not.toBeNull();
    await act(async () => historyButton.click());
    const selectedResult = host.querySelector<HTMLImageElement>("[data-result]");
    expect(selectedResult?.getAttribute("src")).toBe("/browsed-result.png");
    await act(async () => panel.current!.resolvePendingItem(id, "1008"));
    expect(host.querySelector("[data-result]")).toBe(selectedResult);
    records = [record(1008, "browsing-submit", { type }), oldRecord];
    await act(async () => panel.current!.reload());
    expect(host.querySelector("[data-result]")).toBe(selectedResult);
    records = [record(1008, "browsing-submit", { type, status: "success", localPath: type === "video_gen" ? "/new-result.mp4" : "/new-result.png" }), oldRecord];
    await act(async () => panel.current!.reload());
    expect(host.querySelector("[data-result]")).toBe(selectedResult);
    expect(selectedResult?.getAttribute("src")).toBe("/browsed-result.png");
  });

  it("preserves browsing when history discovers a submitted image before the acknowledgement", async () => {
    const oldRecord = record(901, "browsed-history", { status: "success", localPath: "/browsed-result.png" });
    records = [oldRecord];
    await mount();
    const id = await submit("browsing-early-history");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-history-thumbnail="item:901"] button')!.click());
    const selectedResult = host.querySelector("[data-result]");
    expect(selectedResult).not.toBeNull();
    records = [record(1009, "browsing-early-history"), oldRecord];
    await act(async () => panel.current!.reload());
    expect(host.querySelector("[data-result]")).toBe(selectedResult);
    await act(async () => panel.current!.resolvePendingItem(id, "1009"));
    expect(host.querySelector("[data-result]")).toBe(selectedResult);
    expect(host.querySelectorAll("[data-history-thumbnail]")).toHaveLength(2);
  });

  it("toggles completed videos on surface clicks and restarts only on hover re-entry", async () => {
    records = [record(1007, "completed-video", { type: "video_gen", status: "success", localPath: "/result.mp4" })];
    await mount();
    const video = host.querySelector<HTMLVideoElement>("[data-app-video-player] video")!;
    expect(video).not.toBeNull();
    let paused = true;
    Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
    vi.spyOn(video, "play").mockImplementation(async () => {
      paused = false;
      video.dispatchEvent(new Event("play"));
    });
    vi.spyOn(video, "pause").mockImplementation(() => {
      paused = true;
      video.dispatchEvent(new Event("pause"));
    });

    video.currentTime = 7;
    act(() => video.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(video.currentTime).toBe(0);
    expect(video.paused).toBe(false);
    video.currentTime = 3;
    act(() => video.click());
    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(3);
    act(() => video.click());
    expect(video.paused).toBe(false);
    expect(video.currentTime).toBe(3);
    act(() => video.click());
    expect(video.paused).toBe(true);

    // The explicit play control must not toggle a second time via surface bubbling.
    act(() => host.querySelector<HTMLButtonElement>('[data-app-video-controls] button[aria-label="播放"]')!.click());
    expect(video.paused).toBe(false);
    expect(video.currentTime).toBe(3);
    act(() => video.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
    expect(video.paused).toBe(true);
    act(() => video.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body })));
    expect(video.paused).toBe(false);
    expect(video.currentTime).toBe(0);
  });

  it("shows prompt, model and parameters in the first pending render", async () => {
    await mount();
    await submit("initial-metadata");
    expect(stage()).not.toBeNull();
    expect(host.textContent).toContain(metadata.prompt);
    expect(host.textContent).toContain(metadata.model);
    expect(host.textContent).toContain("2K");
  });

  it("keeps the same animation nodes through acknowledgement and full record refresh", async () => {
    await mount();
    const id = await submit("normal-ack");
    const before = { stage: stage(), sweep: sweep(), thumbnail: thumbnail() };
    await act(async () => panel.current!.resolvePendingItem(id, "1001"));
    records = [record(1001, "normal-ack", { prompt: "Server-confirmed prompt" })];
    await act(async () => panel.current!.reload());
    expect(stage()).toBe(before.stage);
    expect(sweep()).toBe(before.sweep);
    expect(thumbnail()).toBe(before.thumbnail);
    expect(host.textContent).toContain("Server-confirmed prompt");
    expect(host.querySelectorAll("[data-history-thumbnail]")).toHaveLength(1);
    records = [record(1001, "normal-ack", { prompt: "Updated prompt", model: "confirmed-model" })];
    await act(async () => panel.current!.reload());
    expect(host.textContent).toContain("Updated prompt");
    expect(host.textContent).toContain("confirmed-model");
    expect(sweep()).toBe(before.sweep);
  });

  it("preserves the animation when history discovers the record before POST returns", async () => {
    await mount();
    const id = await submit("early-history");
    const before = { stage: stage(), sweep: sweep(), thumbnail: thumbnail() };
    records = [record(1002, "early-history")];
    await act(async () => panel.current!.reload());
    expect(stage()).toBe(before.stage);
    expect(sweep()).toBe(before.sweep);
    expect(thumbnail()).toBe(before.thumbnail);
    await act(async () => panel.current!.resolvePendingItem(id, "1002"));
    expect(stage()).toBe(before.stage);
    expect(host.querySelectorAll("[data-history-thumbnail]")).toHaveLength(1);
  });

  it("keeps every animation node when a multi-image submission receives real ids", async () => {
    await mount();
    let ids: string[] = [];
    await act(async () => { ids = panel.current!.addPendingItems({ type: "image_edit", batchId: "multiple-images", count: 2, ...metadata }); });
    const before = Array.from(host.querySelectorAll(".history-generating-indicator__sweep"));
    expect(before.length).toBeGreaterThanOrEqual(2);
    await act(async () => {
      panel.current!.resolvePendingItem(ids[0], "1003");
      panel.current!.resolvePendingItem(ids[1], "1004");
    });
    const after = Array.from(host.querySelectorAll(".history-generating-indicator__sweep"));
    expect(after).toHaveLength(before.length);
    after.forEach((node, index) => expect(node).toBe(before[index]));
    expect(before.every(node => node.isConnected)).toBe(true);
  });

  it("keeps the selected animation in a virtualized history strip", async () => {
    records = Array.from({ length: 14 }, (_, i) => record(2000 + i, `old-${i}`, { status: "success", localPath: "/old-result.png" }));
    await mount();
    const id = await submit("virtualized");
    const before = { stage: stage(), thumbnail: thumbnail() };
    expect(before.thumbnail).not.toBeNull();
    await act(async () => panel.current!.resolvePendingItem(id, "1005"));
    records = [record(1005, "virtualized"), ...records];
    await act(async () => panel.current!.reload());
    expect(stage()).toBe(before.stage);
    expect(thumbnail()).toBe(before.thumbnail);
  });

  it("shows video submission metadata immediately and retains its stage on acknowledgement", async () => {
    await mount();
    let id = "";
    const videoMetadata = { prompt: "A video reference prompt", model: "video-model", params: { ratio: "16:9", resolution: "720p", duration: "5" } };
    await act(async () => { id = panel.current!.addPendingItem("video_gen", "video-request", videoMetadata); });
    const stage = host.querySelector(".history-generating-indicator--compact");
    expect(stage).not.toBeNull();
    expect(host.textContent).toContain(videoMetadata.prompt);
    expect(host.textContent).toContain("720p");
    await act(async () => panel.current!.resolvePendingItem(id, "1006"));
    expect(host.querySelector(".history-generating-indicator--compact")).toBe(stage);
  });
});
