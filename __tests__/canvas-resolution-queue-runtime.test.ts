import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCanvasImageResolution } from "@/components/canvas/use-canvas-image-resolution";
import { CanvasInteractingContext } from "@/components/canvas/canvas-runtime-context";

let root: Root, host: HTMLDivElement;
let requests: { url: string; signal: AbortSignal; finish: () => void }[];
function Probe({ src, enabled }: { src: string; enabled: boolean }) {
  const resolution = useCanvasImageResolution(src, undefined, enabled);
  return React.createElement("span", null, resolution);
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  requests = [];
  vi.stubGlobal("fetch", vi.fn((url: string, { signal }: { signal: AbortSignal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    requests.push({ url, signal, finish: () => resolve({ ok: true, json: async () => ({ width: 4000, height: 3000 }) }) });
  })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(sources: string[], enabled = true, busy = false) {
  await act(async () => root.render(React.createElement(CanvasInteractingContext.Provider, { value: busy },
    sources.map((src, index) => React.createElement(Probe, { key: index, src, enabled })))));
}

it("starts no metadata work for 100 overview nodes or during a gesture", async () => {
  const sources = Array.from({ length: 100 }, (_, i) => `/uploads/bulk-${i}.png`);
  await render(sources, false);
  expect(requests).toHaveLength(0);
  await render(sources, true, true);
  expect(requests).toHaveLength(0);
  await render(sources);
  expect(requests).toHaveLength(2);
  await render([], true);
  expect(requests.every(request => request.signal.aborted)).toBe(true);
  await render(["/uploads/current-view.png"]);
  expect(requests).toHaveLength(3);
  expect(requests[2].url).toContain("current-view.png");
});

it("shares a source request until its last visible consumer leaves", async () => {
  const src = "/uploads/shared-resolution.png";
  await render([src, src]);
  expect(requests).toHaveLength(1);
  await render([src]);
  expect(requests[0].signal.aborted).toBe(false);
  await act(async () => requests[0].finish());
  expect(host.textContent).toBe("4000 × 3000");
  await render([]); await render([src]);
  expect(requests).toHaveLength(1);
  expect(host.textContent).toBe("4000 × 3000");
});

it("aborts metadata when interaction starts and resumes after settling", async () => {
  const src = "/uploads/gesture-resolution.png";
  await render([src]);
  await render([src], true, true);
  expect(requests[0].signal.aborted).toBe(true);
  await render([src]);
  expect(requests).toHaveLength(2);
  await act(async () => requests[1].finish());
  expect(host.textContent).toBe("4000 × 3000");
});

it("stops an original-image probe when its node leaves, without trying fallback URLs", async () => {
  const images: { src: string; onload: (() => void) | null; onerror: (() => void) | null }[] = [];
  vi.stubGlobal("Image", class {
    src = "";
    onload = null;
    onerror = null;
    constructor() { images.push(this); }
  });
  await render(["https://example.com/original-resolution.jpg"]);
  expect(images).toHaveLength(1);
  expect(images[0].src).not.toBe("");
  await render([]);
  expect(images[0].src).toBe("");
  expect(images[0].onload).toBeNull();
  expect(images).toHaveLength(1);
});
