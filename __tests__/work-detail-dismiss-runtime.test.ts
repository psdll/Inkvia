// @vitest-environment jsdom
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkDetailModal } from "@/components/works/work-detail-modal";

vi.mock("@/hooks/use-model-display-names", () => ({ useModelDisplayNames: () => ({}) }));
vi.mock("@/components/ui/media-lightbox", () => ({ MediaLightbox: () => null }));
let host: HTMLDivElement;
let root: Root;
let close: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  close = vi.fn();
  act(() => root.render(React.createElement(WorkDetailModal, { open: true, onClose: close, item: { id: 1, type: "image_edit", status: "success", prompt: "测试提示词", localPath: null, createdAt: "2026-10-12" } })));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
describe("work detail dismissal shared by assets and admin", () => {
  it("closes on the actual outer layout layer, but keeps inner clicks and outward drags open", () => {
    const backdrop = host.querySelector("[data-work-detail-backdrop]")!;
    const dialog = host.querySelector('[role="dialog"]')!;
    act(() => { Simulate.pointerDown(dialog); Simulate.click(dialog); });
    expect(close).not.toHaveBeenCalled();
    act(() => { Simulate.pointerDown(dialog); Simulate.click(backdrop); });
    expect(close).not.toHaveBeenCalled();
    act(() => { Simulate.pointerDown(backdrop); Simulate.click(backdrop); });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it.each(["popstate", "hashchange"])("closes when navigation emits %s", event => {
    act(() => window.dispatchEvent(new Event(event)));
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("closes on Escape and restores scrolling after unmount", () => {
    expect(document.body.style.overflow).toBe("hidden");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(close).toHaveBeenCalledTimes(1);
    act(() => root.render(null));
    expect(document.body.style.overflow).toBe("");
  });
});
