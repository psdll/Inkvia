import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ zoom: 2, nodeCount: 174, edgeCount: 453, calls: [] as Array<{ zoom: number; duration: number }>, fits: [] as number[] }));
vi.mock("@xyflow/react", () => ({
  Background: () => null, BackgroundVariant: { Dots: "dots" }, MiniMap: () => null,
  Panel: ({ children }: any) => children,
  useStore: (select: any) => select({ transform: [0, 0, state.zoom] }),
  useReactFlow: () => ({ getZoom: () => state.zoom, getViewport: () => ({ x: 0, y: 0, zoom: state.zoom }),
    getNodes: () => Array(state.nodeCount), getEdges: () => Array(state.edgeCount),
    fitView: ({ duration }: { duration: number }) => { state.fits.push(duration); return Promise.resolve(true); },
    zoomTo: (zoom: number, { duration }: { duration: number }) => {
      state.calls.push({ zoom, duration });
      if (!duration) state.zoom = zoom;
      return Promise.resolve(true);
    },
  }),
}));
vi.mock("@/components/canvas/CanvasViewportRecovery", () => ({ CanvasViewportRecovery: () => null }));
import { CanvasViewportChrome } from "@/components/canvas/CanvasViewportChrome";

afterEach(() => vi.unstubAllGlobals());
describe("rapid viewport zoom controls", () => {
  it.each([[174, 453, 0], [20, 200, 0], [20, 30, 300]])("chooses viewport animation based on %s nodes and %s edges", async (nodes, edges, duration) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.nodeCount = nodes; state.edgeCount = edges; state.zoom = 2; state.calls = []; state.fits = [];
    const host = document.createElement("div"), root = createRoot(host);
    document.body.append(host);
    try {
      act(() => root.render(React.createElement(CanvasViewportChrome)));
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="打开缩放菜单"]')!.click());
      await act(async () => host.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
      expect(state.calls).toEqual([{ zoom: .5, duration }]);
      await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="适配画布内容"]')!.click());
      expect(state.fits).toEqual([duration]);
      // Percent entry follows the same density policy (200ms for a small board).
      const input = host.querySelector<HTMLInputElement>('input')!;
      act(() => input.focus());
      await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      expect(state.calls.at(-1)?.duration).toBe(duration ? 200 : 0);
    } finally { act(() => root.unmount()); host.remove(); }
  });

  it("applies both clicks before a React rerender, and clamps repeated steps at the limits", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.zoom = 2; state.calls = [];
    const host = document.createElement("div"), root = createRoot(host);
    try {
      act(() => root.render(React.createElement(CanvasViewportChrome)));
      const plus = host.querySelector<HTMLButtonElement>('[aria-label="放大画布"]')!;
      const minus = host.querySelector<HTMLButtonElement>('[aria-label="缩小画布"]')!;
      await act(async () => { plus.click(); plus.click(); });
      expect(state.zoom).toBeCloseTo(2.88);
      expect(state.calls.map(call => call.duration)).toEqual([0, 0]);
      await act(async () => { for (let i = 0; i < 30; i++) plus.click(); });
      expect(state.zoom).toBe(8);
      await act(async () => { for (let i = 0; i < 60; i++) minus.click(); });
      expect(state.zoom).toBe(.1);
    } finally { act(() => root.unmount()); }
  });
});
