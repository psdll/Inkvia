// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import Panel from "@/components/canvas/CanvasWorkflowPanel";
import Library from "@/components/canvas/CanvasLibraryPanel";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: 27 } }) }));
vi.mock("@/components/ui/frosted-select", () => ({ FrostedSelect: ({ value, onChange, options }: any) =>
  React.createElement("select", { value, onChange: (event: any) => onChange(event.target.value) }, options.map((option: any) => React.createElement("option", { key: option.value, value: option.value }, option.label))) }));

describe("workflow panel controls", () => {
  let root: Root, host: HTMLDivElement;
  const onExport = vi.fn(), onImport = vi.fn(), onClose = vi.fn();
  const render = async (selectedCount = 2) => act(async () => root.render(React.createElement(Panel, { selectedCount, totalCount: 3, onExport, onImport, onClose })));
  const button = (label: string) => [...host.querySelectorAll("button")].find(button => button.textContent === label)!;
  beforeEach(() => {
  window.localStorage.clear(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("anchors above the workflow trigger, stays inside the canvas, and explains empty-canvas actions", async () => {
    const anchor = document.createElement("button");
    document.body.append(anchor);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return (this === anchor ? { left: 880, top: 740, width: 38, bottom: 778 }
        : this.id === "canvas-workflow-panel" ? { width: 420 }
          : { left: 0, bottom: 800, width: 1000 }) as DOMRect;
    });
    await act(async () => root.render(React.createElement(Panel, { selectedCount: 0, totalCount: 0, anchorRef: { current: anchor }, onExport, onImport, onClose })));
    const panel = host.querySelector<HTMLElement>("aside")!;
    expect(panel.style.bottom).toBe("76px");
    expect(panel.style.left).toBe("778px");
    expect(host.textContent).not.toContain("选中导出暂不可用");
    expect(host.textContent).toContain("整图导出暂不可用");
    for (const label of ["选中 ZIP", "导出到产物库", "整图 ZIP"]) expect(button(label).disabled).toBe(true);
    expect(button("选中 ZIP").title).toBe("请先在画布选中节点");
    expect(button("整图 ZIP").title).toBe("画布暂无节点");
    expect([...host.querySelectorAll("button")].find(item => item.textContent?.includes("拖入"))!.disabled).toBe(false);
    anchor.remove();
  });

  it("routes every export button to the correct scope and format, and updates selection availability", async () => {
    await render(0);
    expect(host.textContent).not.toContain("JSON");
    expect(button("选中 ZIP").disabled).toBe(true);
    expect(button("导出到产物库").disabled).toBe(true);
    expect(button("整图 ZIP").disabled).toBe(false);
    await render(2);
    for (const [label, scope, format] of [["选中 ZIP", "selected", "zip"], ["导出到产物库", "selected", "library"], ["整图 ZIP", "full", "zip"]]) {
      await act(async () => button(label).click());
      expect(onExport).toHaveBeenLastCalledWith(scope, format);
    }
    expect(onExport).toHaveBeenCalledTimes(3);
  });

  it("allows closing and keeps a reopened panel locked while its parent transfer runs", async () => {
    const props = { selectedCount: 2, totalCount: 3, onExport, onImport, onClose, transferBusy: true };
    await act(async () => root.render(React.createElement(Panel, props)));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭工作流面板"]')!.click());
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    await act(async () => root.render(React.createElement(Panel, props)));
    expect(button("整图 ZIP").disabled).toBe(true);
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [new File(["zip"], "workflow.zip")] } });
    await act(async () => button("拖入或选择 ZIP 工作流").dispatchEvent(drop));
    expect(onImport).not.toHaveBeenCalled();
    await act(async () => root.render(React.createElement(Panel, { ...props, transferBusy: false })));
    expect(button("整图 ZIP").disabled).toBe(false);
  });

  it("imports via file choice with the current append/replace mode and displays errors", async () => {
    await render();
    const input = host.querySelector("input")!;
    expect(input.accept).toBe(".zip,application/zip");
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [new File(["{}"], "old.json")] } });
    await act(async () => button("拖入或选择 ZIP 工作流").dispatchEvent(drop));
    expect(onImport).not.toHaveBeenCalled();
    expect(host.textContent).toContain("请选择 ZIP 工作流文件");
    const file = new File(["{}"], "workflow.zip");
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onImport).toHaveBeenLastCalledWith(file, "append");
    const select = host.querySelector("select")!;
    await act(async () => { select.value = "replace"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.textContent).toContain("替换当前画布内容");
    onImport.mockRejectedValueOnce(new Error("素材上传失败"));
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onImport).toHaveBeenLastCalledWith(file, "replace");
    expect(host.textContent).toContain("素材上传失败");
    expect(host.textContent).not.toContain("已替换当前画布");
  });

  it("blocks duplicate operations including drops while a transfer is pending", async () => {
    let finish!: () => void;
    onExport.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await render();
    await act(async () => button("选中 ZIP").click());
    const target = [...host.querySelectorAll("button")].find(item => item.textContent?.includes("拖入"))!;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [new File(["{}"], "workflow.zip")] } });
    await act(async () => target.dispatchEvent(event));
    expect(onImport).not.toHaveBeenCalled();
    expect(host.textContent).toContain("正在处理");
    await act(async () => finish());
    expect(button("选中 ZIP").disabled).toBe(false);
  });

  it("remembers the active library tab separately for each canvas and user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ library: { version: 1, folders: [], items: [] } }))));
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const show = (ownerId: number, canvasId: number) => act(async () => root.render(
      React.createElement(QueryClientProvider, { client: cache }, React.createElement(Library, { key: `${ownerId}:${canvasId}`, ownerId, canvasId, nodes: [], onClose, onLocateNode: vi.fn() }))));
    await show(27, 1);
    await act(async () => button("素材库").click());
    await act(async () => root.render(null)); await show(27, 1);
    expect(host.textContent).toContain("个人素材库");
    await show(27, 2);
    expect(host.textContent).toContain("当前画布还没有");
    await show(28, 1);
    expect(host.textContent).toContain("当前画布还没有");
    await show(27, 1);
    expect(host.textContent).toContain("个人素材库");
    await act(async () => root.render(null)); cache.clear();
  });

  it("returns a saved workflow-library tab to current materials without fetching workflows", async () => {
    localStorage.setItem("canvas_library_position_v1_27_1_panel", JSON.stringify({ view: "workflow", query: "old workflow", mediaFilter: "all" }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const cache = new QueryClient();
    await act(async () => root.render(React.createElement(QueryClientProvider, { client: cache },
      React.createElement(Library, { canvasId: 1, ownerId: 27, nodes: [], onClose, onLocateNode: vi.fn() }))));
    expect(host.textContent).toContain("当前画布还没有");
    expect(host.textContent).not.toContain("工作流");
    expect(host.querySelector("input")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => root.render(null));
    cache.clear();
  });
});
