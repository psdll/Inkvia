/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const counts = vi.hoisted(() => ({ image: 0, video: 0, history: 0 }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("tool=image") }));
vi.mock("next/dynamic", () => ({ default: (loader: () => Promise<any>) => {
  const Lazy = React.lazy(loader); return (props: any) => React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props));
} }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: 1 }, loading: false }) }));
vi.mock("@/app/image/image-tool", () => ({ default: ({ onInitialReady, sharedHistory }: any) => {
  React.useEffect(() => { counts.image++; onInitialReady(); }, []);
  return React.createElement("div", null, React.createElement("input", { "aria-label": "测试草稿", defaultValue: "保留图片草稿" }), React.createElement("button", { onClick: () => sharedHistory.setHistoryFocusId("pending-image") }, "模拟提交任务"));
} }));
vi.mock("@/app/video/video-tool", () => ({ default: ({ onInitialReady }: any) => { React.useEffect(() => { counts.video++; onInitialReady(); }, []); return React.createElement("div", null, "视频表单"); } }));

vi.mock("@/components/history/unified-history-panel", () => ({ UnifiedHistoryPanel: React.forwardRef(({ onInitialReady, onItemCountChange, focusId }: any, ref) => {
  React.useEffect(() => { counts.history++; onInitialReady(); onItemCountChange(2); }, []);
  React.useImperativeHandle(ref, () => ({}));
  return React.createElement("div", { "data-test-history": true }, `任务结果 ${focusId || "existing"}`);
}) }));
vi.mock("@/components/history/unified-history-actions", () => ({ UnifiedHistoryActions: () => null }));
vi.mock("@/components/media-library/media-library-panel", () => ({ MediaLibraryPanel: () => null }));
import StudioPage from "@/app/studio/page";
let root: Root; let host: HTMLDivElement;
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
let listener: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); counts.image = counts.video = counts.history = 0;
  localStorage.clear(); window.history.replaceState(null, "", "/studio?tool=image");
  media = { matches: false, addEventListener: vi.fn((_event, cb) => { listener = cb; }), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (label: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === label)!;

describe("compact creation workspace", () => {
  it("exposes tasks and preserves the draft and result DOM when switching views", async () => {
    await act(async () => root.render(React.createElement(StudioPage)));
    const input = host.querySelector("input")!; const history = host.querySelector("[data-test-history]")!;
    const tasks = host.querySelector("#studio-tasks-pane")!;
    expect(tasks.getAttribute("aria-hidden")).toBe("true");
    input.value = "继续编辑的草稿";
    await act(async () => button("任务 (2)").click());
    expect(tasks.hasAttribute("aria-hidden")).toBe(false);
    expect(host.querySelector("#studio-create-pane")?.getAttribute("aria-hidden")).toBe("true");
    await act(async () => button("创作").click());
    expect(host.querySelector("input")).toBe(input); expect(input.value).toBe("继续编辑的草稿");
    expect(host.querySelector("[data-test-history]")).toBe(history);
    expect(counts).toEqual({ image: 1, video: 0, history: 1 });
  });
  it("reveals the submitted task and retains desktop and collapsed-layout behavior", async () => {
    await act(async () => root.render(React.createElement(StudioPage)));
    await act(async () => button("模拟提交任务").click());
    expect(button("任务 (2)").getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("#studio-tasks-pane")?.hasAttribute("aria-hidden")).toBe(false);
    expect(host.textContent).toContain("pending-image");
    await act(async () => { media.matches = true; listener?.(); });
    expect(host.querySelector("#studio-create-pane")?.hasAttribute("aria-hidden")).toBe(false);
    expect(host.querySelector("#studio-tasks-pane")?.hasAttribute("aria-hidden")).toBe(false);
    await act(async () => (host.querySelector('[aria-label="收起工具区"]') as HTMLButtonElement).click());
    expect(host.querySelector("#studio-create-pane")?.getAttribute("aria-hidden")).toBe("true");
    await act(async () => { media.matches = false; listener?.(); button("创作").click(); });
    expect(host.querySelector("#studio-create-pane")?.hasAttribute("aria-hidden")).toBe(false);
    expect(host.querySelector("#studio-create-pane")?.className).not.toContain("pointer-events-none");
    expect(counts.history).toBe(1);
  });
});
