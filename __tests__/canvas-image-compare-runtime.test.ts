// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasImageCompareNode, CanvasImageCompareView } from "@/components/canvas/CanvasImageCompareNode";
import { ReactFlowProvider } from "@xyflow/react";

vi.mock("@/components/canvas/CanvasNodeCard", async () => ({ CanvasNodeEditorContext: (await import("react")).createContext(null) }));
vi.mock("@/components/canvas/CanvasMediaImage", () => ({ CanvasMediaImage: (props: any) => React.createElement("img", props) }));

describe("image comparison interaction", () => {
  let host: HTMLDivElement;
  let root: Root;
  const commit = vi.fn();
  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    commit.mockClear();
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
  const render = (after = "/b.png", slider = 0.5) => act(() => root.render(React.createElement(CanvasImageCompareView, { before: "/a.png", after, slider, onCommit: commit })));

  it("enables the whole-node drop target only while connecting and shares valid/invalid feedback", () => {
    const renderNode = (connectionInProgress: boolean, connectionTargetState: "valid" | "invalid" | null) => act(() => root.render(React.createElement(ReactFlowProvider, null,
      React.createElement(CanvasImageCompareNode, { id: "compare", data: { kind: "compare", beforeUrl: "/a.png", afterUrl: "/b.png", slider: 0.5 }, selected: false, connectionInProgress, connectionTargetState }))));
    renderNode(true, "valid");
    const target = host.querySelector<HTMLElement>("[data-canvas-compare-body-target]")!;
    expect(target).not.toBeNull();
    expect(target.style.pointerEvents).toBe("auto");
    expect(target.style.inset).toBe("-20px");
    expect(target.getAttribute("data-handleid")).toBe("canvas-task-body-target");
    expect(host.querySelector(".canvas-connection-target-valid")).not.toBeNull();
    renderNode(true, "invalid");
    expect(host.querySelector(".canvas-connection-target-invalid")).not.toBeNull();
    expect(host.querySelector(".canvas-connection-target-invalid-frame")).not.toBeNull();
    renderNode(false, null);
    expect(target.style.pointerEvents).toBe("none");
    expect(host.querySelector("[data-canvas-connection-target-state]")).toBeNull();
    expect(host.querySelector('[role="slider"]')).not.toBeNull();
  });

  it("shows a single source without an empty image and enables comparison on the second input", () => {
    render("");
    expect(host.querySelectorAll("img")).toHaveLength(1);
    expect(host.querySelector('[role="slider"]')).toBeNull();
    render();
    expect(host.querySelectorAll("img")).toHaveLength(2);
    expect(host.querySelector('[role="slider"]')).not.toBeNull();
  });

  it("drags in screen coordinates at canvas zoom and saves only on release", () => {
    render();
    const frame = host.querySelector<HTMLElement>("[data-canvas-image-compare]")!;
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({ left: 100, width: 200 } as DOMRect);
    const slider = host.querySelector<HTMLElement>('[role="slider"]')!;
    let captured = false;
    slider.setPointerCapture = () => { captured = true; };
    slider.hasPointerCapture = () => captured;
    slider.releasePointerCapture = () => { captured = false; };
    const pointer = (type: string, clientX: number) => act(() => {
      const event = new MouseEvent(type, { bubbles: true, clientX });
      Object.defineProperty(event, "pointerId", { value: 1 });
      slider.dispatchEvent(event);
    });
    pointer("pointerdown", 200);
    pointer("pointermove", 250);
    expect(slider.getAttribute("aria-valuenow")).toBe("75");
    expect(commit).not.toHaveBeenCalled();
    pointer("pointerup", 250);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(0.75);
    render("/b.png", 0.25);
    expect(slider.getAttribute("aria-valuenow")).toBe("25");
  });

  it("supports keyboard endpoints and cancellation without saving the cancelled drag", () => {
    render();
    const slider = host.querySelector<HTMLElement>('[role="slider"]')!;
    act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "End" })));
    expect(commit).toHaveBeenLastCalledWith(1);
    act(() => slider.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Home" })));
    expect(commit).toHaveBeenLastCalledWith(0);
    commit.mockClear();
    act(() => slider.dispatchEvent(new Event("pointercancel", { bubbles: true })));
    expect(slider.getAttribute("aria-valuenow")).toBe("50");
    expect(commit).not.toHaveBeenCalled();
  });
});
