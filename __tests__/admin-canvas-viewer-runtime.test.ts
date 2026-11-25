// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";
import { CanvasBootstrapError } from "@/lib/canvas/bootstrap-client";
import { readCanvasViewportPreference, writeCanvasViewportPreference } from "@/lib/canvas/viewport-preference";
const state = vi.hoisted(() => ({ loads: vi.fn(), props: null as any }));
vi.mock("@/lib/admin-canvas-cache", () => ({ peekAdminCanvas: () => undefined, loadAdminCanvas: state.loads }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/canvas/CanvasAppearance", () => ({ CanvasAppearance: ({ children }: any) => children }));
vi.mock("@/components/canvas/CanvasTitleBar", () => ({ CanvasTitleBar: ({ title }: any) => React.createElement("span", {}, title) }));
vi.mock("@/components/canvas/SmartCanvasBoard", () => ({ default: (props: any) => {
  state.props = props;
  return React.createElement("div", { "data-shared-board": true });
} }));
import UserCanvasViewer from "@/components/admin/UserCanvasViewer";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); window.localStorage.clear(); });
describe("admin adapter for the shared canvas", () => {
  it("uses the shared board without persistence or session callbacks and keeps it mounted on refresh", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const initial = createEmptyCanvasDocumentV2();
    state.loads.mockResolvedValue({ title: "A", revision: "1", document: initial });
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => { root.render(React.createElement(UserCanvasViewer, { adminKey: "auth:30", canvasId: 7, userName: "test", onBack() {} })); });
      expect(state.props).toMatchObject({ readOnly: true, preferenceOwnerId: -30, editorSessionId: "", initial });
      expect(state.props.onChange).toBeUndefined();
      expect(state.props.onUndoMediaRefsChange).toBeUndefined();
      await expect(state.props.onBeforeServerRun()).rejects.toThrow("不会修改");
      const board = host.querySelector("[data-shared-board]");
      const next = { ...initial, viewport: { x: 100, y: 30, zoom: 0.8 } };
      state.loads.mockResolvedValue({ title: "A", revision: "2", document: next });
      const refresh = [...host.querySelectorAll("button")].find(button => button.textContent === "刷新")!;
      await act(async () => refresh.click());
      expect(host.querySelector("[data-shared-board]")).toBe(board);
      expect(state.props.initial).toBe(next);
      expect(state.loads).toHaveBeenLastCalledWith("auth:30", 7, true);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
  it("restores only the observer's viewport and retains the board after a transient refresh error", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const document = createEmptyCanvasDocumentV2();
    document.nodes = [{ id: "audio", type: "audio", position: { x: 0, y: 0 }, width: 600, height: 400, data: { kind: "audio", url: "/audio.mp3" } }];
    const viewport = { x: 80, y: 40, zoom: .6 };
    writeCanvasViewportPreference(window.localStorage, -30, 7, viewport);
    writeCanvasViewportPreference(window.localStorage, 30, 7, { x: 1, y: 2, zoom: 1 });
    state.loads.mockResolvedValue({ title: "A", revision: "1", document });
    const host = window.document.createElement("div"); window.document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(React.createElement(UserCanvasViewer, { adminKey: "auth:30", canvasId: 7, userName: "test", onBack() {} })));
      expect(state.props.initial.viewport).toEqual(viewport);
      expect(state.props.initial.nodes[0]).toMatchObject({ width: 420, height: 200 });
      expect(document.nodes[0]).toMatchObject({ width: 600, height: 400 });
      await act(async () => state.props.onViewportCommit({ x: 160, y: 40, zoom: .8 }));
      expect(readCanvasViewportPreference(window.localStorage, -30, 7)).toEqual({ x: 160, y: 40, zoom: .8 });
      expect(readCanvasViewportPreference(window.localStorage, 30, 7)).toEqual({ x: 1, y: 2, zoom: 1 });
      const board = host.querySelector("[data-shared-board]");
      state.loads.mockRejectedValue(new Error("offline"));
      await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "刷新")!.click());
      expect(host.querySelector("[data-shared-board]")).toBe(board);
      expect(host.querySelector('[role="alert"]')?.textContent).toBe("offline");
      state.loads.mockRejectedValue(new CanvasBootstrapError("UNAUTHORIZED", "expired", 401));
      await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "刷新")!.click());
      expect(host.querySelector("[data-shared-board]")).toBeNull();
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
