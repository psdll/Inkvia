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
  workflow: null as any, board: null as any, server: null as any, revision: 1, mutationCalls: 0,
  user: { id: 1 }, records: new Map<string, CanvasDraftCommand>(),
  send: null as null | (() => Promise<Response>),
  sessionWait: null as Promise<void> | null, bootstrapStarted: false,
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
vi.mock("@/components/layout/atomic-page-reveal", () => ({ AtomicPageReveal: ({ children }: any) => children }));
vi.mock("@/components/canvas/CanvasLibraryPanel", () => ({ default: () => null, useCanvasLibraryPreviewWarmup: () => {} }));
vi.mock("@/components/canvas/CanvasWorkflowPanel", () => ({ default: () => null }));
vi.mock("@/components/canvas/SmartCanvasBoard", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({ default: () => (props: any) => { if (props.onImport) state.workflow = props; else if (props.initial) state.board = props; return null; } }));
vi.mock("next/link", () => ({ default: ({ children }: any) => children }));
vi.mock("@/lib/canvas/tab-identity", () => ({ claimCanvasTabIdentity: async () => ({ tabId: "test", release() {} }) }));
vi.mock("@/lib/canvas/editor-session", () => ({ claimCanvasEditorSession: async () => { await state.sessionWait; return { sessionId: "session", release() {} }; } }));
vi.mock("@/lib/canvas/bootstrap-client", () => ({ loadCanvasBootstrap: async () => { state.bootstrapStarted = true; return { title: "保存验收", revision: String(state.revision), document: structuredClone(state.server) }; } }));
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
  state.sessionWait = null; state.bootstrapStarted = false;
  localStorage.clear();
  vi.stubGlobal("EventSource", class { addEventListener() {} removeEventListener() {} close() {} });
  vi.stubGlobal("requestAnimationFrame", () => 0); vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("performance", { mark() {}, now: () => Date.now() });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
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

describe("canvas title editing", () => {
  it("keeps the current canvas title after late metadata updates and releases it on leaving", async () => {
    await mount();
    await act(async () => { document.title = "Inkvia 墨途"; });
    expect(document.title).toBe("保存验收");
    const input = await enterTitle("MX650");
    await act(async () => input.blur());
    await act(async () => {
      const replacement = document.createElement("title");
      replacement.textContent = "Inkvia 墨途";
      document.head.querySelector("title")!.replaceWith(replacement);
    });
    expect(document.title).toBe("MX650");
    await act(async () => root.render(null));
    await act(async () => { document.title = "另一个页面"; });
    expect(document.title).toBe("另一个页面");
  });

  async function enterTitle(value: string) {
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="编辑画布名称"]')!.click());
    const input = host.querySelector<HTMLInputElement>('[aria-label="画布名称"]')!;
    act(() => {
      input.value = value;
      Simulate.change(input);
    });
    return input;
  }

  it.each(["Enter", "blur"])("persists the title with the editor session on %s without changing nodes", async (action) => {
    await mount();
    const before = structuredClone(state.server);
    const input = await enterTitle("  产品创作画布  ");
    await act(async () => {
      if (action === "blur") input.blur();
      else Simulate.keyDown(input, { key: "Enter" });
    });
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/metadata"));
    expect(call?.[1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ title: "产品创作画布" }) });
    expect(call?.[1]?.headers).toMatchObject({ "X-Canvas-Session-Id": "session" });
    expect(document.title).toBe("产品创作画布");
    expect(state.server).toEqual(before);
    expect(state.mutationCalls).toBe(0);
  });

  it.each(["Escape", "empty"])("keeps the original title for %s", async (action) => {
    await mount();
    const input = await enterTitle(action === "empty" ? "   " : "取消的修改");
    await act(async () => {
      if (action === "empty") input.blur();
      else Simulate.keyDown(input, { key: "Escape" });
    });
    expect(host.querySelector('[aria-label="编辑画布名称"]')?.textContent).toBe("保存验收");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/metadata"))).toBe(false);
  });

  it("does not save while confirming a Chinese input composition", async () => {
    await mount();
    const input = await enterTitle("中文输入");
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })));
    expect(document.activeElement).toBe(input);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/metadata"))).toBe(false);
  });
});

describe("canvas save barrier before generation", () => {
  it("loads data while the session is pending, but exposes editing only after the lease is granted", async () => {
    let grant!: () => void;
    state.sessionWait = new Promise(resolve => { grant = resolve; });
    await act(async () => root.render(queries.wrap(React.createElement(CanvasEditorPage, { canvasId: 57 }))));
    expect(state.bootstrapStarted).toBe(true);
    expect(state.board).toBeNull();
    await act(async () => grant());
    expect(state.board.initial.nodes).toHaveLength(1);
    expect(state.board.editorSessionId).toBe("session");
    expect(state.mutationCalls).toBe(0);
  });
  it("saves and permits generation on HTTP without crypto.randomUUID", async () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    await mount();
    const next = initial(); next.nodes[0].position.x = 120;
    await edit(next); await advance(300);
    expect(host.textContent).toContain("已保存");
    expect(state.server).toEqual(next);
    await expect(prepare()).resolves.toBe("2");
    expect(state.mutationCalls).toBe(1);
  });

  it("accepts an acknowledged save even when patching changes field insertion order", async () => {
    await mount();
    const next = initial();
    // Model normalization adds these fields in UI order; patches sort new data keys.
    next.nodes[0].data = { ...next.nodes[0].data, ratio: "16:9", duration: 5, resolution: "720p" } as any;
    await edit(next); await advance(300);
    expect(state.server).toEqual(next);
    expect(JSON.stringify(state.server)).not.toBe(JSON.stringify(next));
    expect(host.textContent).toContain("已保存");
    await expect(prepare()).resolves.toBe("2");
    expect(state.mutationCalls).toBe(1);
  });

  it("does not treat group render order or viewport changes as unsaved document edits", async () => {
    state.server.nodes.push({ id: "group", type: "group", position: { x: -80, y: -100 }, data: { kind: "group", title: "分组", collapsed: false } });
    await mount();
    const next = structuredClone(state.server); next.nodes.reverse(); next.viewport = { x: 800, y: 300, zoom: .1 };
    await edit(next);
    await expect(prepare()).resolves.toBe("1");
    expect(state.mutationCalls).toBe(0);
  });

  it("persists camera movement without graph comparison or feeding a new initial document back into the board", async () => {
    await mount();
    const initialDocument = state.board.initial;
    const compare = vi.spyOn(documentDiff, "diffCanvasDocumentsToOperations");
    for (let i = 1; i <= 5; i++) {
      await edit({ ...initialDocument, viewport: { x: i * 100, y: -i * 80, zoom: .5 } });
      await advance(300);
    }
    expect(compare).not.toHaveBeenCalled();
    expect(state.board.initial).toBe(initialDocument);
    expect(readCanvasViewportPreference(localStorage, 1, 57)).toEqual({ x: 500, y: -400, zoom: .5 });
    expect(state.mutationCalls).toBe(0);
  });

  it("does not drop a pending graph edit when the camera moves before autosave", async () => {
    await mount();
    const next = initial(); next.nodes[0].position.x = 120;
    await edit(next);
    await edit({ ...next, viewport: { x: 300, y: -80, zoom: .2 } });
    await advance(300);
    expect(state.server.nodes[0].position.x).toBe(120);
    expect(state.mutationCalls).toBe(1);
    await expect(prepare()).resolves.toBe("2");
  });

  it("saves settings even when nodes and edges keep the same references", async () => {
    await mount();
    const next = { ...state.board.initial, settings: { snapToGrid: true, gridSize: 24 } };
    await edit(next); await advance(300);
    expect(state.server.settings).toEqual(next.settings);
    expect(state.mutationCalls).toBe(1);
  });

  it("waits for the current request and then saves newer edits before permitting a run", async () => {
    await mount();
    let finish!: (value: Response) => void;
    state.send = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockResolvedValue(response());
    const first = initial(); first.nodes[0].position = { x: 100, y: 0 };
    await edit(first); await advance(300);
    const latest = structuredClone(first); latest.nodes[0].position.x = 200;
    await edit(latest);
    await act(async () => {
      let done = false; const run = state.board.onBeforeServerRun().then((value: string) => { done = true; return value; });
      await vi.advanceTimersByTimeAsync(25); expect(done).toBe(false);
      finish(response()); await vi.advanceTimersByTimeAsync(25);
      expect(await run).toBe("3"); expect(state.server).toEqual(latest);
    });
  });

  it("flushes a failed draft even when the user reverted to the last saved document", async () => {
    await mount();
    state.send = async () => new Response(JSON.stringify({ success: false, error: "暂时断网" }), { status: 503 });
    const next = initial(); next.nodes[0].position.x = 300;
    await edit(next); await advance(300); expect(state.records.size).toBe(1);
    state.send = null; await edit(initial());
    await expect(prepare()).resolves.toBe("3");
    expect(state.records.size).toBe(0); expect(state.server).toEqual(initial());
  });

  it("blocks generation on a real save failure and reports its cause", async () => {
    await mount();
    state.send = async () => new Response(JSON.stringify({ success: false, error: "保存服务暂时不可用", code: "SAVE_UNAVAILABLE" }), { status: 503 });
    const next = initial(); next.nodes[0].position.x = 300;
    await edit(next);
    await expect(prepare()).rejects.toThrow("保存服务暂时不可用");
    expect(state.records.size).toBe(1); expect(state.server.nodes[0].position.x).toBe(0);
  });
});


async function workflowZip(document: unknown) {
  const JSZip = (await import("jszip")).default;
  const bytes = await new JSZip().file("workflow.json", JSON.stringify(document)).generateAsync({ type: "uint8array" });
  return Object.assign(new NodeBlob([bytes]), { name: "workflow.zip" }) as unknown as File;
}

describe("workflow import persists the resulting canvas", () => {
  beforeEach(() => { vi.useRealTimers(); vi.stubGlobal("requestAnimationFrame", () => 0); vi.stubGlobal("cancelAnimationFrame", () => {}); vi.stubGlobal("Blob", NodeBlob); });
  it.each(["append", "replace"])("saves %s imports and reports success only after acknowledgement", async mode => {
    await mount();
    await act(async () => state.board.onOpenWorkflow([]));
    const imported = { ...createEmptyCanvasDocumentV2(), nodes: [{ id: "new", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "导入内容" } }] };
    const file = await workflowZip(imported);
    await act(async () => state.workflow.onImport(file, mode));
    expect(state.server.nodes).toHaveLength(mode === "append" ? 2 : 1);
    expect(state.server.nodes.some((node: any) => node.data.text === "导入内容")).toBe(true);
    expect(state.server.nodes.some((node: any) => node.id === "video")).toBe(mode === "append");
    expect(host.textContent).toContain("已保存");
    expect(state.mutationCalls).toBe(1);
  });
  it("keeps the existing canvas unchanged when parsing fails", async () => {
    await mount();
    await act(async () => state.board.onOpenWorkflow([]));
    const before = structuredClone(state.server);
    await expect(state.workflow.onImport(await workflowZip({}), "replace")).rejects.toThrow("V2");
    expect(state.server).toEqual(before);
    expect(state.mutationCalls).toBe(0);
  });
  it("reports a save failure without claiming the workflow was persisted", async () => {
    await mount();
    await act(async () => state.board.onOpenWorkflow([]));
    state.send = async () => new Response(JSON.stringify({ error: "offline" }), { status: 500 });
    await act(async () => {
      await expect(state.workflow.onImport(await workflowZip(createEmptyCanvasDocumentV2()), "replace")).rejects.toThrow("不要重复导入");
    });
    expect(host.textContent).toContain("offline");
    expect(host.textContent).not.toContain("已保存");
  });
});


describe("workflow exports use the current editor document", () => {
  it("downloads selected and full ZIP, and sends the selected flow to the library", async () => {
    vi.useRealTimers(); vi.stubGlobal("requestAnimationFrame", () => 0); vi.stubGlobal("cancelAnimationFrame", () => {});
    await mount();
    const edited = initial();
    edited.nodes.push({ id: "prompt", type: "prompt", position: { x: 10, y: 20 }, data: { kind: "prompt", text: "最新内容" } });
    await edit(edited);
    await act(async () => state.board.onOpenWorkflow(["prompt"]));
    const downloads: NodeBlob[] = [];
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("URL", class extends URL { static createObjectURL(blob: any) { downloads.push(blob); return "blob:test"; } static revokeObjectURL() {} });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await act(async () => state.workflow.onExport("selected", "zip"));
    await act(async () => state.workflow.onExport("full", "zip"));
    const JSZip = (await import("jszip")).default;
    const selected = await JSZip.loadAsync(await downloads[0].arrayBuffer());
    const full = await JSZip.loadAsync(await downloads[1].arrayBuffer());
    expect(JSON.parse(await selected.file("workflow.json")!.async("string")).nodes).toHaveLength(1);
    expect(JSON.parse(await full.file("workflow.json")!.async("string")).nodes).toHaveLength(2);
    await act(async () => state.workflow.onExport("selected", "library"));
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/canvas/library/workflows")!;
    expect(JSON.parse(String(call[1]?.body)).document.nodes.map((node: any) => node.id)).toEqual(["prompt"]);
  });
});
