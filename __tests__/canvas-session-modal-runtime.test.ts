import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasSessionExpiredModal } from "@/components/canvas/CanvasSessionExpiredModal";

describe("canvas session expired modal runtime", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("focuses the refresh action and keeps Tab navigation inside the modal", () => {
    act(() => root.render(React.createElement(CanvasSessionExpiredModal, { onRefresh: vi.fn() })));

    const refresh = container.querySelector<HTMLButtonElement>("button");
    expect(refresh).not.toBeNull();
    expect(document.activeElement).toBe(refresh);

    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    refresh?.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(refresh);
  });
});
