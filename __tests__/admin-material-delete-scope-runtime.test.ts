/** @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts */
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/hooks/use-auto-paginate", () => ({ useAutoPaginate: () => ({ loading: false }) }));
vi.mock("@/components/ui/date-range-picker", () => ({ DateRangePicker: () => null }));
vi.mock("@/components/ui/media-lightbox", () => ({ MediaLightbox: () => null }));
vi.mock("@/components/ui/hover-preview-video", () => ({ HoverPreviewVideo: () => null }));
vi.mock("@/components/ui/resilient-image", () => ({ ResilientImage: () => null, warmResilientImageCandidatesBatch: vi.fn() }));
vi.mock("@/components/ui/suggest-select", () => ({ SuggestSelect: () => null }));
import AdminMaterialAssetsPage from "@/app/admin/material-assets/page";
let root: Root; let host: HTMLDivElement; let fetchMock: ReturnType<typeof vi.fn>;
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
const response = (total: number) => ({ ok: true, json: async () => ({ items: [], categories: ["净化器", "按摩椅"], pagination: { page: 1, pageSize: 60, total, totalPages: 1, hasMore: false } }) });
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: () => undefined }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo); else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo"); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === label)!;

describe("material filtered deletion scope", () => {
  it("waits for the current filter count and states the same scope in confirmation", async () => {
    let resolve!: (value: unknown) => void;
    fetchMock.mockResolvedValueOnce(response(95)).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await act(async () => root.render(React.createElement(AdminMaterialAssetsPage)));
    expect(button("删除筛选结果 95 项").disabled).toBe(false);
    await act(async () => button("净化器").click());
    expect(button("删除筛选结果").disabled).toBe(true); expect(button("删除筛选结果 95 项")).toBeUndefined();
    await act(async () => resolve(response(30)));
    await act(async () => button("删除筛选结果 30 项").click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("当前筛选条件下的全部 30 个素材");
    expect(button("删除 30 项")).toBeDefined();
    await act(async () => button("取消").click());
    expect(fetchMock.mock.calls.every(([, options]) => options?.method !== "DELETE")).toBe(true);
  });
  it("does not let an older response overwrite a newer filter or enable deletion after load failure", async () => {
    let finishOld!: (value: unknown) => void;
    fetchMock.mockResolvedValueOnce(response(95)).mockReturnValueOnce(new Promise((done) => { finishOld = done; })).mockResolvedValueOnce(response(63)).mockRejectedValueOnce(new Error("筛选加载失败"));
    await act(async () => root.render(React.createElement(AdminMaterialAssetsPage)));
    await act(async () => button("净化器").click());
    await act(async () => button("按摩椅").click());
    expect(button("删除筛选结果 63 项").disabled).toBe(false);
    await act(async () => finishOld(response(30)));
    expect(button("删除筛选结果 63 项").disabled).toBe(false);
    await act(async () => button("净化器").click());
    expect(button("删除筛选结果").disabled).toBe(true);
    expect(host.textContent).toContain("筛选加载失败");
  });
});
