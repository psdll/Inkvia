// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let images: HTMLImageElement[];
beforeEach(() => {
  vi.resetModules();
  images = [];
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
    const element = createElement(tagName, options);
    if (tagName === "img") {
      Object.defineProperties(element, { naturalWidth: { value: 1200 }, naturalHeight: { value: 1200 } });
      images.push(element as HTMLImageElement);
    }
    return element;
  });
  // Model an installed extension that reports every cancelled fetch as an error.
  vi.stubGlobal("fetch", vi.fn((_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      console.error("Fetch request failed:", init.signal.reason);
      reject(init.signal.reason);
    });
  })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("cancels and immediately retries a preview without invoking extension-wrapped fetch", async () => {
  const { warmResilientImageCandidates: warm } = await import("@/components/ui/resilient-image");
  const errors = vi.spyOn(console, "error");
  const first = new AbortController();
  const pending = warm(["/cancel.png"], { signal: first.signal });
  const lateLoad = images[0].onload;
  first.abort();
  const retry = warm(["/cancel.png"], { signal: new AbortController().signal });
  expect(images).toHaveLength(2);
  expect(images[0].hasAttribute("src")).toBe(false);
  // A late event from the cancelled attempt must not replace the new attempt.
  lateLoad?.call(images[0], new Event("load"));
  images[1].dispatchEvent(new Event("load"));
  await expect(pending).resolves.toBeNull();
  await expect(retry).resolves.toBe("/cancel.png");
  expect(fetch).not.toHaveBeenCalled();
  expect(errors).not.toHaveBeenCalled();
});

it("deduplicates active previews, retains the loaded image, and tries a fallback after failure", async () => {
  const { warmResilientImageCandidates: warm } = await import("@/components/ui/resilient-image");
  const options = { signal: new AbortController().signal };
  const first = warm(["/missing.png", "/fallback.png"], options);
  const second = warm(["/missing.png", "/fallback.png"], options);
  expect(images).toHaveLength(1);
  images[0].dispatchEvent(new Event("error"));
  await Promise.resolve();
  expect(images).toHaveLength(2);
  images[1].dispatchEvent(new Event("load"));
  expect(await Promise.all([first, second])).toEqual(["/fallback.png", "/fallback.png"]);
  expect(images[1].getAttribute("src")).toBe("/fallback.png");
  await expect(warm(["/missing.png", "/fallback.png"], options)).resolves.toBe("/fallback.png");
  expect(images).toHaveLength(2);
});

it("bounds native preview memory and frees evicted image sources", async () => {
  const { warmResilientImageCandidates: warm } = await import("@/components/ui/resilient-image");
  for (let index = 0; index < 30; index++) {
    const pending = warm([`/bounded-${index}.png`], { signal: new AbortController().signal });
    images[index].dispatchEvent(new Event("load"));
    await pending;
  }
  const retained = images.filter(image => image.hasAttribute("src")).length;
  expect(retained).toBeGreaterThan(0);
  expect(retained * 1200 * 1200 * 4).toBeLessThanOrEqual(96 * 1024 * 1024);
  expect(images[0].hasAttribute("src")).toBe(false);
});

it("releases stalled preview slots so later images can still load", async () => {
  vi.useFakeTimers();
  const { subscribeMaterialPreview } = await import("@/lib/client/material-preview-queue");
  const cancel = Array.from({ length: 6 }, (_, index) => subscribeMaterialPreview([`/stalled-${index}.png`], 100000, () => {}));
  const ready = vi.fn();
  cancel.push(subscribeMaterialPreview(["/after-stalled.png"], 100000, ready));
  await Promise.resolve();
  expect(images).toHaveLength(6);
  await vi.advanceTimersByTimeAsync(15000);
  expect(images).toHaveLength(7);
  expect(images.slice(0, 6).every(image => !image.hasAttribute("src"))).toBe(true);
  images[6].dispatchEvent(new Event("load"));
  await vi.advanceTimersByTimeAsync(0);
  expect(ready).toHaveBeenCalledOnce();
  cancel.forEach(cleanup => cleanup());
  expect(fetch).not.toHaveBeenCalled();
});

it("preempts background previews and restarts them after visible work completes", async () => {
  const { subscribeMaterialPreview } = await import("@/lib/client/material-preview-queue");
  const ready = vi.fn();
  const cleanups = Array.from({ length: 6 }, (_, index) => subscribeMaterialPreview([`/background-${index}.png`], index, ready));
  await Promise.resolve();
  const lowestPriorityImage = images.find(image => image.getAttribute("src") === "/background-0.png")!;
  const visibleReady = vi.fn();
  cleanups.push(subscribeMaterialPreview(["/visible.png"], 100000, visibleReady));
  await vi.waitFor(() => expect(images).toHaveLength(7));
  expect(lowestPriorityImage.hasAttribute("src")).toBe(false);
  expect(images[6].getAttribute("src")).toBe("/visible.png");
  expect(ready).not.toHaveBeenCalled();
  images[6].dispatchEvent(new Event("load"));
  await vi.waitFor(() => expect(images).toHaveLength(8));
  expect(visibleReady).toHaveBeenCalledOnce();
  expect(images[7].getAttribute("src")).toBe("/background-0.png");
  cleanups.forEach(cancel => cancel());
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(ready).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("shows a previously loaded preview even when all six loading slots are stalled", async () => {
  const { warmResilientImageCandidates: warm } = await import("@/components/ui/resilient-image");
  const { subscribeMaterialPreview } = await import("@/lib/client/material-preview-queue");
  const warmed = warm(["/seen.png"], { signal: new AbortController().signal });
  images[0].dispatchEvent(new Event("load"));
  await warmed;
  const cleanups = Array.from({ length: 6 }, (_, index) => subscribeMaterialPreview([`/blocked-${index}.png`], 100000, () => {}));
  await Promise.resolve();
  const ready = vi.fn();
  cleanups.push(subscribeMaterialPreview(["/seen.png"], 100000, ready));
  await Promise.resolve();
  try {
    expect(ready).toHaveBeenCalledOnce();
    expect(images).toHaveLength(7);
  } finally {
    cleanups.forEach(cancel => cancel());
  }
});

it("starts visible previews before background cards subscribed in the same render", async () => {
  const { subscribeMaterialPreview } = await import("@/lib/client/material-preview-queue");
  const cleanups = Array.from({ length: 6 }, (_, index) => subscribeMaterialPreview([`/offscreen-${index}.png`], 10000, () => {}));
  cleanups.push(subscribeMaterialPreview(["/onscreen.png"], 100000, () => {}));
  await Promise.resolve();
  try {
    expect(images[0].getAttribute("src")).toBe("/onscreen.png");
    expect(images).toHaveLength(6);
    expect(images.every(image => image.hasAttribute("src"))).toBe(true);
  } finally {
    cleanups.forEach(cancel => cancel());
  }
});

it("remembers a successful fallback after decoded pixels have been evicted", async () => {
  const { warmResilientImageCandidates: warm, hasLoadedResilientImageCandidates: hasLoaded } = await import("@/components/ui/resilient-image");
  const { subscribeMaterialPreview } = await import("@/lib/client/material-preview-queue");
  const candidates = ["/missing-old.png", "/working-old.png"];
  const pending = warm(candidates, { signal: new AbortController().signal });
  images[0].dispatchEvent(new Event("error"));
  await Promise.resolve();
  images[1].dispatchEvent(new Event("load"));
  await pending;
  for (let index = 0; index < 30; index++) {
    const next = warm([`/eviction-${index}.png`], { signal: new AbortController().signal });
    images.at(-1)!.dispatchEvent(new Event("load"));
    await next;
  }
  expect(images[1].hasAttribute("src")).toBe(false);
  expect(hasLoaded(candidates)).toBe(true);
  expect(hasLoaded(["/different-media.png"])).toBe(false);
  const count = images.length;
  const ready = vi.fn();
  subscribeMaterialPreview(candidates, 100000, ready)();
  expect(ready).toHaveBeenCalledOnce();
  expect(images).toHaveLength(count);
});

it("evicts speculative preloads before recently viewed images without raising the memory cap", async () => {
  const { warmResilientImageCandidates: warm } = await import("@/components/ui/resilient-image");
  const visible = warm(["/keep-recent.png"], { signal: new AbortController().signal, priority: "visible" });
  images[0].dispatchEvent(new Event("load"));
  await visible;
  for (let i = 0; i < 30; i++) {
    const pending = warm([`/ahead-${i}.png`], { signal: new AbortController().signal, priority: "prefetch" });
    images.at(-1)!.dispatchEvent(new Event("load"));
    await pending;
  }
  expect(images[0].getAttribute("src")).toBe("/keep-recent.png");
  expect(images[1].hasAttribute("src")).toBe(false);
  expect(images.filter(image => image.hasAttribute("src")).length * 1200 * 1200 * 4).toBeLessThanOrEqual(96 * 1024 * 1024);
  // Viewed images are LRU too: protection must not pin old images forever.
  for (let i = 0; i < 30; i++) {
    const pending = warm([`/viewed-${i}.png`], { signal: new AbortController().signal, priority: "visible" });
    images.at(-1)!.dispatchEvent(new Event("load"));
    await pending;
  }
  expect(images[0].hasAttribute("src")).toBe(false);
  expect(images.filter(image => image.hasAttribute("src")).length * 1200 * 1200 * 4).toBeLessThanOrEqual(96 * 1024 * 1024);
});

it("leaves room for upcoming images after the viewed cache fills up", async () => {
  const { warmResilientImageCandidates: warm } = await import("@/components/ui/resilient-image");
  for (let i = 0; i < 17; i++) {
    const pending = warm([`/full-viewed-${i}.png`], { signal: new AbortController().signal, priority: "visible" });
    images.at(-1)!.dispatchEvent(new Event("load"));
    await pending;
  }
  const next = warm(["/next-screen.png"], { signal: new AbortController().signal, priority: "prefetch" });
  const image = images.at(-1)!;
  image.dispatchEvent(new Event("load"));
  await next;
  expect(image.hasAttribute("src")).toBe(true);
  const count = images.length;
  await warm(["/next-screen.png"], { priority: "visible" });
  expect(images).toHaveLength(count);
  expect(images.filter(image => image.hasAttribute("src")).length * 1200 * 1200 * 4).toBeLessThanOrEqual(96 * 1024 * 1024);
});
