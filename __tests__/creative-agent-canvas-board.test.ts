// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2, type CanvasNodeData } from "@/lib/canvas/document";
import { canvasInternalNode } from './helpers/canvas-runtime-harness';

const state = vi.hoisted(() => ({ props: null as any, editor: null as any, context: null as any, submit: vi.fn(), submitAudio: vi.fn(), submitImage: vi.fn(), wait: vi.fn(), audioNodeIds: [] as string[] }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/canvas/use-canvas-models", () => ({ useCanvasModels: () => null, resolveCanvasModelId: () => "test-model" }));
vi.mock("@/lib/client/inflight-json", () => ({ fetchJsonOnce: async () => ({ ok: true, json: { success: true, items: [] } }) }));
vi.mock("@/components/canvas/CanvasViewportChrome", () => ({ CanvasViewportChrome: () => null }));
vi.mock("@/components/canvas/CanvasAudioPlayback", () => ({ CanvasAudioPlaybackProvider: ({ children, nodeIds }: any) => { state.audioNodeIds = nodeIds; return children; } }));
vi.mock("@/lib/canvas/audio-waveform", () => ({ analyzeAudioUrlCached: () => new Promise(() => {}) }));
vi.mock("@/components/canvas/CanvasMediaPrefetch", () => ({ CanvasMediaPrefetch: () => null }));
vi.mock("@/components/canvas/CanvasNodeCard", async () => {
  const React = await import("react"); state.context = React.createContext(null);
  return { CanvasNodeCard: () => null, CanvasNodeEditorContext: state.context };
});
vi.mock("@/components/canvas/run-node", () => ({
  CANVAS_GENERATION_FOREGROUND_WAIT_MS: 1000, shouldResumeCanvasGeneration: () => false,
  submitVideoGen: state.submit, submitAudioGen: state.submitAudio, submitImageGen: state.submitImage, waitForGenerationResult: state.wait,
}));
vi.mock("@xyflow/react", async original => {
  const actual = await original<typeof import("@xyflow/react")>(); const React = await import("react");
  const flow = {
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }), getZoom: () => 1,
    setViewport: vi.fn(), fitView: vi.fn(),
    screenToFlowPosition: (point: any) => point, flowToScreenPosition: (point: any) => point,
    getNodes: () => state.props.nodes, getNode: (id: string) => state.props.nodes.find((node: any) => node.id === id),
    getInternalNode: (id: string) => canvasInternalNode(state.props?.nodes, id),
    getNodesBounds: actual.getNodesBounds,
  };
  return { ...actual,
    useReactFlow: () => flow, useStore: (selector: any) => selector({ transform: [0, 0, 1] }),
    useStoreApi: () => ({ getState: () => ({ transform: [0, 0, 1] }), setState: vi.fn() }),
    ReactFlowProvider: ({ children }: any) => children,
    ReactFlow: (props: any) => { state.props = props; state.editor = React.useContext(state.context); return React.createElement("div", null, props.children); },
    Panel: ({ children }: any) => children, ViewportPortal: ({ children }: any) => children,
  };
});
import type { CreativeAgentBoardBridge } from "@/lib/creative-agent/contracts";
import SmartCanvasBoard from "@/components/canvas/SmartCanvasBoard";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  state.submit.mockReset().mockResolvedValue({ generationId: 1 });
  state.submitAudio.mockReset().mockResolvedValue({ generationId: 2, url: "/new.mp3", durationSeconds: 8 });
  state.submitImage.mockReset().mockResolvedValue({ generationId: 3 });
  state.wait.mockReset().mockResolvedValue("/test-output.mp4");
  state.audioNodeIds = [];
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const currentDoc = (): CanvasDocumentV2 => ({ ...createEmptyCanvasDocumentV2(), nodes: [{ id: "video", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "original" } }] });
async function mountBridge(onChange = vi.fn(), onSelectionChange = vi.fn(), initial = currentDoc()) {
  const agentBridgeRef = React.createRef<CreativeAgentBoardBridge | null>();
  await act(async () => root.render(React.createElement(SmartCanvasBoard, {
    canvasId: 57, editorSessionId: "test-session", preferenceOwnerId: "guest", onChange, onSelectionChange,
    agentBridgeRef, onBeforeServerRun: async () => "1", initial,
  })));
  return { bridge: agentBridgeRef, onChange, onSelectionChange };
}
describe("Agent Board bridge", () => {
  it("does not resubmit or poll Agent-owned pending tasks when the canvas loads", async () => {
    const initial = currentDoc();
    const settings = { model: "fixture", prompt: "fixture", aspectRatio: "1:1", resolution: "1K", quality: "auto", count: 1 };
    initial.nodes.push({ id: "agent-image", type: "imageTask", position: { x: 100, y: 0 }, data: { kind: "imageTask", task: { references: [], settings, batches: [{ id: "batch", createdAt: 1, settings, outputs: [{ id: "out", status: "running", requestKey: "image-request" }] }] } } });
    initial.nodes.push({ id: "agent-video", type: "videoTask", position: { x: 500, y: 0 }, data: { kind: "videoTask", model: "fixture", prompt: "video", mediaPaths: [], status: "running", requestKey: "video-request" } });
    await mountBridge(vi.fn(), vi.fn(), initial);
    await act(async () => vi.advanceTimersByTime(5000));
    expect(state.submitImage).not.toHaveBeenCalled(); expect(state.submit).not.toHaveBeenCalled(); expect(state.wait).not.toHaveBeenCalled();
  });
  it("does not collapse image results from debug inspector capture events", async () => {
    const initial = currentDoc();
    const settings = { model: "fixture", prompt: "fixture", aspectRatio: "1:1", resolution: "1K", quality: "auto", count: 2 };
    initial.nodes.push({ id: "image", type: "imageTask", position: { x: 100, y: 0 }, data: { kind: "imageTask", task: { references: [], settings, batches: [{ id: "batch", createdAt: 1, settings, expanded: true, outputs: [{ id: "a", status: "success", url: "/a.png" }, { id: "b", status: "success", url: "/b.png" }] }] } } });
    const { bridge } = await mountBridge(vi.fn(), vi.fn(), initial);
    const inspector = document.createElement("div"); inspector.setAttribute("data-agent-debug-inspector", ""); inspector.className = "nowheel"; host.append(inspector);
    act(() => {
      inspector.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      inspector.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 10 }));
      inspector.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect((bridge.current!.getSnapshot().document.nodes.find(node => node.id === "image")!.data as any).task.batches[0].expanded).toBe(true);
    inspector.remove();
  });
  it("flushes a throttled local change before publishing its snapshot", async () => {
    const { bridge, onChange } = await mountBridge();
    onChange.mockClear();
    await act(async () => state.editor.updateData("video", (data: any) => ({ ...data, text: "latest" })));
    expect(onChange).not.toHaveBeenCalled();
    act(() => bridge.current!.flush());
    expect(onChange.mock.calls.at(-1)?.[0].nodes[0].data.text).toBe("latest");
    expect(bridge.current!.getSnapshot().document.nodes[0].data).toMatchObject({ text: "latest" });
  });
  it("applies remote data without autosave echo or remount and keeps selection", async () => {
    const { bridge, onChange, onSelectionChange } = await mountBridge();
    await act(async () => vi.advanceTimersByTime(300)); onChange.mockClear();
    await act(async () => state.props.onNodesChange([{ type: "select", id: "video", selected: true }]));
    const before = bridge.current;
    const remote = structuredClone(bridge.current!.getSnapshot().document);
    (remote.nodes[0].data as any).text = "Agent";
    await act(async () => bridge.current!.applyRemote(remote));
    await act(async () => vi.advanceTimersByTime(300));
    expect(onChange).not.toHaveBeenCalled();
    expect(bridge.current).toBe(before);
    expect(bridge.current!.getSnapshot().selection.nodeIds).toEqual(["video"]);
    expect(onSelectionChange.mock.calls.at(-1)?.[0].nodeIds).toEqual(["video"]);
    expect(state.props.nodes[0].data.text).toBe("Agent");
  });
  it("preserves an unfinished local upload while excluding it from committed references", async () => {
    const initial = currentDoc();
    initial.nodes.push({ id: "pending", type: "image", position: { x: 20, y: 0 }, data: { kind: "image", url: "blob:upload-preview" } });
    const { bridge } = await mountBridge(vi.fn(), vi.fn(), initial);
    await act(async () => state.props.onNodesChange([{ type: "select", id: "pending", selected: true }]));
    const remote = currentDoc(); (remote.nodes[0].data as any).text = "Agent";
    await act(async () => bridge.current!.applyRemote(remote));
    expect(state.props.nodes.map((node: any) => node.id)).toContain("pending");
    expect(bridge.current!.getSnapshot().document.nodes.map(node => node.id)).not.toContain("pending");
    expect(bridge.current!.getSnapshot().selection.nodeIds).toEqual([]);
  });
  it("undoes a local move while preserving remotely changed text", async () => {
    const { bridge } = await mountBridge();
    await act(async () => state.props.onNodesChange([{ type: "position", id: "video", position: { x: 100, y: 0 }, dragging: false }]));
    // Use an ordinary data edit, whose undo path is independent from drag gestures.
    await act(async () => state.editor.updateData("video", (data: any) => ({ ...data, title: "user title" })));
    const remote = structuredClone(bridge.current!.getSnapshot().document);
    (remote.nodes[0].data as any).text = "Agent";
    await act(async () => bridge.current!.applyRemote(remote));
    await act(async () => host.querySelector("[tabindex]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })));
    expect(state.props.nodes[0].data.text).toBe("Agent");
    expect(state.props.nodes[0].data.title).toBeUndefined();
  });
});
