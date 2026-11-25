import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasNodeCard, CanvasNodeEditorContext } from "@/components/canvas/CanvasNodeCard";
import type { PromptReferenceAsset } from "@/lib/prompt-asset-references";

vi.mock("@/components/canvas/use-canvas-models", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/canvas/use-canvas-models")>(),
  useCanvasModels: () => null,
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));

const assets: PromptReferenceAsset[] = ["a", "b", "c"].map((id, index) => ({
  id, token: `图片${index + 1}`, kind: "image", url: `/uploads/${id}.png`,
}));

describe("canvas reference pointer swap", () => {
  let host: HTMLDivElement;
  let root: Root;
  let hitTarget: Element | null;
  const reorder = vi.fn();
  const remove = vi.fn();
  const mention = vi.fn();

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal("Image", class { async decode() {} });
    Object.defineProperties(HTMLElement.prototype, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      releasePointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => true },
    });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => hitTarget });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    hitTarget = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function render(kind: "imageTask" | "videoTask") {
    await act(async () => root.render(React.createElement(ReactFlowProvider, null,
      React.createElement(CanvasNodeEditorContext.Provider, { value: {
        getTaskAssets: () => assets, isPanelVisible: () => true, isTaskPanelVisible: () => true,
        getTaskResultName: () => "测试任务", getMediaName: () => "测试任务",
        reorderTaskReferences: reorder, removeTaskReference: remove, mentionTaskReference: mention,
      } as any }, React.createElement(CanvasNodeCard, {
        id: "task", type: kind,
        data: kind === "imageTask"
          ? { kind, task: { references: [], batches: [], settings: { model: "", prompt: "", aspectRatio: "1:1", resolution: "2K", quality: "", count: 1 } } }
          : { kind, model: "", prompt: "", mediaPaths: [], status: "idle" },
        selected: true, dragging: false, isConnectable: true, zIndex: 0,
        draggable: true, selectable: true, deletable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
      })),
    )));
    const cards = [...host.querySelectorAll<HTMLElement>(".canvas-reference-card")];
    cards.forEach((card, index) => {
      const left = index * 56;
      vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
        x: left, y: 0, left, top: 0, right: left + 48, bottom: 48,
        width: 48, height: 48, toJSON() {},
      });
    });
    return cards;
  }

  function pointer(target: Element, type: string, x = 0) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 20 });
    Object.defineProperty(event, "pointerId", { value: 1 });
    act(() => { target.dispatchEvent(event); });
  }

  it.each(["imageTask", "videoTask"] as const)("shows insertion rather than exchange for new media dragged onto %s", async (kind) => {
    const cards = await render(kind);
    const drag = (type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 20 });
      Object.defineProperty(event, "dataTransfer", { value: { types: ["application/x-canvas-lib"] } });
      act(() => { cards[1].dispatchEvent(event); });
    };
    drag("dragover", 60);
    expect(cards[1].dataset.dropPlacement).toBe("before");
    expect(cards[1].textContent).toContain("插到前");
    drag("dragover", 99);
    expect(cards[1].dataset.dropPlacement).toBe("after");
    expect(cards[1].textContent).toContain("插到后");
    drag("drop", 99);
    expect(cards[1].dataset.dropPlacement).toBeUndefined();
    expect(reorder).not.toHaveBeenCalled();
  });

  it.each(["imageTask", "videoTask"] as const)("swaps non-adjacent references in %s without shifting the middle item", async (kind) => {
    const cards = await render(kind);
    expect(cards).toHaveLength(3);
    pointer(cards[0], "pointerdown");
    hitTarget = cards[2];
    pointer(cards[0], "pointermove", 136);
    expect(cards[2].dataset.dropTarget).toBe("true");
    pointer(cards[0], "pointerup", 136);
    expect(reorder).toHaveBeenCalledTimes(1);
    expect(reorder).toHaveBeenCalledWith("task", ["c", "b", "a"]);
    expect(host.querySelector('[data-dragging="true"]')).toBeNull();
  });

  describe.each(["imageTask", "videoTask"] as const)("%s insertion", (kind) => {
    it.each([
      { source: 0, target: 2, x: 115, placement: "before", order: ["b", "a", "c"] },
      { source: 0, target: 2, x: 157, placement: "after", order: ["b", "c", "a"] },
      { source: 2, target: 0, x: 3, placement: "before", order: ["c", "a", "b"] },
      { source: 2, target: 0, x: 45, placement: "after", order: ["a", "c", "b"] },
    ])("inserts $placement from $source to $target", async ({ source, target, x, placement, order }) => {
      const cards = await render(kind);
      pointer(cards[source], "pointerdown", source * 56 + 24);
      hitTarget = cards[target];
      pointer(cards[source], "pointermove", x);
      expect(cards[target].dataset.dropPlacement).toBe(placement);
      expect(cards[target].querySelector("[data-canvas-reference-drop-hint]")?.textContent).toBe(placement === "before" ? "插到前" : "插到后");
      expect(cards[target].dataset.dropTarget).toBeUndefined();
      pointer(cards[source], "pointerup", x);
      expect(reorder).toHaveBeenCalledOnce();
      expect(reorder).toHaveBeenCalledWith("task", order);
      expect(host.querySelector("[data-drop-placement]")).toBeNull();
    });

    it("accepts the gap between references", async () => {
      const cards = await render(kind);
      pointer(cards[2], "pointerdown", 136);
      hitTarget = host.querySelector("[data-canvas-task-assets]");
      pointer(cards[2], "pointermove", 52);
      expect(cards[0].dataset.dropPlacement).toBe("after");
      pointer(cards[2], "pointerup", 52);
      expect(reorder).toHaveBeenCalledWith("task", ["a", "c", "b"]);
    });

    it("keeps the same order when inserted into the current slot", async () => {
      const cards = await render(kind);
      pointer(cards[0], "pointerdown", 24);
      hitTarget = cards[1];
      pointer(cards[0], "pointermove", 59);
      pointer(cards[0], "pointerup", 59);
      expect(reorder).not.toHaveBeenCalled();
    });
  });

  it("uses an insertion target between wrapped rows", async () => {
    const cards = await render("imageTask");
    vi.mocked(cards[2].getBoundingClientRect).mockReturnValue({
      x: 0, y: 56, left: 0, top: 56, right: 48, bottom: 104, width: 48, height: 48, toJSON() {},
    });
    pointer(cards[2], "pointerdown", 24);
    hitTarget = host.querySelector("[data-canvas-task-assets]");
    const move = new MouseEvent("pointermove", { bubbles: true, clientX: 24, clientY: 52 });
    Object.defineProperty(move, "pointerId", { value: 1 });
    act(() => { cards[2].dispatchEvent(move); });
    expect(cards[0].dataset.dropPlacement).toBe("after");
    const up = new MouseEvent("pointerup", { bubbles: true, clientX: 24, clientY: 52 });
    Object.defineProperty(up, "pointerId", { value: 1 });
    act(() => { cards[2].dispatchEvent(up); });
    expect(reorder).toHaveBeenCalledWith("task", ["a", "c", "b"]);
  });

  it("cancels when the pointer is cancelled or released outside the panel", async () => {
    const cards = await render("imageTask");
    for (const ending of ["pointercancel", "lostpointercapture", "pointerup"]) {
      pointer(cards[0], "pointerdown");
      hitTarget = cards[2];
      pointer(cards[0], "pointermove", 120);
      hitTarget = document.body;
      pointer(cards[0], ending, 200);
      expect(reorder).not.toHaveBeenCalled();
      expect(host.querySelector('[data-drop-target="true"]')).toBeNull();
      expect(host.querySelector('[data-drop-placement]')).toBeNull();
    }
  });

  it("keeps remove and mention buttons separate from dragging", async () => {
    const cards = await render("imageTask");
    for (const selector of ["[data-canvas-reference-remove]", "[data-canvas-reference-mention]"]) {
      const button = cards[0].querySelector<HTMLButtonElement>(selector)!;
      pointer(button, "pointerdown");
      act(() => button.click());
    }
    expect(remove).toHaveBeenCalledWith("task", "a");
    expect(mention).toHaveBeenCalledWith("task", "图片1");
    expect(reorder).not.toHaveBeenCalled();
  });
});
