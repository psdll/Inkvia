// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProductFolderPicker, ProductFolderNavigation } from "@/components/media-library/product-folder-picker";
import { productFolders } from "@/lib/media-library-folders";
import { MEDIA_LIBRARY_UNGROUPED } from "@/lib/media-library";
vi.mock("@/components/ui/media-image", () => ({ MediaImage: ({ src }: { src: string }) => React.createElement("img", { src, alt: "" }) }));

let root: Root, host: HTMLDivElement;
const confirm = vi.fn(), close = vi.fn(), changed = vi.fn(), fetchMock = vi.fn();
const folders = productFolders(["产品/S790", "场景"]);
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === text || node.getAttribute("aria-label") === text)!;
const click = async (text: string) => { await act(async () => button(text).click()); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  confirm.mockReset(); close.mockReset(); changed.mockReset(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [], pagination: { hasMore: false } }) });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(props = {}) {
  await act(async () => root.render(React.createElement(ProductFolderPicker, { open: true, folders, onConfirm: confirm, onClose: close, onChanged: changed, ...props })));
}
it("requires an explicit directory selection, including unclassified, and cancellation uploads nothing", async () => {
  await render(); expect(button("确认").disabled).toBe(true);
  await click("未分类"); expect(button("确认").disabled).toBe(false);
  await click("确认"); expect(confirm).toHaveBeenCalledWith(MEDIA_LIBRARY_UNGROUPED);
  confirm.mockClear(); await click("取消"); expect(close).toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled();
});
it("keeps existing directory paths selectable and previews their materials", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: 1, title: "产品正面", kind: "image", fileUrl: "/chair.jpg" }], pagination: { hasMore: false } }) });
  await render(); await click("产品/S790");
  const query = new URL(fetchMock.mock.calls[0][0], "http://localhost").searchParams;
  expect(query.get("scope")).toBe("private"); expect(query.get("groupName")).toBe("产品/S790");
  const preview = document.querySelector('[aria-label="文件夹内素材"]')!;
  expect(preview.textContent).toContain("产品正面"); expect(preview.querySelector("img")?.getAttribute("src")).toBe("/chair.jpg");
  expect(preview.textContent).not.toContain("子文件夹");
  await click("确认");
  expect(confirm).toHaveBeenCalledWith("产品/S790");
});
it("expands and collapses by clicking the directory row, including empty directories", async () => {
  await render();
  await click("产品"); expect(document.querySelector('[aria-label="文件夹内素材"]')).not.toBeNull();
  expect(button("产品").getAttribute("aria-expanded")).toBe("true");
  await click("产品"); expect(document.querySelector('[aria-label="文件夹内素材"]')).toBeNull();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  await click("展开场景");
  expect(document.body.textContent).toContain("暂无素材");
  await click("收起场景");
  expect(document.body.textContent).not.toContain("暂无素材");
  expect(confirm).not.toHaveBeenCalled();
});
it("creates a peer folder even with a folder selected before separate upload confirmation", async () => {
  const nextFolders = productFolders(["产品/S790", "细节", "场景"]);
  fetchMock.mockImplementation(async (_url, options) => ({ ok: true, json: async () => options?.method === "POST" ? { folders: nextFolders, destination: "细节" } : { items: [] } }));
  await render(); await click("产品"); await click("新建文件夹");
  await act(async () => Simulate.change(document.querySelector<HTMLInputElement>('[aria-label="新文件夹名称"]')!, { target: { value: "细节" } } as any));
  await click("新建并选择");
  expect(JSON.parse(fetchMock.mock.calls.find(call => call[1]?.method === "POST")![1].body)).toEqual({ operation: "create", name: "细节", parentId: null });
  expect(changed).toHaveBeenCalledWith(nextFolders); expect(confirm).not.toHaveBeenCalled();
  await click("确认"); expect(confirm).toHaveBeenCalledWith("细节");
});
it("keeps the picker open on failed creation or move and reports the error", async () => {
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "此位置已有同名文件夹" }) });
  await render(); await click("新建文件夹");
  await act(async () => Simulate.change(document.querySelector<HTMLInputElement>('[aria-label="新文件夹名称"]')!, { target: { value: "产品" } } as any));
  await click("新建并选择");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("同名"); expect(confirm).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});
it("blocks confirmation while loading or when directory loading fails", async () => {
  await render({ loading: true }); expect(button("确认").disabled).toBe(true);
  await render({ error: "目录加载失败" }); await click("未分类"); expect(button("确认").disabled).toBe(true);
});
it("loads more materials and retries failed pages without losing previous results", async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 1, title: "第一张", kind: "image", fileUrl: "/one.jpg" }], pagination: { hasMore: true } }) })
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "网络错误" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 2, title: "视频素材", kind: "video", fileUrl: "/two.mp4" }], pagination: { hasMore: false } }) });
  await render(); await click("展开场景"); await click("加载更多素材");
  expect(document.body.textContent).toContain("网络错误"); expect(document.body.textContent).toContain("第一张");
  expect(document.body.textContent).not.toContain("暂无素材");
  await click("重试"); expect(document.body.textContent).toContain("视频素材");
  expect(new URL(fetchMock.mock.calls[2][0], "http://localhost").searchParams.get("page")).toBe("2");
  expect(document.querySelector("video")).toBeNull(); expect(button("加载更多素材")).toBeUndefined();
});
it("asks before deleting a subtree and refreshes the remaining directory list", async () => {
  const select = vi.fn();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ folders: productFolders(["场景"]), destination: null }) });
  await act(async () => root.render(React.createElement(ProductFolderNavigation, { folders, availableGroups: folders.map(folder => folder.id), hasUngrouped: true, current: "产品/S790", onSelect: select, onChanged: changed })));
  await click("管理文件夹 产品");
  expect(button("移动")).toBeUndefined();
  expect(button("新建子目录")).toBeUndefined();
  await click("删除"); expect(fetchMock).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("子目录和库内素材");
  await click("确定");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ operation: "delete", id: "产品" });
  expect(select).toHaveBeenCalledWith(MEDIA_LIBRARY_UNGROUPED);
});

it("hides empty browsing categories while retaining populated ones", async () => {
  const props = { folders, availableGroups: ["产品/S790"], hasUngrouped: false, current: "all", onSelect: vi.fn(), onChanged: changed };
  await act(async () => root.render(React.createElement(ProductFolderNavigation, props)));
  expect(button("全部")).toBeDefined();
  expect(button("产品/S790")).toBeDefined();
  expect(button("产品")).toBeUndefined();
  expect(button("场景")).toBeUndefined();
  expect(button("未分类")).toBeUndefined();
  await act(async () => root.render(React.createElement(ProductFolderNavigation, { ...props, availableGroups: [], hasUngrouped: true })));
  expect(button("产品/S790")).toBeUndefined();
  expect(button("未分类")).toBeDefined();
});
