import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: null, openLoginModal: vi.fn() }) }));
vi.mock("@/components/templates/inspiration-detail-fullscreen", () => ({ InspirationDetailFullscreen: () => null }));
import { InspirationDiscoverySection } from "@/components/home/inspiration-discovery-section";

const mousePointer = { pointerType: "mouse", bubbles: true };
const touchPointer = { pointerType: "touch", bubbles: true };
let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let request: ReturnType<typeof vi.fn>;
let observers: Array<{ callback: IntersectionObserverCallback; nodes: Set<Element> }>;
const items = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1, title: `素材 ${i + 1}`, toolType: i % 3 ? "image" : "video",
  mediaType: i % 3 ? "image" : "video",
  previewImagePath: i % 3 ? `/sample-${i}.jpg` : null,
  previewVideoPath: i % 3 ? null : `/sample-${i}.mp4`,
}));
const render = () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(InspirationDiscoverySection)));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  observers = [];
  vi.stubGlobal("IntersectionObserver", class {
    entry: typeof observers[number];
    constructor(callback: IntersectionObserverCallback) { this.entry = { callback, nodes: new Set() }; observers.push(this.entry); }
    observe(node: Element) { this.entry.nodes.add(node); }
    unobserve(node: Element) { this.entry.nodes.delete(node); }
    disconnect() { this.entry.nodes.clear(); }
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  request = vi.fn(async (url: string) => {
    if (!url.startsWith("/api/templates?")) return new Response("", { status: 404 });
    const params = new URL(url, "http://localhost").searchParams;
    const skip = Number(params.get("skip"));
    const take = Number(params.get("take"));
    return new Response(JSON.stringify({ data: items.slice(skip, skip + take), meta: { total: 60, version: "fixture", categories: ["图片设计", "视频创作"] } }));
  });
  vi.stubGlobal("fetch", request);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); };

it("limits initial data and avoids speculative category or offscreen media downloads", async () => {
  await act(async () => render()); await settle();
  const urls = request.mock.calls.map(([url]) => String(url));
  expect(urls.filter(url => url.startsWith("/api/templates?"))).toHaveLength(1);
  expect(new URL(urls[0], "http://localhost").searchParams.get("take")).toBe("18");
  expect(urls.filter(url => !url.startsWith("/api/templates?"))).toHaveLength(0);
  expect(host.querySelectorAll("img").length).toBeLessThanOrEqual(6);
  expect(host.querySelectorAll("video")).toHaveLength(0);
});

it("loads a missing-poster video only on interaction and releases it on leaving", async () => {
  await act(async () => render()); await settle();
  expect(host.querySelectorAll("video")).toHaveLength(0);
  const card = host.querySelector('button[class*="aspect-"]')!;
  await act(async () => Simulate.pointerEnter(card, mousePointer));
  expect(host.querySelector("video")?.getAttribute("src")).toBe("/sample-0.mp4");
  const video = host.querySelector("video")!;
  expect(video.autoplay).toBe(false);
  await act(async () => Simulate.pointerLeave(card));
  expect(video.pause).toHaveBeenCalled();
  expect(host.querySelectorAll("video")).toHaveLength(0);
  await act(async () => Simulate.focus(card));
  expect(host.querySelectorAll("video")).toHaveLength(0);
  await act(async () => Simulate.blur(card));
  expect(host.querySelectorAll("video")).toHaveLength(0);
});

it("shows fresh cached cards on return without refetching every loaded page", async () => {
  await act(async () => render()); await settle();
  const before = request.mock.calls.length;
  await act(async () => root.render(null));
  await act(async () => render()); await settle();
  expect(host.querySelectorAll('button[class*="aspect-"]').length).toBeGreaterThan(0);
  expect(request.mock.calls.length).toBe(before);
});

it("does not restart a preview when play or visibility callbacks finish after the mouse leaves", async () => {
  await act(async () => render()); await settle();
  const card = host.querySelector('button[class*="aspect-"]')!;
  let finishPlay!: () => void;
  const play = vi.mocked(HTMLMediaElement.prototype.play);
  play.mockImplementationOnce(() => new Promise<void>(resolve => { finishPlay = resolve; }));
  await act(async () => Simulate.pointerEnter(card, mousePointer));
  const video = host.querySelector("video")!;
  const observer = observers.find(entry => entry.nodes.has(video))!;
  const notify = () => observer.callback([{ target: video, isIntersecting: true, intersectionRatio: 1 } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
  await act(async () => notify());
  expect(play).toHaveBeenCalledTimes(1);
  await act(async () => Simulate.pointerLeave(card));
  const pauses = vi.mocked(video.pause).mock.calls.length;
  await act(async () => { finishPlay(); });
  expect(vi.mocked(video.pause).mock.calls.length).toBeGreaterThan(pauses);
  await act(async () => notify());
  expect(play).toHaveBeenCalledTimes(1);
  expect(host.querySelector("video")).toBeNull();
});

it("does not autoplay on touch or restored focus and stops on window blur", async () => {
  await act(async () => render()); await settle();
  const card = host.querySelector('button[class*="aspect-"]')!;
  await act(async () => Simulate.pointerEnter(card, touchPointer));
  expect(host.querySelector("video")).toBeNull();
  await act(async () => Simulate.pointerEnter(card, mousePointer));
  const video = host.querySelector("video")!;
  expect(video).not.toBeNull();
  await act(async () => window.dispatchEvent(new Event("blur")));
  expect(video.pause).toHaveBeenCalled();
  expect(host.querySelector("video")).toBeNull();
  await act(async () => Simulate.focus(card));
  expect(host.querySelector("video")).toBeNull();
});

it("pauses when offscreen or opening details and resumes only on a new hover", async () => {
  await act(async () => render()); await settle();
  const card = host.querySelector('button[class*="aspect-"]')!;
  await act(async () => Simulate.pointerEnter(card, mousePointer));
  const video = host.querySelector("video")!;
  const observer = observers.find(entry => entry.nodes.has(video))!;
  await act(async () => observer.callback([{ target: video, isIntersecting: true, intersectionRatio: 1 } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(video.play).toHaveBeenCalledTimes(1);
  await act(async () => observer.callback([{ target: video, isIntersecting: false, intersectionRatio: 0 } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(video.pause).toHaveBeenCalled();
  await act(async () => Simulate.click(card));
  expect(host.querySelector("video")).toBeNull();
  await act(async () => Simulate.focus(card));
  expect(host.querySelector("video")).toBeNull();
  await act(async () => Simulate.pointerEnter(card, mousePointer));
  expect(host.querySelector("video")).not.toBeNull();
});

it("requests the next page only near the end and appends without duplicates", async () => {
  await act(async () => render()); await settle();
  const sentinel = [...host.querySelectorAll("div")].find(el => el.textContent === "向下滚动加载更多")!;
  const observer = observers.find(entry => entry.nodes.has(sentinel))!;
  expect(observer).toBeDefined();
  await act(async () => observer.callback([{ target: sentinel, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver));
  await settle();
  const urls = request.mock.calls.map(([url]) => String(url));
  expect(urls.some(url => url.includes("skip=18"))).toBe(true);
  expect(host.querySelectorAll('button[class*="aspect-"]')).toHaveLength(36);
});

it("attaches offscreen image sources only as their cards approach the viewport", async () => {
  await act(async () => render()); await settle();
  const card = host.querySelectorAll('button[class*="aspect-"]')[7];
  expect(card.querySelector("img")).toBeNull();
  const observer = observers.find(entry => entry.nodes.has(card))!;
  await act(async () => observer.callback([{ target: card, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(card.querySelector("img")?.getAttribute("src")).toBe("/sample-7.jpg");
});

it("preserves the selected category and scroll position across page unmounts", async () => {
  await act(async () => render()); await settle();
  const category = [...host.querySelectorAll("button")].find(el => el.textContent === "视频创作")!;
  await act(async () => Simulate.click(category)); await settle();
  host.scrollTop = 720;
  await act(async () => root.render(null));
  host.scrollTop = 0;
  const before = request.mock.calls.length;
  await act(async () => render()); await settle();
  expect([...host.querySelectorAll("button")].find(el => el.textContent === "视频创作")?.className).toContain("bg-[var(--panel-3)]");
  expect(host.scrollTop).toBe(720);
  expect(request.mock.calls.length).toBe(before);
});

it("prefetches only the intended category and reuses that response on click", async () => {
  await act(async () => render()); await settle();
  const category = [...host.querySelectorAll("button")].find(el => el.textContent === "图片设计")!;
  await act(async () => Simulate.pointerEnter(category)); await settle();
  const count = request.mock.calls.length;
  expect(count).toBe(2);
  expect(new URL(request.mock.calls[1][0], "http://localhost").searchParams.get("category")).toBe("图片设计");
  await act(async () => Simulate.click(category)); await settle();
  expect(request.mock.calls.length).toBe(count);
});

it("starts detail loading on intent and shares the pending response with a click", async () => {
  await act(async () => render()); await settle();
  let finish: ((value: Response) => void) | undefined;
  request.mockImplementation((url: string) => {
    if (url === "/api/templates/2/detail") return new Promise<Response>(resolve => { finish = resolve; });
    return Promise.resolve(new Response("", { status: 404 }));
  });
  const card = host.querySelectorAll('button[class*="aspect-"]')[1];
  await act(async () => Simulate.pointerEnter(card, mousePointer));
  expect(request.mock.calls.filter(([url]) => url === "/api/templates/2/detail")).toHaveLength(1);
  await act(async () => Simulate.click(card));
  expect(request.mock.calls.filter(([url]) => url === "/api/templates/2/detail")).toHaveLength(1);
  await act(async () => finish?.(new Response(JSON.stringify({ success: true, data: { ...items[1], prompt: "test", detail: { inputImages: [], outputPaths: [] } } }))));
});

it("keeps cached cards usable while stale data refreshes and when that refresh fails", async () => {
  await act(async () => render()); await settle();
  await act(async () => root.render(null));
  await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
  let fail: ((error: Error) => void) | undefined;
  request.mockImplementation(() => new Promise<Response>((_resolve, reject) => { fail = reject; }));
  await act(async () => render()); await settle();
  expect(host.querySelectorAll('button[class*="aspect-"]')).toHaveLength(18);
  expect([...host.querySelectorAll('button[class*="aspect-"]')].every(el => !(el as HTMLButtonElement).disabled)).toBe(true);
  await act(async () => fail?.(new Error("offline"))); await settle();
  expect(host.querySelectorAll('button[class*="aspect-"]')).toHaveLength(18);
});
