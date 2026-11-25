// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { Blob as NodeBlob } from "node:buffer";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { applyCanvasOperations } from "@/lib/canvas/operations";
import * as documentDiff from "@/lib/canvas/document-diff";
import { readCanvasViewportPreference } from "@/lib/canvas/viewport-preference";
import type { CanvasDraftCommand } from "@/lib/canvas/draft-store";
import { createCanvasQueryHarness } from './helpers/canvas-runtime-harness';

const state = vi.hoisted(() => ({
  enabled: true, panel: null as any, bridge: null as any, boardMounts: 0, workflow: null as any, board: null as any, server: null as any, revision: 1, mutationCalls: 0,
  user: { id: 1 }, records: new Map<string, CanvasDraftCommand>(),
  send: null as null | (() => Promise<Response>),
  readWait: null as Promise<void> | null, sessionWait: null as Promise<void> | null, bootstrapStarted: false,
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
vi.mock("@/components/layout/atomic-page-reveal", () => ({ AtomicPageReveal: ({ children }: any) => children }));
vi.mock("@/components/canvas/CanvasLibraryPanel", () => ({ default: () => null, useCanvasLibraryPreviewWarmup: () => {} }));
vi.mock("@/components/canvas/CanvasWorkflowPanel", () => ({ default: () => null }));
vi.mock("@/components/canvas/SmartCanvasBoard", () => ({ default: () => null }));
vi.mock("@/components/creative-agent/CanvasAgentPanel", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({ default: () => function MockDynamic(props: any) {
  if (props.onPrepareMessage) state.panel = props;
  else if (props.onImport) state.workflow = props;
  else if (props.initial) {
    state.board = props;
    React.useEffect(() => { state.boardMounts++; }, []);
    if (props.agentBridgeRef) props.agentBridgeRef.current = state.bridge;
    return props.agentLauncher || null;
  }
  return null;
} }));
vi.mock("next/link", () => ({ default: ({ children }: any) => children }));
vi.mock("@/lib/canvas/tab-identity", () => ({ claimCanvasTabIdentity: async () => ({ tabId: "test", release() {} }) }));
vi.mock("@/lib/canvas/editor-session", () => ({ claimCanvasEditorSession: async () => { await state.sessionWait; return { sessionId: "session", release() {} }; } }));
vi.mock("@/lib/canvas/bootstrap-client", () => ({ loadCanvasBootstrap: async () => { await state.readWait; state.bootstrapStarted = true; return { title: "保存验收", revision: String(state.revision), document: structuredClone(state.server) }; } }));
vi.mock("@/lib/canvas/draft-store", async original => ({
  ...await original<typeof import("@/lib/canvas/draft-store")>(),
  createIndexedDbCanvasDraftDriver: () => ({
    list: async () => [...state.records.values()],
    put: async (command: CanvasDraftCommand) => { state.records.set(command.recordKey, command); },
    delete: async (key: string) => { state.records.delete(key); },
  }),
}));
import CanvasEditorPage from "@/components/canvas/CanvasEditorPage";

let root: Root, host: HTMLDivElement;
let queries: ReturnType<typeof createCanvasQueryHarness>;
const initial = (): CanvasDocumentV2 => ({
  ...createEmptyCanvasDocumentV2(),
  nodes: [{ id: "video", type: "videoTask", position: { x: 0, y: 0 }, width: 622, height: 350,
    data: { kind: "videoTask", model: "test-model", prompt: "画面缓慢推进", mediaPaths: [], status: "idle" } }],
});
const response = () => new Response(JSON.stringify({ success: true, revision: String(state.revision) }), { status: 200 });
beforeEach(() => {
  queries = createCanvasQueryHarness();
  vi.useFakeTimers(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  state.server = initial(); state.revision = 1; state.mutationCalls = 0; state.board = null; state.send = null; state.records.clear();
  state.readWait = null; state.sessionWait = null; state.bootstrapStarted = false;
  state.enabled = true; state.panel = null; state.boardMounts = 0;
  state.bridge = { getSnapshot: () => ({ document: state.board.initial, selection: { nodeIds: ["video"], edgeIds: [], references: [{ canvasId: 57, nodeId: "video", kind: "videoTask", label: "视频" }] } }),
    flush: vi.fn(), applyRemote: vi.fn(() => ({ conflicts: [] })), focus: vi.fn() };
  localStorage.clear(); window.history.replaceState(null, "", "/canvas/57?agent=open");
  vi.stubGlobal("EventSource", class { addEventListener() {} removeEventListener() {} close() {} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", () => 0); vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("performance", { mark() {}, now: () => Date.now() });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/creative-agent/capabilities")) return new Response(JSON.stringify({ enabled: state.enabled, ready: true, protocolVersion: 1, reason: null }));
    if (url.endsWith("/mutations")) {
      state.mutationCalls++;
      const result = state.send ? await state.send() : null;
      if (result && !result.ok) return result;
      state.server = applyCanvasOperations(state.server, JSON.parse(String(init?.body)).operations);
      state.revision++;
      return response();
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { act(() => root.unmount()); await queries.dispose(); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); vi.stubGlobal("requestAnimationFrame", () => 0); vi.stubGlobal("cancelAnimationFrame", () => {}); });
async function mount() { await act(async () => root.render(queries.wrap(React.createElement(CanvasEditorPage, { canvasId: 57 })))); expect(state.board).not.toBeNull(); }
async function edit(next: CanvasDocumentV2) { await act(async () => state.board.onChange(next)); }
async function prepare() { let result: string | undefined; await act(async () => { result = await state.board.onBeforeServerRun(); }); return result; }
const advance = async (ms: number) => { await act(async () => vi.advanceTimersByTime(ms)); };

describe("Agent canvas Editor integration", () => {
  it("shows failed autosaves and retries the retained document", async () => {
    await mount();
    state.send = async () => new Response(JSON.stringify({ error: "网络暂时不可用", code: "SAVE_FAILED" }), { status: 500 });
    const edited = initial(); edited.nodes[0].position.x = 123;
    await edit(edited); await advance(400);
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("画布未保存，请勿刷新");
    expect(alert?.closest('.hidden')).toBeNull();
    expect(state.server.nodes[0].position.x).toBe(0);
    state.send = null;
    await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === "重新保存")!.click(); });
    await advance(400);
    expect(state.server.nodes[0].position.x).toBe(123);
    expect(host.textContent).toContain("画布已保存");
    expect(host.textContent).not.toContain("画布未保存，请勿刷新");
    expect(state.records.size).toBe(0);
  });

  it("keeps the disabled baseline without Agent entry or panel", async () => {
    state.enabled = false;
    await mount();
    expect(host.querySelector('[aria-label="打开创作 Agent"]')).toBeNull();
    expect(state.panel).toBeNull();
    expect(state.board.agentBridgeRef).toBeUndefined();
  });
  it("opens from the canvas URL only when capabilities enable the entry", async () => {
    await mount();
    expect(state.panel?.canvasId).toBe(57);
    act(() => state.panel.onRunningChange(true));
    act(() => state.panel.onClose());
    expect(host.querySelector('[aria-label="打开创作 Agent"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="打开创作 Agent"] svg')?.getAttribute("data-state")).toBe("thinking");
    act(() => state.panel.onRunningChange(false));
    expect(host.querySelector('[aria-label="打开创作 Agent"] svg')?.getAttribute("data-state")).toBe("idle");
  });
  it("flushes pending Board data then saves before returning the committed revision and selection", async () => {
    await mount();
    const edited = initial(); (edited.nodes[0].data as any).prompt = "最新";
    state.bridge.flush.mockImplementation(() => state.board.onChange(edited));
    let context: any;
    await act(async () => { context = await state.panel.onPrepareMessage(); });
    expect(state.bridge.flush).toHaveBeenCalled();
    expect(state.server.nodes[0].data.prompt).toBe("最新");
    expect(context).toMatchObject({ canvasId: 57, revision: "2", selection: { nodeIds: ["video"] } });
  });
  it("applies an Agent canvas commit without remount or a mutation echo", async () => {
    await mount(); const mounts = state.boardMounts;
    state.server.nodes.push({ id: "Agent", type: "prompt", position: { x: 20, y: 0 }, data: { kind: "prompt", text: "new" } });
    state.revision++;
    await act(async () => state.panel.onCanvasCommitted());
    expect(state.bridge.applyRemote).toHaveBeenCalledWith(expect.objectContaining({ nodes: expect.arrayContaining([expect.objectContaining({ id: "Agent" })]) }));
    await advance(400);
    expect(state.boardMounts).toBe(mounts);
    expect(state.mutationCalls).toBe(0);
  });
  it("retains a title changed while the Agent snapshot is loading", async () => {
    await mount();
    let release!: () => void;
    state.readWait = new Promise(resolve => { release = resolve; });
    let refresh!: Promise<void>;
    await act(async () => { refresh = state.panel.onCanvasCommitted(); });
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="编辑画布名称"]')!.click());
    const input = host.querySelector<HTMLInputElement>('[aria-label="画布名称"]')!;
    act(() => { input.value = "新标题"; Simulate.change(input); });
    await act(async () => input.blur());
    await act(async () => { release(); await refresh; });
    expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith("/metadata") && JSON.parse(String(init?.body)).title === "新标题")).toBe(true);
  });
  it("rebases a local save racing an Agent write without remounting", async () => {
    await mount(); const mounts = state.boardMounts;
    const local = initial(); local.nodes[0].position.x = 120;
    (state.server.nodes[0].data as any).prompt = "Agent"; state.revision++;
    state.send = async () => { state.send = null; return new Response(JSON.stringify({ code: "CANVAS_REVISION_CONFLICT", error: "conflict", details: { missingMutations: [], clientMutationId: "failed" } }), { status: 409 }); };
    await edit(local); await advance(300);
    expect(state.boardMounts).toBe(mounts);
    expect(state.server.nodes[0]).toMatchObject({ position: { x: 120 }, data: { prompt: "Agent" } });
    expect(state.bridge.applyRemote).toHaveBeenCalled();
  });
  it("keeps concurrent user data in a conflict and resolves without remount", async () => {
    await mount(); const mounts = state.boardMounts;
    const local = initial(); (local.nodes[0].data as any).prompt = "user";
    await edit(local);
    (state.server.nodes[0].data as any).prompt = "Agent"; state.revision++;
    await act(async () => state.panel.onCanvasCommitted());
    expect(host.textContent).toContain("冲突");
    expect(state.bridge.applyRemote).not.toHaveBeenCalled();
    await advance(400); expect(state.mutationCalls).toBe(0);
    const resolve = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("合并并保存"));
    expect(resolve).toBeTruthy();
    await act(async () => resolve!.click()); await advance(100);
    expect(state.boardMounts).toBe(mounts);
    expect(state.bridge.applyRemote).toHaveBeenCalled();
    expect(state.server.nodes[0].data.prompt).toBe("user");
  });
});
