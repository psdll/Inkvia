import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import type { InternalNode, Node } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCanvasViewportContent } from "@/lib/canvas/viewport-content";

type ViewState = Parameters<typeof getCanvasViewportContent>[0];
const mocks = vi.hoisted(() => ({
  state: {} as ViewState,
  fitView: vi.fn(),
  getViewport: vi.fn(),
  getZoom: vi.fn(),
  zoomTo: vi.fn(),
  getNodes: () => [...mocks.state.nodeLookup.values()],
  getEdges: () => [],
}));
vi.mock("@xyflow/react", () => ({
  useStore: (select: (state: ViewState) => unknown) => select(mocks.state),
  useReactFlow: () => mocks,
  Background: () => null,
  BackgroundVariant: { Dots: "dots" },
  MiniMap: () => null,
  Panel: ({ position: _position, ...props }: React.HTMLAttributes<HTMLDivElement> & { position: string }) => React.createElement("div", props),
}));
import { CanvasViewportChrome } from "@/components/canvas/CanvasViewportChrome";

function node(x: number, y: number, overrides: Partial<Node> = {}): InternalNode {
  const source: Node = { id: "node", position: { x, y }, data: {}, measured: { width: 100, height: 80 }, ...overrides };
  return { ...source, measured: source.measured ?? {}, internals: { positionAbsolute: { x, y }, z: 0, userNode: source } };
}
function view(nodes: InternalNode[], overrides: Partial<ViewState> = {}): ViewState {
  return { width: 1000, height: 600, transform: [0, 0, 1], nodeLookup: new Map(nodes.map(value => [value.id, value])), ...overrides };
}

describe("canvas viewport node visibility", () => {
  it.each([
    [-99, 100], [999, 100], [100, -79], [100, 599],
  ])("keeps a node visible with even a small overlap at %s,%s", (x, y) => {
    expect(getCanvasViewportContent(view([node(x, y)]))).toBe("visible");
  });
  it.each([[-100, 100], [1000, 100], [100, -80], [100, 600]])("detects nodes entirely beyond the edge at %s,%s", (x, y) => {
    expect(getCanvasViewportContent(view([node(x, y)]))).toBe("outside");
  });
  it("accounts for pan, zoom, and absolute positions of grouped nodes", () => {
    const child = node(2100, 1200, { parentId: "group", position: { x: 10, y: 10 } });
    expect(getCanvasViewportContent(view([child]))).toBe("outside");
    expect(getCanvasViewportContent(view([child], { transform: [-1000, -500, 0.5] }))).toBe("visible");
  });
  it("counts a large node enclosing the entire viewport", () => {
    expect(getCanvasViewportContent(view([node(-100, -100, { measured: { width: 2000, height: 1000 } })]))).toBe("visible");
  });
  it("uses initial dimensions before an offscreen node mounts", () => {
    const unmounted = node(2000, 0, { measured: {}, initialWidth: 350, initialHeight: 600 });
    expect(getCanvasViewportContent(view([unmounted]))).toBe("outside");
    expect(getCanvasViewportContent(view([unmounted], { transform: [-1900, 0, 1] }))).toBe("visible");
  });
  it("ignores hidden and dimensionless nodes and an uninitialized viewport", () => {
    expect(getCanvasViewportContent(view([]))).toBe("empty");
    expect(getCanvasViewportContent(view([node(2000, 0, { hidden: true })]))).toBe("empty");
    expect(getCanvasViewportContent(view([node(0, 0, { measured: {} })]))).toBe("empty");
    expect(getCanvasViewportContent(view([node(2000, 0)], { width: 0 }))).toBe("empty");
  });
});

describe("canvas viewport recovery interaction", () => {
  let host: HTMLDivElement, root: Root;
  const commit = vi.fn();
  const bubble = vi.fn();
  const hint = () => host.querySelector<HTMLElement>("[data-canvas-viewport-recovery]");
  const mount = (props: Partial<React.ComponentProps<typeof CanvasViewportChrome>> = {}) => act(() => root.render(
    React.createElement("div", { onClick: bubble, onPointerDown: bubble, onWheel: bubble },
      React.createElement(CanvasViewportChrome, { onViewportCommit: commit, ...props })),
  ));
  const advance = (ms = 300) => act(() => vi.advanceTimersByTime(ms));
  beforeEach(() => {
    vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
    mocks.state = view([node(2000, 0)]);
    mocks.fitView.mockResolvedValue(true);
    mocks.getViewport.mockReturnValue({ x: 150, y: 90, zoom: 0.6 });
    mocks.getZoom.mockImplementation(() => mocks.state.transform[2]);
    mocks.zoomTo.mockResolvedValue(true);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("shows after a short empty-view delay and avoids flashing during a quick pan", () => {
    mount(); advance(299); expect(hint()).toBeNull(); advance(1);
    expect(hint()?.textContent).toContain("当前视窗没有节点");
    mocks.state = view([node(100, 100)]); mount(); expect(hint()).toBeNull();
    mocks.state = view([node(2000, 0)]); mount(); advance(100);
    mocks.state = view([node(100, 100)]); mount(); advance(300); expect(hint()).toBeNull();
  });
  it("does not let a pending zoom frame replace selected text when editing begins", () => {
    let selectedValue = '';
    function FocusOnZoomFrame({ frame }: { frame: number }) {
      React.useLayoutEffect(() => {
        if (frame !== 1) return;
        const input = host.querySelector<HTMLInputElement>('[aria-label="画布缩放百分比"]')!;
        selectedValue = input.value;
        input.focus();
        input.select();
      }, [frame]);
      return React.createElement(CanvasViewportChrome, { onViewportCommit: commit });
    }
    const renderFrame = (frame: number, zoom: number) => act(() => {
      mocks.state = { ...mocks.state, transform: [0, 0, zoom] };
      root.render(React.createElement(FocusOnZoomFrame, { frame }));
    });
    renderFrame(0, 0.1);
    renderFrame(1, 0.2);
    const input = host.querySelector<HTMLInputElement>('[aria-label="画布缩放百分比"]')!;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe(selectedValue);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(selectedValue.length);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '23');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    renderFrame(2, 0.14);
    expect(input.value).toBe('23');
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(mocks.zoomTo).toHaveBeenLastCalledWith(0.23, { duration: 200 });
  });
  it("keeps a dismissed hint closed until nodes reenter then leave the viewport", () => {
    mount(); advance();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="关闭返回节点提示"]')!.click());
    expect(hint()).toBeNull();
    mocks.state = view([node(3000, 0)]); mount(); advance(1000); expect(hint()).toBeNull();
    mocks.state = view([node(10, 10)]); mount();
    mocks.state = view([node(2000, 0)]); mount(); advance(); expect(hint()).not.toBeNull();
    expect(bubble).not.toHaveBeenCalled();
  });
  it("returns smoothly and commits the actual viewport only after the move finishes", async () => {
    let finish!: () => void;
    mocks.fitView.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    mount(); advance();
    act(() => hint()!.querySelector<HTMLButtonElement>("button")!.click());
    expect(mocks.fitView).toHaveBeenCalledWith({ padding: 0.12, duration: 300 });
    expect(commit).not.toHaveBeenCalled(); expect(bubble).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(commit).toHaveBeenCalledWith({ x: 150, y: 90, zoom: 0.6 });
    mocks.state = view([node(10, 10)]); mount(); expect(hint()).toBeNull();
  });
  it("hides on an empty canvas or after deleting the last node", () => {
    mount(); advance(); expect(hint()).not.toBeNull();
    mocks.state = view([]); mount(); advance(); expect(hint()).toBeNull();
  });
  it("temporarily yields to open menus and stays accessible above an action message", () => {
    mount({ hideRecoveryHint: true }); advance(); expect(hint()).toBeNull();
    mount({ raiseRecoveryHint: true }); expect(hint()?.className).toContain("!bottom-[124px]");
    mount(); expect(hint()?.className).toContain("!bottom-[72px]");
    act(() => {
      hint()!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      hint()!.dispatchEvent(new Event("wheel", { bubbles: true }));
    });
    expect(bubble).not.toHaveBeenCalled();
  });
});
