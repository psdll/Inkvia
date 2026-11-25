// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { describe, it, expect, vi } from "vitest";
vi.mock("@/components/canvas/CanvasNodeCard", async () => ({ CanvasNodeEditorContext: (await import("react")).createContext(null) }));
import { CanvasNodeEditorContext, type NodeEditor } from "@/components/canvas/CanvasNodeCard";
import { createCanvasNodeEditorStore, CanvasNodeSubscription, CanvasNodeSubscriptionsProvider } from "@/components/canvas/CanvasNodeSubscriptions";

import { CanvasVideoSeparateButton } from "@/components/canvas/CanvasVideoSeparateButton";
import type { CanvasVideoSeparationJob } from "@/lib/canvas/video-separation";

const editor = (target: string | null, runNode = vi.fn()) => ({
  isPanelVisible: () => false, isTaskPanelVisible: () => false, isGroupSelected: () => false,
  connectionInProgress: true, connectionFeedbackTarget: target ? { nodeId: target, state: "valid" } : null, runNode,
} as unknown as NodeEditor);

describe("per-node editor subscriptions", () => {
  it("delivers focus playback only to its node and preserves repeated requests", () => {
    const store = createCanvasNodeEditorStore(editor(null));
    const a = vi.fn(), b = vi.fn();
    store.getSnapshot("a"); store.getSnapshot("b");
    store.subscribe("a", a); store.subscribe("b", b);
    const request = { nodeId: "a", src: "/video.mp4", revision: 1 };
    store.update({ ...editor(null), videoFocusRequest: request } as any);
    expect(a).toHaveBeenCalledOnce(); expect(b).not.toHaveBeenCalled();
    expect((store.getSnapshot("a") as any).videoFocusRequest).toBe(request);
    store.update({ ...editor(null), videoFocusRequest: { ...request, revision: 2 } } as any);
    expect(a).toHaveBeenCalledTimes(2); expect(b).not.toHaveBeenCalled();
  });
  it("notifies only A/B when the candidate moves; retained callbacks invoke the current action", () => {
    const oldRun = vi.fn(), newRun = vi.fn();
    const store = createCanvasNodeEditorStore(editor("a", oldRun));
    const snapshots = ["a", "b", "c"].map(id => store.getSnapshot(id));
    const updates = [vi.fn(), vi.fn(), vi.fn()];
    const stops = updates.map((notify, i) => store.subscribe(["a", "b", "c"][i], notify));
    store.update(editor("b", newRun));
    expect(updates.map(fn => fn.mock.calls.length)).toEqual([1, 1, 0]);
    expect(store.getSnapshot("c")).toBe(snapshots[2]);
    snapshots[2].runNode("c");
    expect(newRun).toHaveBeenCalledWith("c"); expect(oldRun).not.toHaveBeenCalled();
    stops.forEach(stop => stop());
    store.update(editor(null));
    expect(updates.map(fn => fn.mock.calls.length)).toEqual([1, 1, 0]);
  });

  it("hands every node the board's 拉片 models and refreshes them when the list changes", () => {
    const models = [{ providerId: "volcengine", modelId: "doubao-seed-evolving", label: "Doubao" }];
    const store = createCanvasNodeEditorStore({ ...editor(null), breakdownModels: [] } as NodeEditor);
    const notify = vi.fn();
    store.getSnapshot("a"); store.subscribe("a", notify);
    store.update({ ...editor(null), breakdownModels: models } as NodeEditor);
    expect(notify).toHaveBeenCalledOnce();
    expect(store.getSnapshot("a").breakdownModels).toBe(models);
    const snapshot = store.getSnapshot("a");
    store.update({ ...editor(null), breakdownModels: models } as NodeEditor);
    expect(store.getSnapshot("a")).toBe(snapshot);
  });

  it("keeps unrelated React consumers mounted without a render on candidate changes", () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"), root = createRoot(host);
    const renders = { a: 0, b: 0, c: 0 };
    function Consumer({ id }: { id: keyof typeof renders }) {
      renders[id]++;
      const value = React.useContext(CanvasNodeEditorContext);
      return React.createElement("span", { "data-id": id }, value?.connectionFeedbackTarget?.state ?? "idle");
    }
    const children = (["a", "b", "c"] as const).map(id => React.createElement(CanvasNodeSubscription, { id, key: id, children: React.createElement(Consumer, { id }) }));
    try {
      act(() => root.render(React.createElement(CanvasNodeSubscriptionsProvider, { editor: editor("a"), revision: 1, children })));
      const before = { ...renders };
      act(() => root.render(React.createElement(CanvasNodeSubscriptionsProvider, { editor: editor("b"), revision: 2, children })));
      expect(renders.c).toBe(before.c);
      expect(renders.a).toBe(before.a + 1); expect(renders.b).toBe(before.b + 1);
      expect(host.querySelector('[data-id="a"]')?.textContent).toBe("idle");
      expect(host.querySelector('[data-id="b"]')?.textContent).toBe("valid");
    } finally { act(() => root.unmount()); }
  });
});


describe("video separation through the real node subscription", () => {
  it("delivers progress and failures only to the affected node, including hidden panels", () => {
    const store = createCanvasNodeEditorStore(editor(null));
    const beforeB = store.getSnapshot("b"), notifyA = vi.fn(), notifyB = vi.fn();
    store.getSnapshot("a"); store.subscribe("a", notifyA); store.subscribe("b", notifyB);
    const update = (job: CanvasVideoSeparationJob) => {
      store.update({ ...editor(null), videoSeparationJobs: { a: job } });
      expect(store.getSnapshot("a").videoSeparationJobs?.a).toBe(job);
      expect(store.getSnapshot("b")).toBe(beforeB);
    };
    update({ mode: "vocals", status: "running", progress: 0 });
    update({ mode: "vocals", status: "running", progress: .5 });
    update({ mode: "vocals", status: "error", progress: 0, error: "模型提取失败" });
    expect(notifyA).toHaveBeenCalledTimes(3); expect(notifyB).not.toHaveBeenCalled();
  });

  it.each(["tracks", "vocals", "background"] as const)("shows running and error feedback for %s after closing and reopening the toolbar", async mode => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"), root = createRoot(host);
    let setJob!: React.Dispatch<React.SetStateAction<CanvasVideoSeparationJob | undefined>>;
    let togglePanel!: React.Dispatch<React.SetStateAction<boolean>>;
    let finish!: () => void;
    const onSeparate = vi.fn(() => {
      setJob({ mode, status: "running", progress: .5 });
      return new Promise<void>(resolve => { finish = resolve; });
    });
    function Button() {
      const value = React.useContext(CanvasNodeEditorContext)!;
      return React.createElement(CanvasVideoSeparateButton, { job: value.videoSeparationJobs?.a, onSeparate: () => value.separateVideo!("a", "/source.mp4") });
    }
    function Harness() {
      const [job, updateJob] = React.useState<CanvasVideoSeparationJob>(); setJob = updateJob;
      const [visible, updateVisible] = React.useState(true); togglePanel = updateVisible;
      return React.createElement(CanvasNodeSubscriptionsProvider, {
        editor: { ...editor(null), separateVideo: onSeparate, videoSeparationJobs: job ? { a: job } : {} }, revision: 1,
        children: visible ? React.createElement(CanvasNodeSubscription, { id: "a", children: React.createElement(Button) }) : null,
      });
    }
    try {
      act(() => root.render(React.createElement(Harness)));
      act(() => host.querySelector<HTMLButtonElement>('button')!.click());
      await act(async () => host.querySelectorAll<HTMLButtonElement>('button')[1].click());
      expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
      expect(host.textContent).toContain(mode === "tracks" ? "分离中 50%" : "提取中");
      act(() => togglePanel(false)); act(() => togglePanel(true));
      expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
      await act(async () => { finish(); setJob({ mode, status: "error", progress: 0, error: "模型提取失败" }); });
      expect(host.querySelector('[role="alert"]')?.textContent).toBe("模型提取失败");
      expect(host.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
      act(() => setJob({ mode, status: "success", progress: 1 }));
      expect(host.querySelector('[role="alert"]')).toBeNull();
    } finally { act(() => root.unmount()); }
  });
});
