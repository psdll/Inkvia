import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: { id: 707, username: "test" } }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: state.user, openLoginModal: vi.fn() }) }));
vi.mock("@/components/ui/media-lightbox", () => ({ MediaLightbox: () => null }));
vi.mock("@/components/ui/hover-preview-video", () => ({ HoverPreviewVideo: () => null }));
vi.mock("@/components/ui/resilient-image", () => ({ ResilientImage: () => null, warmResilientImageCandidatesBatch: () => () => {} }));
import { MediaLibraryPanel } from "@/components/media-library/media-library-panel";

let host: HTMLDivElement, root: Root;
const close = vi.fn(), filePicker = vi.fn();
const uploads: FormData[] = [];
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === label || node.getAttribute("aria-label") === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); close.mockReset(); filePicker.mockReset(); uploads.length = 0;
  state.user = { id: state.user.id + 1, username: "test" };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url === "/api/media-library/folders"
    ? { folders: [{ id: "产品", name: "产品", parentId: null }] }
    : { items: [], groups: [], pagination: { page: 1, total: 0, pageSize: 5000, totalPages: 1, hasMore: false } } })));
  vi.stubGlobal("XMLHttpRequest", class {
    upload = {}; responseType = ""; response = { success: true }; status = 200; onload?: () => void;
    open() {} send(form: FormData) { uploads.push(form); this.onload?.(); }
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function(this: HTMLInputElement) { if (this.type === "file") filePicker(); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => root.render(React.createElement(MediaLibraryPanel, { open: true, onClose: close })));
  await click("我的");
}
it("removes the old group field and gates the native picker behind directory confirmation", async () => {
  await render();
  expect(document.querySelector('[aria-label="上传分组"]')).toBeNull();
  expect(document.querySelector('[aria-label="我的素材分类"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain("当前：");
  expect(document.querySelector("aside")).toBeNull();
  expect(button("全部").getAttribute("aria-pressed")).toBe("true");
  expect(button("未分类")).toBeUndefined();
  await click("上传私有素材");
  expect(filePicker).not.toHaveBeenCalled(); expect(button("确认").disabled).toBe(true);
  const dialog = document.querySelector('[role="dialog"]')!;
  await act(async () => dialog.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  expect(close).not.toHaveBeenCalled();
  const folder = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === "产品")!;
  await act(async () => folder.click()); await click("确认");
  expect(filePicker).toHaveBeenCalledOnce();
  expect(uploads).toHaveLength(0);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(["image"], "chair.png", { type: "image/png" });
  await act(async () => Simulate.change(input, { target: { files: [file] } } as any));
  expect(uploads).toHaveLength(1);
  expect(uploads[0].get("folderId")).toBe("产品"); expect(uploads[0].get("scope")).toBe("private");
  expect(close).not.toHaveBeenCalled();
});
it("cancelling directory selection never opens the file picker or starts an upload", async () => {
  await render(); await click("上传私有素材"); await click("取消");
  expect(filePicker).not.toHaveBeenCalled(); expect(uploads).toHaveLength(0); expect(close).not.toHaveBeenCalled();
});
it("reuses loaded folders across picker opens and panel remounts", async () => {
  await render();
  const requests = () => vi.mocked(fetch).mock.calls.filter(call => call[0] === "/api/media-library/folders").length;
  expect(requests()).toBe(1);
  await click("上传私有素材"); await click("取消"); await click("上传私有素材");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("产品");
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("加载中");
  expect(requests()).toBe(1);
  act(() => root.unmount()); root = createRoot(host);
  await render(); await click("上传私有素材");
  expect(requests()).toBe(1);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("产品");
});
it("keeps cached folders visible during stale refresh and isolates other users", async () => {
  await render();
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
  await act(async () => root.render(React.createElement(MediaLibraryPanel, { open: false, onClose: close })));
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, options) => url === "/api/media-library/folders" ? new Promise(() => {}) : originalFetch(url, options));
  await act(async () => root.render(React.createElement(MediaLibraryPanel, { open: true, onClose: close })));
  await click("上传私有素材");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("产品");
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("加载中");
  state.user = { id: state.user.id + 1, username: "other" };
  await act(async () => root.render(React.createElement(MediaLibraryPanel, { open: true, onClose: close })));
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("产品");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("加载中");
});
it("enters multi-select without adding the selection toolbar or empty batch actions", async () => {
  await render(); await click("多选");
  expect(button("完成")).toBeDefined();
  expect(document.body.textContent).not.toContain("多选模式:");
  expect(button("批量移动到文件夹")).toBeUndefined();
  expect(button("取消选择")).toBeUndefined();
});
it("keeps the shared library without personal directory controls", async () => {
  await act(async () => root.render(React.createElement(MediaLibraryPanel, { open: true, onClose: close })));
  expect(document.querySelector('[aria-label="我的素材分类"]')).toBeNull();
  expect(document.querySelector('[aria-label="上传私有素材"]')).toBeNull();
});
