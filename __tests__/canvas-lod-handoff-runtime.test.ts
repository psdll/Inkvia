// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CanvasLodHandoff } from "@/components/canvas/CanvasLodHandoff";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
const render = (lowDetail: boolean, source = "a", url = lowDetail ? "thumb-a" : "full-a") => act(() => root.render(React.createElement(CanvasLodHandoff, { lowDetail, source, children: React.createElement("img", { src: url }) })));
const loaded = () => {
  const image = host.querySelector("img")!;
  Object.defineProperties(image, { complete: { configurable: true, value: true }, naturalWidth: { configurable: true, value: 100 } });
  act(() => image.dispatchEvent(new Event("load")));
  return image;
};
const overlay = () => host.querySelector(".canvas-thumbnail-handoff");
describe("decoded image handoff", () => {
  it("does not mistake the retained overlay for an asynchronously mounted replacement", async () => {
    render(true); loaded();
    act(() => root.render(React.createElement(CanvasLodHandoff, { lowDetail: false, source: "a", children: null })));
    const retained = overlay()!;
    Object.defineProperties(retained, { complete: { configurable: true, value: true }, naturalWidth: { configurable: true, value: 100 } });
    await act(async () => retained.dispatchEvent(new Event("load")));
    act(() => vi.advanceTimersByTime(500));
    expect(overlay()).toBe(retained);
    expect(retained.getAttribute("data-fading")).toBeNull();
  });
  it("retains old pixels throughout a one-second decode and fades for 120ms", async () => {
    let finish!: () => void;
    render(true); loaded();
    const decode = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    Object.defineProperty(host.querySelector("img"), "decode", { configurable: true, value: decode });
    render(false); expect(overlay()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1000)); expect(overlay()?.getAttribute("data-fading")).toBeNull();
    await act(async () => finish()); expect(overlay()?.getAttribute("data-fading")).toBe("true");
    act(() => vi.advanceTimersByTime(120)); expect(overlay()).toBeNull();
  });
  it("removes failed replacements rather than concealing the failure", async () => {
    render(true); const image = loaded();
    Object.defineProperty(image, "decode", { configurable: true, value: () => Promise.reject(new Error("decode failed")) });
    await act(async () => render(false)); expect(overlay()).toBeNull();
  });
  it("invalidates old callbacks on reversal and a different media identity", async () => {
    const pending: (() => void)[] = [];
    render(true); const image = loaded();
    Object.defineProperty(image, "decode", { configurable: true, value: () => new Promise<void>(resolve => pending.push(resolve)) });
    for (let i = 0; i < 10; i++) { render(false); render(true); loaded(); }
    render(false, "b", "full-b");
    await act(async () => pending.forEach(resolve => resolve()));
    act(() => vi.advanceTimersByTime(15000));
    expect(overlay()).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });
  it("disconnects observers and clears timers on unmount", () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    render(true); const image = loaded();
    Object.defineProperty(image, "decode", { configurable: true, value: () => new Promise(() => {}) });
    render(false); act(() => root.render(null));
    expect(disconnect).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
