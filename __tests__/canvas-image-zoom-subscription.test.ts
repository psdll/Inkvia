// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { expect, it, vi } from "vitest";

const flow = vi.hoisted(() => ({ zoom: .5, subscribers: new Set<() => void>() }));
vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return { useNodeId: () => "image", useStore: (select: any) => React.useSyncExternalStore(
    callback => { flow.subscribers.add(callback); return () => { flow.subscribers.delete(callback); }; },
    () => select({ transform: [0, 0, flow.zoom], nodeLookup: new Map([["image", { measured: { width: 350 }, selected: false }]]) }),
  ) };
});
import { CanvasMediaImage } from "@/components/canvas/CanvasMediaImage";

it("does not rerender image content on zoom frames within the same resolution tier", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), rendered = vi.fn();
  try {
    await act(async () => root.render(React.createElement(React.Profiler, { id: "image", onRender: rendered },
      React.createElement(CanvasMediaImage, { src: "blob:already-visible", alt: "preview" }))));
    rendered.mockClear();
    for (const zoom of [.51, .52, .53, .54, .55, .56]) {
      await act(async () => { flow.zoom = zoom; flow.subscribers.forEach(notify => notify()); });
    }
    expect(rendered).not.toHaveBeenCalled();
    expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:already-visible");
    await act(async () => { flow.zoom = 1; flow.subscribers.forEach(notify => notify()); });
    expect(rendered).toHaveBeenCalled();
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
