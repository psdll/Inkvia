import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasEdge, type CanvasNode } from "@/lib/canvas/document";
import { canvasNodeWorldPosition } from "@/lib/canvas/spatial-index";
import { stackSelection } from "@/lib/canvas/graph";
import { CANVAS_WHEEL_ZOOM_STEP } from "@/lib/canvas/wheel-zoom";
import { XYPanZoom, PanOnScrollMode, type PanZoomInstance } from "@xyflow/system";
import type { CanvasFlowNode } from "@/components/canvas/CanvasNodeCard";

const state = vi.hoisted(() => ({ props: null as any, editor: null as any, rect: null as any, nativePanEnabled: false, pan: null as PanZoomInstance | null, nativeSelection: new Map<string, boolean>(), transform: [0, 0, 1], zoomTo: vi.fn(async () => {}), fitView: vi.fn(async () => {}), setViewport: vi.fn(async (_viewport: any, _options: any) => {}), held: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/canvas/media-upload-client", () => ({ uploadCanvasMedia: state.upload }));
vi.mock("@/lib/canvas/local-upload-size", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/canvas/local-upload-size")>(),
  getCanvasLocalUploadNodeSize: async () => ({ width: 200, height: 300 }),
}));
vi.mock("next/dynamic", () => ({ default: () => (props: any) => props.items && props.onClose
  ? React.createElement("button", { "data-test-preview-close": true, onClick: props.onClose }, "关闭预览") : null }));
vi.mock("@/components/canvas/use-canvas-models", () => ({ useCanvasModels: () => null, resolveCanvasModelId: () => "" }));
vi.mock("@/lib/client/inflight-json", () => ({ fetchJsonOnce: async () => ({ ok: true, json: { success: true, items: [] } }) }));
vi.mock("@/components/canvas/CanvasViewportChrome", () => ({ CanvasViewportChrome: () => null }));
vi.mock("@/components/canvas/CanvasAudioPlayback", () => ({ CanvasAudioPlaybackProvider: ({ children }: any) => children }));
vi.mock("@/components/canvas/CanvasNodeCard", async () => {
  const React = await import("react");
  return { CanvasNodeCard: () => null, CanvasNodeEditorContext: React.createContext(null) };
});
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  const React = await import("react");
  const { CanvasNodeEditorContext } = await import('@/components/canvas/CanvasNodeCard');
  const store = { getState: () => ({ width: 1920, height: 855, transform: state.transform, userSelectionRect: state.rect, nodes: state.props?.nodes ?? [], nodeLookup: new Map() }), setState: vi.fn((patch: any) => {
    if ("userSelectionRect" in patch) state.rect = patch.userSelectionRect;
  }), subscribe: () => () => {} };
  const flow = {
    get viewportInitialized() { return !!state.pan; },
    getViewport: () => state.pan?.getViewport() ?? ({ x: 0, y: 0, zoom: 1 }), getZoom: () => state.pan?.getViewport().zoom ?? 1,
    zoomTo: state.zoomTo, fitView: state.fitView,
    setViewport: (viewport: any, options: any) => state.pan ? state.pan.setViewport(viewport, options) : state.setViewport(viewport, options),
    screenToFlowPosition: (point: any) => point, flowToScreenPosition: (point: any) => point,
    getNodes: () => state.props.nodes, getNode: (id: string) => state.props.nodes.find((node: any) => node.id === id),
    getInternalNode: (id: string) => {
      const node = state.props?.nodes.find((candidate: any) => candidate.id === id);
      return node && { ...node, selected: state.nativeSelection.get(id) ?? node.selected };
    },
    getNodesBounds: ([node]: any[]) => ({ ...node.position, width: node.width ?? 200, height: node.height ?? 300 }),
  };
  return {
    ...actual, useReactFlow: () => flow, useStoreApi: () => store,
    useStore: (selector: any) => selector({ transform: state.transform }),
    ReactFlowProvider: ({ children }: any) => children,
    ReactFlow: (props: any) => {
      actual.useKeyPress(props.panActivationKeyCode);
      state.props = props; state.editor = React.useContext(CanvasNodeEditorContext);
      const surface = React.useRef<HTMLDivElement>(null);
      // Match ZoomPane's effect-driven native filter update. Reading current
      // props in a fake mouse handler would hide a lost first mousedown.
      React.useEffect(() => {
        if (!state.nativePanEnabled || !surface.current) return;
        Object.defineProperties(surface.current, { clientWidth: { value: 1000 }, clientHeight: { value: 800 } });
        const pan = XYPanZoom({ domNode: surface.current, minZoom: .1, maxZoom: 8,
          viewport: { x: 0, y: 0, zoom: state.transform[2] },
          translateExtent: [[-Infinity, -Infinity], [Infinity, Infinity]], onDraggingChange: () => {},
          onPanZoomStart: (event, viewport) => state.props.onMoveStart(event, viewport),
          onPanZoom: (event, viewport) => state.props.onMove(event, viewport),
          onPanZoomEnd: (event, viewport) => state.props.onMoveEnd(event, viewport) });
        state.pan = pan;
        return () => { pan.destroy(); state.pan = null; };
      }, []);
      React.useEffect(() => {
        state.pan?.update({ noWheelClassName: "nowheel", noPanClassName: "nopan", preventScrolling: true,
          panOnScroll: true, panOnDrag: props.panOnDrag, selectionOnDrag: props.selectionOnDrag,
          panOnScrollMode: PanOnScrollMode.Free, panOnScrollSpeed: 1, userSelectionActive: false,
          zoomOnPinch: true, zoomOnScroll: false, zoomOnDoubleClick: false, zoomActivationKeyPressed: false,
          lib: "react", onTransformChange: () => {}, connectionInProgress: false, paneClickDistance: 5 });
      }, [props.panOnDrag, props.selectionOnDrag]);
      return React.createElement("div", { ref: surface, "data-test-flow": true, className: `react-flow__renderer ${props.className}` },
        React.createElement("div", { className: "react-flow__nodes" }),
        React.createElement("div", { className: "react-flow__edges" }), props.children);
    },
    Panel: ({ children }: any) => React.createElement("div", null, children),
    ViewportPortal: ({ children }: any) => children,
  };
});

import SmartCanvasBoard from "@/components/canvas/SmartCanvasBoard";
import * as generationClient from "@/components/canvas/run-node";

describe("canvas keyboard event integration", () => {
  let container: HTMLDivElement;
  let root: Root;
  let board: HTMLDivElement;
  const pendingTimers = new Set<number>();
  const image = (id: string): CanvasNode => ({ id, type: "image", position: { x: 0, y: 0 }, width: 200, height: 300, data: { kind: "image", url: `/uploads/canvas_imports/1/${id}.png` } });

  beforeEach(() => {
    useTestRealmMouseEvents();
    pendingTimers.clear();
    const schedule = window.setTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const id = schedule(handler, delay, ...args); pendingTimers.add(id); return id;
    }) as typeof window.setTimeout);
    window.localStorage.setItem('canvas_snap_to_grid_v1_guest', 'false');
    state.rect = null;
    state.nativePanEnabled = false;
    state.transform = [0, 0, 1];
    state.nativeSelection.clear();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => root.unmount());
    for (const timer of pendingTimers) window.clearTimeout(timer);
    container.remove(); window.localStorage.removeItem('canvas_snap_to_grid_v1_guest');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(nodes: CanvasNode[], onChange?: (document: any) => void, edges: CanvasEdge[] = [], observer: Pick<React.ComponentProps<typeof SmartCanvasBoard>, "readOnly" | "onViewportCommit"> = {}) {
    await act(async () => root.render(React.createElement(SmartCanvasBoard, {
      canvasId: 1, editorSessionId: "test", preferenceOwnerId: "guest", initial: { ...createEmptyCanvasDocumentV2(), nodes, edges },
      onBeforeServerRun: async () => "test", onUndoMediaRefsChange: state.held, onChange, ...observer,
    })));
    board = container.querySelector<HTMLDivElement>('[tabindex="-1"]')!;
    board.focus();
  }

  function press(key: string, modifiers: KeyboardEventInit = {}, target: HTMLElement = board) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
    act(() => { target.dispatchEvent(event); });
    return event;
  }

  function select(ids: string[]) {
    act(() => state.props.onNodesChange(state.props.nodes.map((node: CanvasNode) => ({ type: "select", id: node.id, selected: ids.includes(node.id) }))));
  }
  it("consumes modified wheel and repeated zoom keys over canvas controls", async () => {
    await mount([]);
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 });
    board.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    const button = board.querySelector<HTMLButtonElement>("button")!;
    expect(press("+", { ctrlKey: true, repeat: true }, button).defaultPrevented).toBe(true);
    expect(state.zoomTo).toHaveBeenCalledWith(1.2, { duration: 200 });
    expect(board.dataset.canvasGroupAccess).toBe("true");
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    expect(board.dataset.canvasGroupAccess).toBe("false");
  });

  it("keeps grouped members directly selectable without a modifier", async () => {
    await mount([
      { id: "g", type: "group", position: { x: 0, y: 0 }, width: 600, height: 500, data: { kind: "group", title: "组", collapsed: false } },
      { id: "child", type: "image", parentId: "g", position: { x: 20, y: 20 }, data: { kind: "image", url: "/a.png" } },
    ]);
    select(["g"]);
    expect(state.props.nodes.find((node: CanvasNode) => node.id === "child").className).toBeUndefined();
    select(["child"]);
    await act(async () => state.props.onNodeClick({}, state.props.nodes.find((node: CanvasNode) => node.id === "child")));
    expect(state.props.nodes.filter((node: any) => node.selected).map((node: any) => node.id)).toEqual(["child"]);
  });
  function useTestRealmMouseEvents() {
    // populateGlobal exposes a Window proxy that this jsdom version rejects as UIEvent.view.
    const NativeMouseEvent = MouseEvent;
    vi.stubGlobal("MouseEvent", class extends NativeMouseEvent {
      constructor(type: string, options: MouseEventInit = {}) {
        super(type, { ...options, view: null });
        Object.defineProperty(this, "view", { value: window });
      }
    });
  }

  it("keeps workflow selection live while its panel is open", async () => {
    const onOpenWorkflow = vi.fn();
    await act(async () => root.render(React.createElement(SmartCanvasBoard, {
      canvasId: 1, editorSessionId: "test", preferenceOwnerId: "guest",
      initial: { ...createEmptyCanvasDocumentV2(), nodes: [image("a"), image("b")] },
      onBeforeServerRun: async () => "test", workflowOpen: true, onOpenWorkflow,
    })));
    expect(onOpenWorkflow).toHaveBeenLastCalledWith([]);
    select(["a"]);
    expect(onOpenWorkflow).toHaveBeenLastCalledWith(["a"]);
    select(["a", "b"]);
    expect(onOpenWorkflow).toHaveBeenLastCalledWith(["a", "b"]);
    select([]);
    expect(onOpenWorkflow).toHaveBeenLastCalledWith([]);
  });

  it.each((["image", "imageTask", "videoTask"] as const).flatMap((kind) => (
    (["alt", "ctrl-alt", "ctrl-d"] as const).map((action) => ({ kind, action }))
  )))("preserves incoming connections for a selected single $kind node with $action", async ({ kind, action }) => {
    const settings = { model: "", prompt: "", aspectRatio: "1:1", resolution: "1K", quality: "", count: 1 };
    const target: CanvasNode = { id: "target", type: kind, position: { x: 400, y: 200 }, data: kind === "imageTask"
      ? { kind, task: { references: [], settings, batches: [{ id: "batch", createdAt: 1, settings, outputs: [{ id: "output", status: "success", url: "/result.png" }] }] } }
      : kind === "videoTask"
        ? { kind, model: "", prompt: "", mediaPaths: [], status: "success", outputUrl: "/result.mp4" }
        : { kind, url: "/result.png", name: "结果" } };
    await mount([image("a"), image("b"), target], undefined, [
      { id: "at", source: "a", target: target.id },
      { id: "bt", source: "b", target: target.id },
    ]);
    select([target.id]);
    if (action === "ctrl-d") press("d", { ctrlKey: true });
    else act(() => state.props.onNodeDragStart({ altKey: true, ctrlKey: action === "ctrl-alt", shiftKey: false }, target));
    const copy = state.props.nodes.find((node: CanvasNode) => !["a", "b", target.id].includes(node.id));
    if (action !== "ctrl-d") act(() => state.props.onNodesChange([{ type: "position", id: target.id, position: { x: 700, y: 300 }, dragging: true }]));
    expect(state.props.edges.filter((edge: CanvasEdge) => edge.target === copy.id).map((edge: CanvasEdge) => edge.source)).toEqual(["a", "b"]);
    if (action !== "ctrl-d") act(() => state.props.onNodeDragStop({}, target));
    expect(state.props.edges).toHaveLength(4);
    expect(state.props.nodes.find((node: CanvasNode) => node.id === target.id).position).toEqual(target.position);
    expect(state.props.nodes.find((node: CanvasNode) => node.id === copy.id).position).toEqual(action === "ctrl-d" ? { x: 432, y: 232 } : { x: 700, y: 300 });
  });

  it("requires a selected node and duplicates all its incoming connections with Ctrl+D", async () => {
    const nodes = [image("a"), image("b"), image("c"), image("d")];
    const edges = [
      { id: "ab", source: "a", target: "b", sourceHandle: "source", targetHandle: "target" },
      { id: "db", source: "d", target: "b" },
      { id: "bc", source: "b", target: "c" },
    ];
    await mount(nodes, undefined, edges);
    press("d", { ctrlKey: true });
    expect(state.props.nodes).toHaveLength(4);
    expect(state.props.edges).toHaveLength(3);

    select(["b"]);
    press("d", { ctrlKey: true });
    const copy = state.props.nodes.find((node: CanvasNode) => !nodes.some((original) => original.id === node.id));
    expect(state.props.nodes).toHaveLength(5);
    expect(copy.selected).toBe(true);
    expect(state.props.nodes.find((node: CanvasNode) => node.id === "b").position).toEqual(nodes[1].position);
    expect(state.props.edges).toHaveLength(5);
    expect(state.props.edges.filter((edge: CanvasEdge) => edge.target === copy.id)).toEqual([
      expect.objectContaining({ source: "a", target: copy.id, sourceHandle: "source", targetHandle: "target" }),
      expect.objectContaining({ source: "d", target: copy.id }),
    ]);
    expect(state.props.edges.some((edge: CanvasEdge) => edge.source === copy.id)).toBe(false);
    expect(state.props.edges.slice(0, 3)).toEqual(expect.arrayContaining(edges.map((edge) => expect.objectContaining(edge))));

    press("z", { ctrlKey: true });
    expect(state.props.nodes.map((node: CanvasNode) => node.id)).toEqual(nodes.map((node) => node.id));
    expect(state.props.edges.map((edge: CanvasEdge) => edge.id)).toEqual(edges.map((edge) => edge.id));
  });

  it.each([false, true])("duplicates the right-clicked selection and its incoming edges (multi-selection = %s)", async (multiSelection) => {
    const nodes = [image("a"), image("b"), image("c"), image("d")];
    const edges = [
      { id: "ab", source: "a", target: "b", sourceHandle: "source", targetHandle: "target" },
      { id: "db", source: "d", target: "b" },
      { id: "bc", source: "b", target: "c" },
    ];
    await mount(nodes, undefined, edges);
    select(multiSelection ? ["b", "c"] : ["a"]);
    act(() => state.props.onNodeContextMenu(new MouseEvent("contextmenu", { clientX: 100, clientY: 100 }), state.props.nodes.find((node: CanvasNode) => node.id === "b")));
    const copyButton = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-canvas-context-menu] button")).find(button => button.dataset.canvasNodeAction === "duplicate");
    expect(copyButton).toBeDefined();
    act(() => copyButton!.click());
    const copy = state.props.nodes.find((node: CanvasNode) => !nodes.some(original => original.id === node.id));
    expect(state.props.nodes).toHaveLength(multiSelection ? 6 : 5);
    expect(copy.data.url).toBe("/uploads/canvas_imports/1/b.png");
    expect(copy.position).toEqual(multiSelection ? { x: 32, y: 32 } : { x: 350, y: 0 });
    expect(copy.selected).toBe(true);
    expect(state.props.edges).toHaveLength(multiSelection ? 6 : 5);
    expect(state.props.edges.filter((edge: CanvasEdge) => edge.target === copy.id)).toEqual([
      expect.objectContaining({ source: "a", target: copy.id, sourceHandle: "source", targetHandle: "target" }),
      expect.objectContaining({ source: "d", target: copy.id }),
    ]);
    const outgoing = state.props.edges.filter((edge: CanvasEdge) => edge.source === copy.id);
    if (multiSelection) {
      const copiedC = state.props.nodes.find((node: CanvasNode) => node.id !== "c" && node.data.kind === "image" && node.data.url === "/uploads/canvas_imports/1/c.png");
      expect(outgoing).toEqual([expect.objectContaining({ source: copy.id, target: copiedC.id })]);
    } else expect(outgoing).toHaveLength(0);
    expect(container.querySelector("[data-canvas-context-menu]")).toBeNull();
    press("z", { ctrlKey: true });
    expect(state.props.nodes.map((node: CanvasNode) => node.id)).toEqual(nodes.map(node => node.id));
    expect(state.props.edges.map((edge: CanvasEdge) => edge.id)).toEqual(edges.map(edge => edge.id));
  });

  it("places repeated context-menu copies in free space when the right side is occupied", async () => {
    const nodes = [image("source"), { ...image("obstacle"), position: { x: 350, y: 0 }, width: 800 }];
    await mount(nodes);
    for (let index = 0; index < 3; index += 1) {
      act(() => state.props.onNodeContextMenu(new MouseEvent("contextmenu", { clientX: 100, clientY: 100 }), state.props.nodes.find((node: CanvasNode) => node.id === "source")));
      const button = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-canvas-context-menu] button")).find(button => button.dataset.canvasNodeAction === "duplicate")!;
      const before: CanvasNode[] = [...state.props.nodes];
      act(() => button.click());
      const copy = state.props.nodes.find((node: CanvasNode) => !before.some(original => original.id === node.id));
      for (const occupied of before) {
        expect(copy.position.x >= occupied.position.x + occupied.width!
          || copy.position.x + copy.width <= occupied.position.x
          || copy.position.y >= occupied.position.y + occupied.height!
          || copy.position.y + copy.height <= occupied.position.y).toBe(true);
      }
      if (index === 0) expect(copy.position).toEqual({ x: 0, y: 450 });
      expect(state.props.nodes.filter((node: CanvasNode) => nodes.some(original => original.id === node.id)).map((node: CanvasNode) => node.position)).toEqual(nodes.map(node => node.position));
    }
  });

  it("keeps a copied group member in its group without overlapping siblings", async () => {
    const group: CanvasNode = { id: "group", type: "group", position: { x: 1000, y: 600 }, width: 900, height: 700, data: { kind: "group", title: "group", collapsed: false } };
    await mount([group, { ...image("source"), parentId: "group", position: { x: 80, y: 100 } },
      { ...image("sibling"), parentId: "group", position: { x: 430, y: 100 } }]);
    const before: CanvasNode[] = [...state.props.nodes];
    const beforeById = new Map(before.map(node => [node.id, node]));
    act(() => state.props.onNodeContextMenu(new MouseEvent("contextmenu", { clientX: 100, clientY: 100 }), state.props.nodes.find((node: CanvasNode) => node.id === "source")));
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-canvas-context-menu] button")).find(button => button.dataset.canvasNodeAction === "duplicate")!;
    act(() => button.click());
    const after: CanvasNode[] = state.props.nodes;
    const byId = new Map(after.map(node => [node.id, node]));
    const copy = after.find(node => !beforeById.has(node.id))!;
    expect(copy.parentId).toBe("group");
    const position = canvasNodeWorldPosition(copy, byId);
    for (const id of ["source", "sibling"]) {
      const node = byId.get(id)!;
      const occupied = canvasNodeWorldPosition(node, byId);
      expect(occupied).toEqual(canvasNodeWorldPosition(beforeById.get(id)!, beforeById));
      expect(position.x >= occupied.x + node.width! || position.x + copy.width! <= occupied.x
        || position.y >= occupied.y + node.height! || position.y + copy.height! <= occupied.y).toBe(true);
    }
    expect(copy.position.x + copy.width!).toBeLessThanOrEqual(byId.get("group")!.width!);
    expect(copy.position.y + copy.height!).toBeLessThanOrEqual(byId.get("group")!.height!);
  });

  it.each([false, true])("copies a single node without incoming connections (has outgoing connection = %s)", async (hasOutgoing) => {
    await mount([image("a"), image("b")], undefined, hasOutgoing ? [{ id: "ab", source: "a", target: "b" }] : []);
    select(["a"]);
    press("d", { ctrlKey: true });
    expect(state.props.nodes).toHaveLength(3);
    expect(state.props.edges).toHaveLength(hasOutgoing ? 1 : 0);
    expect(state.props.nodes.find((node: CanvasNode) => node.id === "a").position).toEqual({ x: 0, y: 0 });
  });

  it("keeps multi-node Ctrl+D limited to the selected nodes and their internal connections", async () => {
    await mount([image("a"), image("b"), image("c"), image("d")], undefined, [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
      { id: "cd", source: "c", target: "d" },
    ]);
    select(["b", "c"]);
    press("d", { ctrlKey: true });
    const copies = state.props.nodes.filter((node: any) => node.selected);
    expect(state.props.nodes).toHaveLength(6);
    expect(copies).toHaveLength(2);
    expect(state.props.edges).toHaveLength(4);
    expect(state.props.edges[3]).toMatchObject({ source: copies[0].id, target: copies[1].id });
  });

  it("keeps a selected group's Ctrl+D limited to its descendants and internal connections", async () => {
    const group: CanvasNode = { id: "group", type: "group", position: { x: 0, y: 0 }, data: { kind: "group", title: "group", collapsed: false } };
    await mount([image("a"), group, { ...image("b"), parentId: group.id }, { ...image("c"), parentId: group.id }], undefined, [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
    ]);
    select([group.id]);
    press("d", { ctrlKey: true });
    const copyGroup = state.props.nodes.find((node: CanvasNode) => node.type === "group" && node.id !== group.id);
    const children = state.props.nodes.filter((node: CanvasNode) => node.parentId === copyGroup.id);
    expect(state.props.nodes).toHaveLength(7);
    expect(state.props.edges).toHaveLength(3);
    expect(state.props.edges[2]).toMatchObject({ source: children[0].id, target: children[1].id });
  });

  it.each(["image", "imageTask", "videoTask"] as const)("downloads the duplicated %s using its copy name", async (kind) => {
    const settings = { model: "", prompt: "", aspectRatio: "1:1", resolution: "1K", quality: "", count: 1 };
    const source: CanvasNode = { id: "a", type: kind, position: { x: 0, y: 0 }, data: kind === "imageTask"
      ? { kind, task: { references: [], settings, batches: [{ id: "batch", createdAt: 1, settings, outputs: [{ id: "output", status: "success", url: "/uploads/source.png" }] }] } }
      : kind === "videoTask"
        ? { kind, model: "", prompt: "", mediaPaths: [], status: "success", outputUrl: "/uploads/source.mp4" }
        : { kind, url: "/uploads/source.png", name: "10086" } };
    await mount([source]);
    const originalData = structuredClone(state.props.nodes.find((node: CanvasNode) => node.id === source.id).data);
    select([source.id]);
    press("d", { ctrlKey: true });
    const copy = state.props.nodes.find((node: CanvasNode) => node.id !== source.id);
    const BrowserURL = URL;
    vi.stubGlobal("URL", class extends BrowserURL {
      static createObjectURL() { return "blob:download"; }
      static revokeObjectURL() {}
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) })));
    const downloaded: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloaded.push(this.download); });
    act(() => state.props.onNodeContextMenu(new MouseEvent("contextmenu", { clientX: 100, clientY: 100 }), copy));
    await act(async () => { state.editor.downloadMedia(copy.id); });

    expect(downloaded).toEqual([kind === "imageTask" ? "图片节点1 - 副本.png" : kind === "videoTask" ? "视频节点1 - 副本.mp4" : "10086 - 副本.png"]);
    expect(state.props.nodes.find((node: CanvasNode) => node.id === "a").data).toEqual(originalData);
  });

  async function startUpload() {
    const BrowserURL = URL;
    vi.stubGlobal("URL", class extends BrowserURL {
      static createObjectURL() { return "blob:pending-runtime"; }
      static revokeObjectURL() {}
    });
    let finish!: (value: any) => void;
    state.upload.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["image"], "copy.png", { type: "image/png" })] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(state.upload).toHaveBeenCalledTimes(1);
    const original = state.props.nodes.find((node: CanvasNode) => node.data.kind === "image" && node.data.url.startsWith("blob:"));
    expect(original).toBeDefined();
    board.focus();
    return { original, finish: () => finish({ success: true, kind: "image", url: "/uploads/canvas_imports/1/copy.png", mediaId: "d31782e3-d0fb-4aa1-9096-a7d16878cd55" }) };
  }

  it("keeps pending copies usable after deleting the original, pasting later and undoing", async () => {
    const saved = vi.fn();
    await mount([], saved);
    const { original, finish } = await startUpload();
    select([original.id]);
    press("c", { ctrlKey: true });
    press("d", { ctrlKey: true });
    select([original.id]);
    press("Delete");
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(saved.mock.lastCall?.[0].nodes).toEqual([]);

    await act(async () => { finish(); });
    expect(state.props.nodes).toHaveLength(1);
    expect(state.props.nodes[0].id).not.toBe(original.id);
    expect(state.props.nodes[0].data.url).toBe("/uploads/canvas_imports/1/copy.png");
    press("v", { ctrlKey: true });
    expect(state.props.nodes).toHaveLength(2);
    expect(JSON.stringify(state.props.nodes)).not.toContain("blob:");
    press("z", { ctrlKey: true });
    press("z", { ctrlKey: true });
    expect(state.props.nodes.some((node: CanvasNode) => node.id === original.id)).toBe(true);
    expect(JSON.stringify(state.props.nodes)).not.toContain("blob:");
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(JSON.stringify(saved.mock.lastCall?.[0])).not.toContain("blob:");
  });

  it("updates the drag snapshot when an upload finishes during Alt-drag duplication", async () => {
    await mount([]);
    const { original, finish } = await startUpload();
    select([original.id]);
    act(() => state.props.onNodeDragStart({ altKey: true, ctrlKey: true, metaKey: false, shiftKey: false }, original, [original]));
    act(() => state.props.onNodesChange([{ type: "position", id: original.id, position: { x: 80, y: 40 }, dragging: true }]));
    await act(async () => { finish(); });
    act(() => state.props.onNodeDragStop({}, { ...original, position: { x: 80, y: 40 } }));
    expect(state.props.nodes).toHaveLength(2);
    expect(JSON.stringify(state.props.nodes)).not.toContain("blob:");
    expect(state.props.nodes.every((node: any) => node.data.mediaId === "d31782e3-d0fb-4aa1-9096-a7d16878cd55")).toBe(true);
  });

  it("flushes final marquee bounds after the native rectangle clears and cancels queued selection on Escape", async () => {
    await mount([image("a"), { ...image("b"), position: { x: 500, y: 0 } }]);
    select(["b"]);
    state.rect = { x: 0, y: 0, width: 0, height: 0, startX: 0, startY: 0 };
    act(() => state.props.onSelectionStart({ ctrlKey: false, metaKey: false, shiftKey: true }));
    state.rect = { ...state.rect, width: 50, height: 50 };
    act(() => state.props.onSelectionChange());
    state.rect = null;
    act(() => state.props.onSelectionEnd({ clientX: 50, clientY: 50 }));
    expect(state.props.nodes.filter((node: any) => node.selected).map((node: any) => node.id)).toEqual(["a", "b"]);

    select(["b"]);
    state.rect = { x: 0, y: 0, width: 0, height: 0, startX: 0, startY: 0 };
    act(() => state.props.onSelectionStart({ ctrlKey: true, metaKey: false, shiftKey: false }));
    state.rect = { ...state.rect, width: 50, height: 50 };
    act(() => state.props.onSelectionChange());
    press("Escape");
    act(() => state.props.onSelectionEnd({ clientX: 50, clientY: 50 }));
    expect(state.props.nodes.filter((node: any) => node.selected).map((node: any) => node.id)).toEqual(["b"]);
  });

  it.each([undefined, "g"])("marquees group members and connects them to a target in parent %s without moving them", async targetParent => {
    const group: CanvasNode = { id: "g", type: "group", position: { x: 0, y: 0 }, width: 1200, height: 900, data: { kind: "group", title: "素材组", collapsed: false } };
    const children = [{ ...image("a"), parentId: "g", position: { x: 100, y: 100 } }, { ...image("b"), parentId: "g", position: { x: 400, y: 100 } }];
    const target: CanvasNode = { id: "target", parentId: targetParent, type: "videoTask", position: { x: 800, y: 100 }, data: { kind: "videoTask", model: "test", prompt: "", mediaPaths: [], status: "idle" } };
    await mount([group, ...children, target]);
    const before = state.props.nodes.map((node: CanvasNode) => ({ id: node.id, parentId: node.parentId, position: node.position }));
    state.rect = { x: 70, y: 70, width: 0, height: 0, startX: 70, startY: 70 };
    act(() => state.props.onSelectionStart({ ctrlKey: false, metaKey: false, shiftKey: false }));
    state.rect = null;
    act(() => state.props.onSelectionEnd({ clientX: 650, clientY: 450 }));
    expect(state.props.nodes.filter((node: any) => node.selected).map((node: CanvasNode) => node.id)).toEqual(["a", "b"]);
    const connector = container.querySelector<HTMLElement>('[data-canvas-multi-selection-connector] [data-canvas-connection-handle-hit-area]')!;
    expect(connector).not.toBeNull();
    const targetElement = document.createElement("div");
    targetElement.dataset.canvasConnectionTargetId = "target";
    const original = Object.getOwnPropertyDescriptor(document, "elementsFromPoint");
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [targetElement] });
    try {
      act(() => connector.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 650, clientY: 250 })));
      act(() => window.dispatchEvent(new MouseEvent("pointerup", { clientX: 850, clientY: 150 })));
      expect(state.props.edges.map((edge: CanvasEdge) => [edge.source, edge.target])).toEqual([["a", "target"], ["b", "target"]]);
      expect(state.props.nodes.map((node: CanvasNode) => ({ id: node.id, parentId: node.parentId, position: node.position }))).toEqual(before);
      press("z", { ctrlKey: true });
      expect(state.props.edges).toHaveLength(0);
    } finally {
      if (original) Object.defineProperty(document, "elementsFromPoint", original);
      else Reflect.deleteProperty(document, "elementsFromPoint");
    }
  });

  it("clears native parent selection when completing a group member marquee", async () => {
    const group: CanvasNode = { id: "g", type: "group", position: { x: 0, y: 0 }, width: 1000, height: 900, data: { kind: "group", title: "素材组", collapsed: false } };
    await mount([group, { ...image("a"), parentId: "g", position: { x: 100, y: 100 } }, { ...image("b"), parentId: "g", position: { x: 400, y: 100 } }]);
    const originalGroup = state.props.nodes.find((node: CanvasNode) => node.id === "g");
    state.rect = { x: 70, y: 70, width: 0, height: 0, startX: 70, startY: 70 };
    act(() => state.props.onSelectionStart({ ctrlKey: false, metaKey: false, shiftKey: false }));
    // React Flow mutates its internal selected flag during its native hit test.
    state.nativeSelection.set("g", true);
    state.rect = null;
    act(() => state.props.onSelectionEnd({ clientX: 650, clientY: 450 }));
    expect(state.props.nodes.filter((node: any) => node.selected).map((node: CanvasNode) => node.id)).toEqual(["a", "b"]);
    expect(state.props.nodes.find((node: CanvasNode) => node.id === "g")).not.toBe(originalGroup);
  });

  it("keeps existing pan/selection behavior and routes canvas zoom keys", async () => {
    await mount([image("a")]);
    expect(state.props.panOnDrag).toEqual([1]);
    expect(state.props.selectionOnDrag).toBe(true);
    press("+", { ctrlKey: true });
    expect(state.zoomTo).toHaveBeenLastCalledWith(1.2, { duration: 200 });
    press("-", { ctrlKey: true });
    expect(state.zoomTo).toHaveBeenLastCalledWith(1 / 1.2, { duration: 200 });
    press("0", { ctrlKey: true });
    expect(state.fitView).toHaveBeenCalled();
  });

  it("switches H/V between panning and node manipulation without changing the graph", async () => {
    await mount([image("a")]);
    select(["a"]);
    expect(press("h").defaultPrevented).toBe(true);
    expect(state.props.panOnDrag).toEqual([0, 1]);
    expect(container.querySelector(".react-flow__nodes")?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector(".react-flow__edges")?.hasAttribute("inert")).toBe(true);
    expect(state.props.nodesDraggable).toBe(true);
    expect(state.props.nodesConnectable).toBe(true);
    expect(state.props.elementsSelectable).toBe(true);
    expect(state.props.selectionKeyCode).toBeNull();
    expect(state.props.selectionOnDrag).toBe(false);
    expect(state.props.nodesFocusable).toBe(true);
    expect(state.props.className).toContain("canvas-hand-tool");
    act(() => state.props.onPaneClick());
    expect(state.props.nodes[0].selected).toBe(true);
    expect(state.props.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(press("v").defaultPrevented).toBe(true);
    expect(state.props.panOnDrag).toEqual([1]);
    expect(state.props.nodesDraggable).toBe(true);
    expect(state.props.nodesConnectable).toBe(true);
    expect(state.props.elementsSelectable).toBe(true);
    expect(container.querySelector(".react-flow__nodes")?.hasAttribute("inert")).toBe(false);
    expect(container.querySelector(".react-flow__edges")?.hasAttribute("inert")).toBe(false);
    expect(state.props.selectionOnDrag).toBe(true);
  });

  it("opens a pane action menu before choosing a node type at the clicked position", async () => {
    await mount([]);
    const open = () => act(() => state.props.onPaneContextMenu(new MouseEvent("contextmenu", { clientX: 240, clientY: 180 })));
    open();
    const menu = () => container.querySelector('[data-canvas-context-menu]')!;
    expect(Array.from(menu().querySelectorAll('button'), (button) => button.textContent)).toEqual([
      "上传", "添加节点", "撤销Ctrl + Z", "重做Ctrl + Shift + Z", "粘贴Ctrl + V",
    ]);
    expect(Array.from(menu().querySelectorAll('button')).slice(2).every((button) => button.disabled)).toBe(true);
    expect(menu().querySelector('[data-canvas-create-kind]')).toBeNull();
    act(() => menu().querySelector<HTMLButtonElement>('[data-canvas-open-create]')!.click());
    expect(menu().firstElementChild?.textContent).toBe("添加节点");
    expect(Array.from(menu().querySelectorAll('button'), (button) => button.textContent)).toEqual([
      "图片", "视频", "音频", "文本", "对比", "上传", "从生成历史选择",
    ]);
    act(() => menu().querySelector<HTMLButtonElement>('[data-canvas-create-kind="llm"]')!.click());
    expect(state.props.nodes).toHaveLength(1);
    expect(state.props.nodes[0].position).toEqual({ x: 240, y: 180 });
    open();
    const action = (name: string) => Array.from(menu().querySelectorAll('button')).find((button) => button.textContent?.startsWith(name))!;
    act(() => action("撤销").click());
    expect(state.props.nodes).toHaveLength(0);
    open();
    expect(action("重做").disabled).toBe(false);
    act(() => action("重做").click());
    expect(state.props.nodes).toHaveLength(1);
  });

  it("pastes copied nodes at the pane menu position", async () => {
    await mount([image("a")]);
    select(["a"]);
    press("c", { ctrlKey: true });
    act(() => state.props.onPaneContextMenu(new MouseEvent("contextmenu", { clientX: 480, clientY: 320 })));
    const paste = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-canvas-context-menu] button')).find((button) => button.textContent?.startsWith("粘贴"))!;
    expect(paste.disabled).toBe(false);
    act(() => paste.click());
    expect(state.props.nodes).toHaveLength(2);
    expect(state.props.nodes.find((node: CanvasNode) => node.id !== "a").position).toEqual({ x: 480, y: 320 });
    expect(container.querySelector('[data-canvas-context-menu]')).toBeNull();
  });

  it("toggles the add-node menu on repeated clicks and closes it when switching dock panels", async () => {
    await mount([image("a")]);
    const createButton = container.querySelector<HTMLButtonElement>('button[aria-label="新建"], button[aria-label="添加节点"]')!;
    const createItem = () => container.querySelector('[data-canvas-create-kind="imageTask"]');
    act(() => createButton.click());
    expect(createItem()).not.toBeNull();
    act(() => createButton.click());
    expect(createItem()).toBeNull();
    act(() => createButton.click());
    expect(createItem()).not.toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[data-canvas-tool-trigger]')!.click());
    expect(createItem()).toBeNull();
    expect(container.querySelector('[data-canvas-tool-menu]')).not.toBeNull();
  });

  it("opens the second dock tool menu, switches modes and dismisses outside or with Escape", async () => {
    await mount([image("a")]);
    const toolButton = () => container.querySelector<HTMLButtonElement>('[data-canvas-tool-trigger]')!;
    act(() => toolButton().click());
    expect(toolButton().getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector('[data-canvas-tool-menu]')?.textContent).toContain("移动V抓手工具H");
    act(() => toolButton().click());
    expect(container.querySelector('[data-canvas-tool-menu]')).toBeNull();
    act(() => toolButton().click());
    const hand = container.querySelector<HTMLButtonElement>('[data-canvas-tool-option="hand"]')!;
    act(() => hand.click());
    expect(toolButton().getAttribute("aria-label")).toBe("抓手工具");
    expect(container.querySelector('[data-canvas-tool-menu]')).toBeNull();
    expect(state.props.panOnDrag).toEqual([0, 1]);
    act(() => toolButton().click());
    expect(container.querySelector('[data-canvas-tool-option="hand"]')?.getAttribute("aria-checked")).toBe("true");
    press("Escape");
    expect(container.querySelector('[data-canvas-tool-menu]')).toBeNull();
    act(() => toolButton().click());
    act(() => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(container.querySelector('[data-canvas-tool-menu]')).toBeNull();
    act(() => toolButton().click());
    act(() => container.querySelector<HTMLButtonElement>('[data-canvas-tool-option="move"]')!.click());
    expect(state.props.panOnDrag).toEqual([1]);
  });

  it("temporarily pans with Space and restores the chosen mode on keyup or window blur", async () => {
    await mount([image("a")]);
    const moveIcon = container.querySelector('[data-canvas-tool-trigger] svg')!.outerHTML;
    press(" ", { code: "Space" });
    expect(state.props.panOnDrag).toEqual([0, 1]);
    expect(container.querySelector('[data-canvas-tool-trigger]')?.getAttribute("aria-label")).toBe("抓手工具");
    expect(container.querySelector('[data-canvas-tool-trigger] .lucide-hand')).not.toBeNull();
    act(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space" })));
    expect(state.props.panOnDrag).toEqual([1]);
    expect(container.querySelector('[data-canvas-tool-trigger] svg')!.outerHTML).toBe(moveIcon);
    press(" ", { code: "Space" });
    act(() => window.dispatchEvent(new Event("blur")));
    expect(state.props.panOnDrag).toEqual([1]);
    press("h");
    press(" ", { code: "Space" });
    act(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space" })));
    expect(state.props.panOnDrag).toEqual([0, 1]);
  });

  it.each([.1, .2, .5, 1, 2, 4, 8].flatMap(zoom => [false, true].map(readOnly => ({ zoom, readOnly }))))("settles wheel zoom and accepts an immediate Space drag at zoom $zoom (readOnly=$readOnly)", async ({ zoom, readOnly }) => {
    vi.useFakeTimers();
    state.nativePanEnabled = true;
    state.transform = [0, 0, zoom];
    const changed = vi.fn();
    const viewportCommitted = vi.fn();
    await mount([image("a")], changed, [], { readOnly, onViewportCommit: viewportCommitted });
    select(["a"]);
    const surface = container.querySelector<HTMLElement>("[data-test-flow]")!;
    try {
      await act(async () => surface.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true, cancelable: true, ctrlKey: true, deltaY: zoom === 8 ? 100 : -100, clientX: 200, clientY: 200,
      })));
      const zoomed = state.pan!.getViewport();
      expect(zoomed.zoom).toBeCloseTo(zoom === 8 ? zoom / CANVAS_WHEEL_ZOOM_STEP : zoom * CANVAS_WHEEL_ZOOM_STEP);
      expect(state.props.className).toContain("canvas-interacting");
      // The native programmatic end must not release a newly held mouse pan.
      act(() => {
        board.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
        surface.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 200, clientY: 200, button: 0, buttons: 1 }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 260, clientY: 200, buttons: 1 }));
      });
      await act(async () => vi.advanceTimersByTime(180));
      expect(state.props.className).toContain("canvas-interacting");
      expect(state.pan!.getViewport()).toEqual({ ...zoomed, x: zoomed.x + 60 });
      act(() => {
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: 260, clientY: 200, buttons: 0 }));
        board.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true }));
      });
      await act(async () => vi.advanceTimersByTime(500));
      expect(state.props.className).not.toContain("canvas-interacting");
      await act(async () => vi.advanceTimersByTime(300));
      expect(viewportCommitted).toHaveBeenLastCalledWith(state.pan!.getViewport());
      if (readOnly) expect(changed).not.toHaveBeenCalled();
      else expect(changed.mock.lastCall?.[0].viewport).toEqual(state.pan!.getViewport());
      expect(state.props.nodes[0].position).toEqual({ x: 0, y: 0 });
      expect(state.props.nodes[0].selected).toBe(true);
      await act(async () => surface.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true, cancelable: true, ctrlKey: true, deltaY: 100,
      })));
      await act(async () => vi.advanceTimersByTime(500));
      expect(state.props.className).not.toContain("canvas-interacting");
      await act(async () => vi.advanceTimersByTime(300));
      expect(viewportCommitted).toHaveBeenLastCalledWith(state.pan!.getViewport());
      if (readOnly) {
        expect(changed).not.toHaveBeenCalled();
        expect(state.props.nodesDraggable).toBe(false);
        expect(state.props.nodesConnectable).toBe(false);
      } else expect(changed.mock.lastCall?.[0].viewport).toEqual(state.pan!.getViewport());
    } finally { await act(async () => vi.advanceTimersByTime(200)); vi.useRealTimers(); }
  });

  it.each([.1, 1, 4, 8].flatMap(zoom => ["node drag", "pan"].map(previous => ({ zoom, previous }))))(
    "accepts the first immediate Space drag after $previous at zoom $zoom", async ({ zoom, previous }) => {
      vi.useFakeTimers();
      state.nativePanEnabled = true;
      state.transform = [0, 0, zoom];
      await mount([image("a")]);
      select(["a"]);
      const surface = container.querySelector<HTMLElement>("[data-test-flow]")!;
      const mouse = (type: string, x: number, buttons: number) => new MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: 200, button: 0, buttons,
      });
      const key = (type: string) => new KeyboardEvent(type, { key: " ", code: "Space", bubbles: true, cancelable: true });
      try {
        if (previous === "node drag") {
          act(() => state.props.onNodeDragStart({}, state.props.nodes[0]));
          act(() => state.props.onNodesChange([{ type: "position", id: "a", position: { x: 50, y: 20 }, dragging: true }]));
          act(() => state.props.onNodeDragStop({}, state.props.nodes[0]));
        } else {
          press(" ", { code: "Space" });
          act(() => {
            surface.dispatchEvent(mouse("mousedown", 100, 1));
            window.dispatchEvent(mouse("mousemove", 140, 1));
            window.dispatchEvent(mouse("mouseup", 140, 0));
            board.dispatchEvent(key("keyup"));
          });
        }
        const nodePosition = state.props.nodes[0].position;
        for (let cycle = 0; cycle < 20; cycle++) {
          const start = state.pan!.getViewport();
          // No act/render boundary between the key and the native mouse press:
          // this is the rapid handoff missing from the older shortcut tests.
          act(() => {
            board.dispatchEvent(key("keydown"));
            expect(container.querySelector(".react-flow__nodes")?.hasAttribute("inert")).toBe(true);
            surface.dispatchEvent(mouse("mousedown", 200, 1));
            window.dispatchEvent(mouse("mousemove", 260, 1));
          });
          expect(state.pan!.getViewport()).toEqual({ ...start, x: start.x + 60 });
          expect(state.props.nodes[0].position).toEqual(nodePosition);
          expect(state.props.nodes.filter((node: CanvasFlowNode) => node.selected).map((node: CanvasFlowNode) => node.id)).toEqual(["a"]);
          if (cycle % 2 === 0) {
            act(() => board.dispatchEvent(key("keyup")));
            expect(state.props.selectionOnDrag).toBe(false);
            act(() => window.dispatchEvent(mouse("mouseup", 260, 0)));
          } else {
            act(() => window.dispatchEvent(mouse("mouseup", 260, 0)));
            act(() => board.dispatchEvent(key("keyup")));
          }
          expect(state.props.panOnDrag).toEqual([1]);
          expect(state.props.selectionOnDrag).toBe(true);
          expect(container.querySelector(".react-flow__nodes")?.hasAttribute("inert")).toBe(false);
        }
      } finally {
        act(() => { window.dispatchEvent(mouse("mouseup", 260, 0)); board.dispatchEvent(key("keyup")); });
        // d3 temporarily suppresses clicks after a drag and defers pan end.
        // Let both clean up before the next test mounts another board.
        await act(async () => vi.advanceTimersByTime(200));
        vi.useRealTimers();
      }
    },
  );

  it.each(["hidden", "Escape"])("releases temporary Space mode after %s even when keyup is lost", async (reason) => {
    await mount([image("a")]);
    press(" ", { code: "Space" });
    expect(container.querySelector(".react-flow__nodes")?.hasAttribute("inert")).toBe(true);
    if (reason === "hidden") {
      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      act(() => document.dispatchEvent(new Event("visibilitychange")));
      hidden.mockReturnValue(false);
      act(() => document.dispatchEvent(new Event("visibilitychange")));
    } else press("Escape");
    expect(state.props.panOnDrag).toEqual([1]);
    expect(state.props.selectionOnDrag).toBe(true);
    expect(container.querySelector(".react-flow__nodes")?.hasAttribute("inert")).toBe(false);
    expect(container.querySelector(".react-flow__edges")?.hasAttribute("inert")).toBe(false);
    expect(state.props.className).not.toContain("canvas-interacting");
  });

  it("keeps selection disabled until the mouse pan ends even if Space is released first", async () => {
    await mount([image("a"), image("b")]);
    select(["a"]);
    press(" ", { code: "Space" });
    act(() => state.props.onMoveStart(new MouseEvent("mousedown", { button: 0, buttons: 1 })));
    act(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space" })));
    expect(state.props.selectionOnDrag).toBe(false);
    expect(state.props.selectionKeyCode).toBeNull();
    expect(container.querySelector(".react-flow__nodes")?.hasAttribute("inert")).toBe(true);
    expect(state.props.panOnDrag).toEqual([0, 1]);
    act(() => window.dispatchEvent(new MouseEvent("mouseup", { button: 0, buttons: 0 })));
    expect(state.props.selectionOnDrag).toBe(true);
    expect(state.props.panOnDrag).toEqual([1]);
    expect(state.props.nodes.filter((node: any) => node.selected).map((node: any) => node.id)).toEqual(["a"]);
  });

  it.each(["space", "mouse-pan"])("clears an unstarted native marquee when switching to %s", async (action) => {
    await mount([image("a"), image("b")]);
    select(["a"]);
    // React Flow records this on pointerdown, before onSelectionStart fires.
    state.rect = { x: 20, y: 20, width: 0, height: 0, startX: 20, startY: 20 };
    if (action === "space") press(" ", { code: "Space" });
    else act(() => state.props.onMoveStart(new MouseEvent("mousedown", { button: 1, buttons: 4 })));
    expect(state.rect).toBeNull();
    // Late native selection changes must not replace the selection being panned.
    act(() => state.props.onNodesChange([
      { type: "select", id: "a", selected: false },
      { type: "select", id: "b", selected: true },
    ]));
    expect(state.props.nodes.filter((node: any) => node.selected).map((node: any) => node.id)).toEqual(["a"]);
    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { button: 1, buttons: 0 }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space" }));
    });
    // The next click is a new gesture, and must still be able to select a node.
    act(() => board.dispatchEvent(new MouseEvent("pointerdown", { button: 0, buttons: 1, bubbles: true })));
    select(["b"]);
    expect(state.props.nodes.filter((node: any) => node.selected).map((node: any) => node.id)).toEqual(["b"]);
  });

  it("does not switch tools while typing or using modified and repeated keys", async () => {
    await mount([image("a")]);
    const input = document.createElement("textarea");
    board.appendChild(input);
    for (const key of ["h", "v", " "]) expect(press(key, {}, input).defaultPrevented).toBe(false);
    expect(press("h", {}, document.body).defaultPrevented).toBe(false);
    expect(press("h", { repeat: true }).defaultPrevented).toBe(false);
    expect(press("h", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(state.props.panOnDrag).toEqual([1]);
  });

  function pointAt(target: Element) {
    act(() => target.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 120, clientY: 120 })));
  }

  it("starts Space pan over the canvas when focus remains on a clicked toolbar button", async () => {
    await mount([image("a")]);
    const button = container.querySelector<HTMLButtonElement>("[data-canvas-tool-trigger]")!;
    button.focus();
    pointAt(container.querySelector("[data-test-flow]")!);
    const keyHandler = vi.fn();
    button.addEventListener("keydown", keyHandler);
    expect(press(" ", { code: "Space" }, button).defaultPrevented).toBe(true);
    expect(state.props.panOnDrag).toEqual([0, 1]);
    expect(document.activeElement).toBe(board);
    expect(keyHandler).not.toHaveBeenCalled();
  });

  it("accepts Space with body focus only while the pointer is in the canvas", async () => {
    await mount([image("a")]);
    board.blur();
    expect(press(" ", { code: "Space" }, document.body).defaultPrevented).toBe(false);
    pointAt(container.querySelector("[data-test-flow]")!);
    expect(press(" ", { code: "Space" }, document.body).defaultPrevented).toBe(true);
    expect(state.props.panOnDrag).toEqual([0, 1]);
    act(() => window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space" })));
    act(() => board.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body })));
    board.blur();
    expect(press(" ", { code: "Space" }, document.body).defaultPrevented).toBe(false);
  });

  it("preserves Space in inputs, menus and buttons under the pointer", async () => {
    await mount([image("a")]);
    const flow = container.querySelector("[data-test-flow]")!;
    pointAt(flow);
    const input = document.createElement("textarea"); board.append(input);
    const editable = document.createElement("div"); editable.setAttribute("contenteditable", "true"); board.append(editable);
    const child = document.createElement("span"); editable.append(child);
    const menu = document.createElement("div"); menu.setAttribute("role", "menu"); board.append(menu);
    const item = document.createElement("button"); menu.append(item);
    for (const target of [input, child, item]) expect(press(" ", { code: "Space" }, target).defaultPrevented).toBe(false);
    const button = container.querySelector<HTMLButtonElement>("[data-canvas-tool-trigger]")!;
    pointAt(button);
    expect(press(" ", { code: "Space" }, button).defaultPrevented).toBe(false);
    expect(state.props.panOnDrag).toEqual([1]);
  });

  it("restores canvas focus after closing a preview and keeps Space out of the open preview", async () => {
    await mount([image("a")]);
    pointAt(container.querySelector("[data-test-flow]")!);
    act(() => state.props.onNodeContextMenu(new MouseEvent("contextmenu", { clientX: 100, clientY: 100 }), state.props.nodes[0]));
    act(() => state.editor.previewMedia('a'));
    const close = container.querySelector<HTMLButtonElement>("[data-test-preview-close]")!;
    close.focus();
    expect(press(" ", { code: "Space" }, close).defaultPrevented).toBe(false);
    expect(press(" ", { code: "Space" }).defaultPrevented).toBe(false);
    expect(state.props.panOnDrag).toEqual([1]);
    act(() => close.click());
    expect(document.activeElement).toBe(board);
    expect(press(" ", { code: "Space" }).defaultPrevented).toBe(true);
    expect(state.props.panOnDrag).toEqual([0, 1]);
  });

  it("releases temporary pan even when a child intercepts keyup", async () => {
    await mount([image("a")]);
    press(" ", { code: "Space" });
    const control = document.createElement("button"); board.append(control);
    control.addEventListener("keyup", event => event.stopPropagation());
    act(() => control.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", bubbles: true })));
    expect(state.props.panOnDrag).toEqual([1]);
  });

  it("keeps node editing shortcuts inactive in hand mode while zoom still works", async () => {
    await mount([image("a"), image("b")]);
    select(["a", "b"]);
    press("c", { ctrlKey: true });
    press("h");
    press("g", { ctrlKey: true });
    press("d", { ctrlKey: true });
    press("v", { ctrlKey: true });
    press("Delete");
    expect(state.props.nodes.map((node: CanvasNode) => node.id)).toEqual(["a", "b"]);
    press("+", { ctrlKey: true });
    expect(state.zoomTo).toHaveBeenCalled();
    press("v");
    press("g", { ctrlKey: true });
    expect(state.props.nodes.some((node: CanvasNode) => node.type === "group")).toBe(true);
  });

  it("creates with Tab, duplicates, deletes and undoes through the existing document history", async () => {
    await mount([]);
    expect(press("Tab").defaultPrevented).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>('[data-canvas-create-kind="llm"]')!.click());
    expect(state.props.nodes).toHaveLength(1);
    select(state.props.nodes.map((n: CanvasNode) => n.id));
    press("d", { ctrlKey: true });
    expect(state.props.nodes).toHaveLength(2);
    press("Delete");
    expect(state.props.nodes).toHaveLength(1);
    press("z", { ctrlKey: true });
    expect(state.props.nodes).toHaveLength(2);
    expect(press("Z", { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(state.props.nodes).toHaveLength(1);
  });

  it("uses existing groups, skips storyboard creation, and protects images across delete and undo", async () => {
    await mount([image("a"), image("b")]);
    select(["a", "b"]);
    press("g", { altKey: true });
    expect(state.props.nodes.filter((n: CanvasNode) => n.type === "group")).toHaveLength(1);
    press("G", { altKey: true, shiftKey: true });
    expect(state.props.nodes).toHaveLength(2);
    select(["a", "b"]);
    expect(press("g", { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(state.props.nodes).toHaveLength(2);
    press("g", { ctrlKey: true });
    press("Delete");
    expect(state.props.nodes).toHaveLength(0);
    expect(state.held.mock.lastCall?.[0]).toHaveLength(2);
    press("z", { ctrlKey: true });
    expect(state.props.nodes).toHaveLength(3);
  });

  it("deletes all selected nodes directly without confirmation and supports undo", async () => {
    await mount([image("a"), image("b")]);
    press("a", { ctrlKey: true });
    press("Backspace");
    expect(state.props.nodes).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    press("z", { ctrlKey: true });
    expect(state.props.nodes).toHaveLength(2);
  });

  it("deletes the final node directly through the context menu", async () => {
    await mount([image("a")]);
    select(["a"]);
    act(() => state.props.onNodeContextMenu({ preventDefault() {}, clientX: 100, clientY: 100 }, state.props.nodes[0]));
    act(() => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "删除")!.click());
    expect(state.props.nodes).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("ignores raw node-removal events that bypass explicit deletion", async () => {
    const onChange = vi.fn();
    await mount([image("a"), image("b")], onChange);
    onChange.mockClear();
    act(() => state.props.onNodesChange([{ type: "remove", id: "a" }, { type: "remove", id: "b" }]));
    expect(state.props.nodes).toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not select or delete canvas nodes while editing nested text or native controls", async () => {
    await mount([image("a"), image("b")]);
    select(["a"]);
    const editable = document.createElement("div"); editable.setAttribute("contenteditable", "true");
    const child = document.createElement("span"); editable.append(child); board.append(editable);
    const selectControl = document.createElement("select"); board.append(selectControl);
    const textbox = document.createElement("div"); textbox.setAttribute("role", "textbox"); board.append(textbox);
    for (const target of [child, selectControl, textbox]) {
      expect(press("a", { ctrlKey: true }, target).defaultPrevented).toBe(false);
      expect(press("Backspace", {}, target).defaultPrevented).toBe(false);
    }
    expect(state.props.nodes).toHaveLength(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(["ctrlKey", "metaKey"] as const)("never lets %s+A select page text from canvas controls, hand mode or key repeats", async (command) => {
    await mount([image("a"), image("b")]);
    const button = container.querySelector<HTMLButtonElement>("[data-canvas-tool-trigger]")!;
    button.focus();
    expect(press("a", { [command]: true }, button).defaultPrevented).toBe(true);
    expect(state.props.nodes.filter((node: any) => node.selected)).toHaveLength(0);
    board.focus();
    press("h");
    expect(press("a", { [command]: true }).defaultPrevented).toBe(true);
    expect(state.props.nodes.filter((node: any) => node.selected)).toHaveLength(0);
    press("v");
    expect(press("a", { [command]: true }).defaultPrevented).toBe(true);
    expect(state.props.nodes.filter((node: any) => node.selected)).toHaveLength(2);
    expect(press("a", { [command]: true, repeat: true }).defaultPrevented).toBe(true);
    const input = document.createElement("textarea"); board.append(input); input.focus();
    expect(press("a", { [command]: true }, input).defaultPrevented).toBe(false);
    expect(press("a", { [command]: true, repeat: true }, input).defaultPrevented).toBe(false);
    expect(press("a", { [command]: true }, document.body).defaultPrevented).toBe(false);
  });

  it("shows an independent multi-selection toolbar and groups selected nodes", async () => {
    await mount([image("a"), image("b"), image("c")]);
    select(["a"]);
    expect(container.querySelector('[data-canvas-multi-selection-toolbar]')).toBeNull();
    select(["a", "b"]);
    const toolbar = container.querySelector('[data-canvas-multi-selection-toolbar]')!;
    expect(toolbar.querySelectorAll('button')).toHaveLength(4);
    expect(toolbar.querySelector('button:nth-last-child(2)')?.getAttribute('aria-label')).toBe('保存到素材库');
    expect(toolbar.querySelector('button:last-child')?.getAttribute('aria-label')).toBe('下载全部');
    act(() => toolbar.querySelector<HTMLButtonElement>('[aria-label="打组"]')!.click());
    const group = state.props.nodes.find((node: CanvasNode) => node.type === "group");
    expect(group).toBeDefined();
    expect(state.props.nodes.filter((node: CanvasNode) => node.parentId === group.id).map((node: CanvasNode) => node.id)).toEqual(["a", "b"]);
    expect(state.props.nodes.find((node: CanvasNode) => node.id === "c").parentId).toBeUndefined();
    expect(container.querySelector('[data-canvas-multi-selection-toolbar]')).toBeNull();
    press("z", { ctrlKey: true });
    expect(state.props.nodes.some((node: CanvasNode) => node.type === "group")).toBe(false);
  });

  it("keeps download all last and downloads every selected material once", async () => {
    const first = image("a");
    const second = { ...image("b"), position: { x: 300, y: 0 } };
    await mount([first, second]);
    select([first.id, second.id]);
    const BrowserURL = URL;
    vi.stubGlobal("URL", class extends BrowserURL {
      static createObjectURL() { return "blob:selected-media"; }
      static revokeObjectURL() {}
    });
    const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const downloaded: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloaded.push(this.download); });
    const toolbar = container.querySelector('[data-canvas-multi-selection-toolbar]')!;
    const buttons = toolbar.querySelectorAll<HTMLButtonElement>('button');
    expect(buttons[buttons.length - 1].getAttribute('aria-label')).toBe('下载全部');
    expect(buttons[buttons.length - 1].disabled).toBe(false);
    await act(async () => { buttons[buttons.length - 1].click(); });
    await vi.waitFor(() => expect(downloaded).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(downloaded[0]).toMatch(/^canvas-selection-\d+\.zip$/);
  });

  it("stacks selected nodes while routing external display edges to the stack", async () => {
    await mount([image("a"), image("b"), image("c")], undefined, [
      { id: "internal", source: "a", target: "b" }, { id: "external", source: "b", target: "c" },
    ]);
    select(["a", "b"]);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="堆叠"]')!.click());
    const stack = state.props.nodes.find((node: CanvasNode) => node.data.kind === "group" && node.data.stacked);
    expect(stack).toBeDefined();
    expect(state.props.nodes.find((node: CanvasNode) => node.id === "a").hidden).toBe(true);
    expect(state.props.edges).toHaveLength(1);
    expect(state.props.edges[0]).toMatchObject({ id: "external", source: stack.id, target: "c" });
    press("z", { ctrlKey: true });
    expect(state.props.edges).toHaveLength(2);
    expect(state.props.nodes.some((node: CanvasNode) => node.type === "group")).toBe(false);
  });

  it("restores a saved stack through its group action after re-entering the canvas", async () => {
    const original = [image("a"), { ...image("b"), position: { x: 400, y: 200 } }, image("c")];
    const edges = [{ id: "external", source: "a", target: "c" }];
    const stacked = stackSelection({ ...createEmptyCanvasDocumentV2(), nodes: original, edges }, ["a", "b"]);
    const saved = JSON.parse(JSON.stringify(stacked.document));
    await mount(saved.nodes, undefined, saved.edges);
    const stack = state.props.nodes.find((node: CanvasNode) => node.id === stacked.groupId);
    expect(stack.zIndex).toBe(0);
    // CanvasNodeCard is mocked above; invoke the same action used by its stack toolbar.
    act(() => state.editor.groupAction(stack.id, "ungroup"));
    expect(state.props.nodes.some((node: CanvasNode) => node.id === stacked.groupId)).toBe(false);
    for (const node of original) {
      expect(state.props.nodes.find((item: CanvasNode) => item.id === node.id)).toMatchObject({ position: node.position, data: node.data });
    }
    expect(state.props.nodes.filter((node: CanvasNode) => node.hidden)).toHaveLength(0);
    expect(state.props.edges[0]).toMatchObject(edges[0]);
  });

  it.each(["textarea", "contenteditable"])("starts the first Space drag despite retained task %s focus", async (kind) => {
    await mount([image("a")]);
    select(["a"]);
    const flow = container.querySelector<HTMLElement>("[data-test-flow]")!;
    const panel = document.createElement("div");
    panel.setAttribute("data-canvas-task-panel", "");
    const input = document.createElement(kind === "textarea" ? "textarea" : "div");
    if (kind === "contenteditable") { input.setAttribute("contenteditable", "true"); input.tabIndex = 0; }
    panel.append(input); flow.append(panel);
    input.focus();
    pointAt(input);
    expect(press(" ", { code: "Space" }, input).defaultPrevented).toBe(false);
    expect(state.props.panOnDrag).toEqual([1]);
    pointAt(flow);
    const typing = vi.fn(); input.addEventListener("keydown", typing);
    expect(press(" ", { code: "Space" }, input).defaultPrevented).toBe(true);
    expect(state.props.panOnDrag).toEqual([0, 1]);
    expect(state.props.selectionOnDrag).toBe(false);
    expect(document.activeElement).toBe(board);
    expect(typing).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space" })));
    expect(state.props.panOnDrag).toEqual([1]);
  });

  it("ignores deletion during IME composition", async () => {
    await mount([image("a"), image("b")]);
    select(["a"]);
    expect(press("Backspace", { isComposing: true }).defaultPrevented).toBe(false);
    expect(press("Delete", { keyCode: 229 }).defaultPrevented).toBe(false);
    expect(state.props.nodes).toHaveLength(2);
  });

  it("connects a selected image and text task through Ctrl+L", async () => {
    await mount([image("a"), { id: "text", type: "llm", position: { x: 500, y: 0 }, data: { kind: "llm", prompt: "", status: "idle" } }]);
    select(["text", "a"]);
    press("l", { ctrlKey: true });
    expect(state.props.edges).toHaveLength(1);
    expect(state.props.edges[0]).toMatchObject({ source: "a", target: "text" });
  });

  it("leaves text editing, external focus, repeated events and native Tab navigation alone", async () => {
    await mount([image("a")]);
    const input = document.createElement("input");
    board.appendChild(input);
    expect(press("Tab", {}, input).defaultPrevented).toBe(false);
    expect(press("Tab", {}, document.body).defaultPrevented).toBe(false);
    expect(press("Tab", { repeat: true }).defaultPrevented).toBe(false);
    expect(press("Tab", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(container.querySelector('[data-canvas-create-kind="prompt"]')).toBeNull();
  });

  it.each([false, true])("Alt drag copies nodes with Ctrl held = %s", async (ctrlKey) => {
    await mount([image("a"), image("b")], undefined, [{ id: "ab", source: "a", target: "b" }]);
    select(["a", "b"]);
    const source = state.props.nodes.find((n: CanvasNode) => n.id === "a");
    act(() => state.props.onNodeDragStart({ altKey: true, ctrlKey, shiftKey: false }, source));
    act(() => state.props.onNodesChange(["a", "b"].map((id) => ({ type: "position", id, position: { x: 100, y: 150 }, dragging: true }))));
    act(() => state.props.onNodeDragStop({}, { ...source, position: { x: 100, y: 150 } }));
    const originals = state.props.nodes.filter((n: CanvasNode) => n.id === "a" || n.id === "b");
    const copies = state.props.nodes.filter((n: CanvasNode) => n.id !== "a" && n.id !== "b");
    expect(originals.every((n: CanvasNode) => n.position.x === 0 && n.position.y === 0)).toBe(true);
    expect(copies).toHaveLength(2);
    expect(copies.every((n: CanvasNode) => n.position.x === 100 && n.position.y === 150)).toBe(true);
    expect(state.props.edges).toHaveLength(ctrlKey ? 2 : 1);
  });

  it.each([false, true])("keeps originals stationary throughout copy dragging with Ctrl = %s", async (ctrlKey) => {
    const saved = vi.fn();
    const a = { ...image("a"), position: { x: 10, y: 20 } };
    const b = { ...image("b"), position: { x: 400, y: 200 } };
    await mount([a, b], saved);
    select(["a", "b"]);
    const source = state.props.nodes.find((node: CanvasNode) => node.id === "a");
    act(() => state.props.onNodeDragStart({ altKey: true, ctrlKey, shiftKey: false }, source));
    const copyIds = state.props.nodes.filter((node: CanvasNode) => node.id !== "a" && node.id !== "b").map((node: CanvasNode) => node.id);
    expect(copyIds).toHaveLength(2);
    act(() => state.props.onNodesChange([{ type: "select", id: "a", selected: true }]));
    expect(state.props.nodes.find((node: CanvasNode) => node.id === "a").selected).toBe(false);

    for (const offset of [{ x: 40, y: 60 }, { x: 90, y: 110 }]) {
      act(() => state.props.onNodesChange([a, b].map((node) => ({ type: "position", id: node.id, position: { x: node.position.x + offset.x, y: node.position.y + offset.y }, dragging: true }))));
      expect(state.props.nodes.find((node: CanvasNode) => node.id === "a").position).toEqual(a.position);
      expect(state.props.nodes.find((node: CanvasNode) => node.id === "b").position).toEqual(b.position);
      const copies = state.props.nodes.filter((node: CanvasNode) => copyIds.includes(node.id));
      expect(copies.map((node: CanvasNode) => node.position)).toEqual([a, b].map((node) => ({ x: node.position.x + offset.x, y: node.position.y + offset.y })));
      expect(copies.every((node: any) => node.selected)).toBe(true);
    }
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(saved.mock.lastCall?.[0].nodes.map((node: CanvasNode) => node.id)).toEqual(["a", "b"]);
    act(() => state.props.onNodesChange([a, b].map((node) => ({ type: "position", id: node.id, position: { x: node.position.x + 90, y: node.position.y + 110 }, dragging: false }))));
    act(() => state.props.onNodeDragStop({}, { ...source, position: { x: 100, y: 130 } }));
    expect(state.props.nodes.filter((node: CanvasNode) => copyIds.includes(node.id))).toHaveLength(2);
    expect(state.props.nodes.find((node: CanvasNode) => node.id === "a").position).toEqual(a.position);
    press("z", { ctrlKey: true });
    expect(state.props.nodes.map((node: CanvasNode) => ({ id: node.id, position: node.position }))).toEqual([a, b].map(({ id, position }) => ({ id, position })));
  });

  it.each([.1, .2, .5, 1, 2, 8])("keeps twelve-screen-pixel frame grips and delegates drag at zoom %s", async zoom => {
    state.transform = [0, 0, zoom];
    try {
      await mount([image("a"), { ...image("b"), position: { x: 400, y: 200 } }]);
      select(["a", "b"]);
      const flow = container.querySelector('[data-test-flow]')!;
      flow.classList.add("react-flow");
      const target = document.createElement("div"); target.className = "react-flow__node selected"; flow.append(target);
      const receive = vi.fn(); target.addEventListener("mousedown", receive);
      const grips = [...container.querySelectorAll<HTMLElement>('[data-canvas-selection-grab]')];
      expect(grips).toHaveLength(4);
      expect(parseFloat(grips[0].style.height) * zoom).toBeCloseTo(12);
      expect(parseFloat(grips[2].style.width) * zoom).toBeCloseTo(12);
      act(() => grips[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, buttons: 1, clientX: 40, clientY: 50 })));
      expect(receive).toHaveBeenCalledTimes(1);
      expect(receive.mock.calls[0][0]).toMatchObject({ clientX: 40, clientY: 50, buttons: 1 });
    } finally { state.transform = [0, 0, 1]; }
  });

  it.each(["blur", "pointercancel", "Escape"])("ends the underlying mouse drag on %s", async kind => {
    await mount([image("a")]); select(["a"]);
    act(() => state.props.onNodeDragStart({ altKey: false }, state.props.nodes[0]));
    const end = vi.fn(); window.addEventListener("mouseup", end);
    try {
      if (kind === "Escape") press("Escape");
      else act(() => window.dispatchEvent(new Event(kind)));
      expect(end).toHaveBeenCalledTimes(1);
      expect(state.props.className).not.toContain("canvas-node-dragging");
    } finally { window.removeEventListener("mouseup", end); }
  });

  it("cancels an interrupted copy drag without moving its original or saving the preview", async () => {
    await mount([image("a")]);
    select(["a"]);
    const source = state.props.nodes[0];
    act(() => state.props.onNodeDragStart({ altKey: true, ctrlKey: false, shiftKey: false }, source));
    act(() => state.props.onNodesChange([{ type: "position", id: "a", position: { x: 90, y: 80 }, dragging: true }]));
    act(() => window.dispatchEvent(new Event("blur")));
    act(() => state.props.onNodesChange([{ type: "position", id: "a", position: { x: 90, y: 80 }, dragging: false }]));
    act(() => state.props.onNodeDragStop({}, source));
    expect(state.props.nodes).toHaveLength(1);
    expect(state.props.nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it("moves only the copied group while preserving child coordinates and copied internal edges", async () => {
    const group: CanvasNode = { id: "group", type: "group", position: { x: 100, y: 100 }, width: 600, height: 500, data: { kind: "group", title: "group", collapsed: false } };
    const a = { ...image("a"), parentId: group.id, position: { x: 20, y: 40 } };
    const b = { ...image("b"), parentId: group.id, position: { x: 320, y: 40 } };
    await mount([group, a, b], undefined, [{ id: "edge", source: "a", target: "b" }]);
    // Loading normalizes group padding while preserving absolute child positions.
    const loaded = structuredClone(state.props.nodes) as CanvasNode[];
    select([group.id]);
    act(() => state.props.onNodeDragStart({ altKey: true, ctrlKey: true, shiftKey: false }, state.props.nodes[0]));
    act(() => state.props.onNodesChange([{ type: "position", id: group.id, position: { x: 300, y: 250 }, dragging: true }]));
    const copyGroup = state.props.nodes.find((node: CanvasNode) => node.type === "group" && node.id !== group.id);
    const children = state.props.nodes.filter((node: CanvasNode) => node.parentId === copyGroup.id);
    expect(copyGroup.position).toEqual({ x: 300, y: 250 });
    expect(children.map((node: CanvasNode) => node.position)).toEqual(loaded.filter(node => node.parentId === group.id).map(node => node.position));
    expect(state.props.edges).toHaveLength(2);
    expect(state.props.edges[1]).toMatchObject({ source: children[0].id, target: children[1].id });
    act(() => state.props.onNodeDragStop({}, group));
    expect(state.props.nodes.slice(0, 3).map((node: CanvasNode) => node.position)).toEqual(loaded.map(node => node.position));
  });

  it("opens the existing arrange confirmation with Alt+Shift+F", async () => {
    await mount([image("a"), image("b")]);
    press("F", { altKey: true, shiftKey: true });
    expect(container.textContent).toContain("是否保留此次整理结果？");
    const restore = [...container.querySelectorAll("button")].find(button => button.textContent === "还原")!;
    act(() => restore.click());
    expect(state.props.nodes.every((node: CanvasNode) => node.position.x === 0 && node.position.y === 0)).toBe(true);
  });

  it("routes Ctrl+Enter to the selected generator without submitting when no model is available", async () => {
    await mount([]);
    press("Tab");
    act(() => container.querySelector<HTMLButtonElement>('[data-canvas-create-kind="imageTask"]')!.click());
    press("Enter", { ctrlKey: true });
    expect(container.textContent).toContain("暂无可用图片模型");
  });

  it("preserves an actual submitted video across undo and redo and writes its result without resubmitting", async () => {
    let complete!: (url: string) => void;
    const submit = vi.spyOn(generationClient, "submitVideoGen").mockResolvedValue({ generationId: 32594, status: "running" });
    const poll = vi.spyOn(generationClient, "waitForGenerationResult").mockImplementation(() => new Promise<string>(resolve => { complete = resolve; }));
    await mount([{ id: "video", type: "videoTask", position: { x: 0, y: 0 }, data: { kind: "videoTask", model: "minimax-h3", prompt: "video prompt", mediaPaths: [], status: "idle" } }]);
    press("Tab");
    act(() => container.querySelector<HTMLButtonElement>('[data-canvas-create-kind="llm"]')!.click());
    select(["video"]);
    await act(async () => { press("Enter", { ctrlKey: true }); });
    const running = state.props.nodes.find((node: CanvasNode) => node.id === "video").data;
    expect(running.status).toBe("running");
    expect(running.generationId).toBe(32594);
    press("z", { ctrlKey: true });
    expect(state.props.nodes).toHaveLength(1);
    expect(state.props.nodes[0].data).toEqual(running);
    press("z", { ctrlKey: true, shiftKey: true });
    expect(state.props.nodes).toHaveLength(2);
    expect(state.props.nodes.find((node: CanvasNode) => node.id === "video").data).toEqual(running);
    await act(async () => { complete("/uploads/result.mp4"); });
    expect(state.props.nodes.find((node: CanvasNode) => node.id === "video").data).toMatchObject({ status: "success", generationId: 32594, outputUrl: "/uploads/result.mp4" });
    press("z", { ctrlKey: true });
    expect(state.props.nodes.find((node: CanvasNode) => node.id === "video").data).toMatchObject({ status: "success", generationId: 32594, outputUrl: "/uploads/result.mp4" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("resumes an existing generation even if undo had erased its prompt", async () => {
    let complete!: (url: string) => void;
    const submit = vi.spyOn(generationClient, "submitVideoGen");
    const poll = vi.spyOn(generationClient, "waitForGenerationResult").mockImplementation(() => new Promise<string>(resolve => { complete = resolve; }));
    await mount([{ id: "video", type: "videoTask", position: { x: 0, y: 0 }, data: { kind: "videoTask", model: "minimax-h3", prompt: "", mediaPaths: [], status: "running", generationId: 32594 } }]);
    expect(state.props.nodes[0].data.status).toBe("running");
    expect(poll).toHaveBeenCalledWith(32594, undefined, 2500, generationClient.CANVAS_GENERATION_FOREGROUND_WAIT_MS, expect.any(Function));
    await act(async () => { complete("/uploads/result.mp4"); });
    expect(state.props.nodes[0].data).toMatchObject({ status: "success", generationId: 32594, outputUrl: "/uploads/result.mp4" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("opens the preview when double-clicking an image instead of moving the camera", async () => {
    await mount([image("a")]);
    const event = { target: document.createElement("div"), preventDefault: vi.fn(), stopPropagation: vi.fn() };
    await act(async () => state.props.onNodeDoubleClick(event, state.props.nodes[0]));
    expect(state.setViewport).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-test-preview-close]")).not.toBeNull();
  });

  it.each(["video", "audio", "imageTask", "videoTask", "audioTask"])("focuses a double-clicked %s without opening a preview or running the node", async (kind) => {
    await mount([image("a")]);
    const before = structuredClone(state.props.nodes);
    const node = { ...state.props.nodes[0], data: { ...state.props.nodes[0].data, kind, status: "running" } };
    const event = { target: document.createElement("div"), preventDefault: vi.fn(), stopPropagation: vi.fn() };
    await act(async () => state.props.onNodeDoubleClick(event, node));
    expect(state.setViewport).toHaveBeenCalledWith({ x: 760, y: 127.5, zoom: 2 }, { duration: 360 });
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(state.props.nodes).toEqual(before.map((item: any) => ({ ...item, selected: true })));
    expect(container.querySelector("[data-test-preview-close]")).toBeNull();
  });

  it.each(["video", "videoTask"])("requests playback when focusing a %s result and consumes the request once", async kind => {
    const node = { ...image("movie"), type: kind, data: kind === "video"
      ? { kind, url: "/movie.mp4" }
      : { kind, model: "", prompt: "", mediaPaths: [], status: "success", outputUrl: "/movie.mp4" } } as CanvasNode;
    await mount([node]);
    const event = { target: document.createElement("div"), preventDefault() {}, stopPropagation() {} };
    await act(async () => state.props.onNodeDoubleClick(event, state.props.nodes[0]));
    const first = state.editor.videoFocusRequest;
    expect(first).toMatchObject({ nodeId: "movie", src: "/movie.mp4" });
    await act(async () => state.editor.consumeVideoFocusRequest(first.revision));
    expect(state.editor.videoFocusRequest).toBeNull();
    await act(async () => state.props.onNodeDoubleClick(event, state.props.nodes[0]));
    expect(state.editor.videoFocusRequest.revision).toBeGreaterThan(first.revision);
  });

  it("keeps a visible focus transition even in a large board", async () => {
    await mount(Array.from({ length: 174 }, (_, i) => image(`media-${i}`)));
    const before = state.props.nodes.map((node: any) => ({ id: node.id, position: node.position, data: node.data }));
    const event = { target: document.createElement("div"), preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const audio = { ...state.props.nodes[0], data: { ...state.props.nodes[0].data, kind: "audio" } };
    await act(async () => state.props.onNodeDoubleClick(event, audio));
    expect(state.setViewport).toHaveBeenCalledWith({ x: 760, y: 127.5, zoom: 2 }, { duration: 360 });
    expect(state.props.nodes.map((node: any) => ({ id: node.id, position: node.position, data: node.data }))).toEqual(before);
  });

  it("respects reduced motion when focusing a node", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    await mount([image("a")]);
    const audio = { ...state.props.nodes[0], data: { ...state.props.nodes[0].data, kind: "audio" } };
    await act(async () => state.props.onNodeDoubleClick({ target: document.createElement("div"), preventDefault() {}, stopPropagation() {} }, audio));
    expect(state.setViewport).toHaveBeenCalledWith({ x: 760, y: 127.5, zoom: 2 }, { duration: 0 });
  });

  it.each(["button", "input", "textarea", "slider", "panel"])("does not focus the node when double-clicking a %s", async (kind) => {
    await mount([image("a")]);
    const target = document.createElement(["slider", "panel"].includes(kind) ? "div" : kind);
    if (kind === "slider") target.setAttribute("role", "slider");
    if (kind === "panel") target.setAttribute("data-canvas-task-panel-anchor", "");
    const event = { target, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    act(() => state.props.onNodeDoubleClick(event, state.props.nodes[0]));
    expect(state.setViewport).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
