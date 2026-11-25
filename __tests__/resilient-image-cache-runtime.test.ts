import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResilientImage, warmResilientImageCandidates } from "@/components/ui/resilient-image";

let root: Root, host: HTMLDivElement, sequence = 0;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) })));
  vi.stubGlobal("Image", class { onload?: () => void; set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); } });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:cache-${++sequence}`) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render(candidates: string[], className = "") {
  await act(async () => root.render(React.createElement(ResilientImage, { candidates, alt: "thumbnail", className, hideUntilLoaded: true, warmOnLoad: false })));
  return host.querySelector("img")!;
}
describe("decoded image continuity", () => {
  it("reveals a complete browser-cache image on mount without waiting for another load event", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1200);
    const img = await render(["/uploads/already-cached.png"]);
    expect(img.classList.contains("invisible")).toBe(false);
    await act(async () => root.render(null));
    expect((await render(["/uploads/already-cached.png"])).classList.contains("invisible")).toBe(false);
  });
  it("keeps incomplete and broken images hidden until a successful load", async () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    expect((await render(["/uploads/broken-cache.png"])).classList.contains("invisible")).toBe(true);
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1200);
    expect((await render(["/uploads/pending-cache.png"])).classList.contains("invisible")).toBe(true);
  });
  it("does not replace a displayed URL or hide the image when warming finishes before a parent rerender", async () => {
    const candidates = ["/uploads/keep-visible.png"];
    const img = await render(candidates);
    await act(async () => img.dispatchEvent(new Event("load")));
    const src = img.getAttribute("src");
    const warmed = await warmResilientImageCandidates(candidates);
    expect(warmed).toContain("blob:");
    await render(candidates, "selected");
    expect(host.querySelector("img")).toBe(img);
    expect(img.getAttribute("src")).toBe(src);
    expect(img.classList.contains("invisible")).toBe(false);
    // The cache still accelerates later mounts.
    await act(async () => root.render(null));
    expect((await render(candidates)).getAttribute("src")).toBe(warmed);
  });
  it("switches candidates when the actual media changes and keeps retry/fallback working", async () => {
    const original = ["/uploads/old-media.png"];
    await warmResilientImageCandidates(original);
    const img = await render(original);
    await render(["/uploads/new-media.png", "/uploads/fallback.png"]);
    expect(img.getAttribute("src")).toBe("/uploads/new-media.png");
    await act(async () => img.dispatchEvent(new Event("error")));
    expect(img.getAttribute("src")).toContain("_r=1");
    await act(async () => img.dispatchEvent(new Event("error")));
    expect(img.getAttribute("src")).toBe("/uploads/fallback.png");
  });
  it("does not fetch or turn an inline image error into a local route request", async () => {
    const source = "data:image/webp;base64,AAAA";
    const callsBefore = vi.mocked(fetch).mock.calls.length;
    expect(await warmResilientImageCandidates([source])).toBeNull();
    expect(vi.mocked(fetch).mock.calls.length).toBe(callsBefore);
    const img = await render([source, "/uploads/fallback-inline.png"]);
    expect(img.getAttribute("src")).toBe(source);
    await act(async () => img.dispatchEvent(new Event("error")));
    expect(img.getAttribute("src")).toBe("/uploads/fallback-inline.png");
  });
  it("recovers from an unusable cached blob using its source URL instead of retrying the same blob", async () => {
    const candidates = ["/uploads/evicted-cache.png"];
    const warmed = await warmResilientImageCandidates(candidates);
    const img = await render(candidates);
    expect(img.getAttribute("src")).toBe(warmed);
    await act(async () => img.dispatchEvent(new Event("error")));
    expect(img.getAttribute("src")).toBe(candidates[0]);
    await act(async () => img.dispatchEvent(new Event("load")));
    await render(candidates, "selected");
    expect(img.getAttribute("src")).toBe(candidates[0]);
    expect(img.classList.contains("invisible")).toBe(false);
  });
  it("retries a failed native warm cache and still falls back to the next candidate", async () => {
    const candidates = ["/uploads/native-warm.png", "/uploads/native-fallback.png"];
    const preload = document.createElement("img");
    const createElement = vi.spyOn(document, "createElement").mockReturnValue(preload);
    const warming = warmResilientImageCandidates(candidates, { signal: new AbortController().signal });
    preload.dispatchEvent(new Event("load"));
    await expect(warming).resolves.toBe(candidates[0]);
    createElement.mockRestore();
    const img = await render(candidates);
    expect(img.getAttribute("src")).toBe(candidates[0]);
    await act(async () => img.dispatchEvent(new Event("error")));
    expect(img.getAttribute("src")).toContain("native-warm.png?_r=1");
    await act(async () => img.dispatchEvent(new Event("error")));
    expect(img.getAttribute("src")).toBe(candidates[1]);
    await act(async () => img.dispatchEvent(new Event("load")));
    expect(img.classList.contains("invisible")).toBe(false);
  });
});
