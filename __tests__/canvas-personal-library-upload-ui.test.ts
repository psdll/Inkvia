import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { personalLibraryOptions } from "@/components/canvas/canvas-library-cache";
let cache: QueryClient;
const view = (ownerId = 27, canvasId = 1) => React.createElement(QueryClientProvider, { client: cache }, React.createElement(CanvasPersonalLibrary, { key: `${ownerId}:${canvasId}`, ownerId, canvasId }));
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import CanvasPersonalLibrary from "@/components/canvas/CanvasPersonalLibrary";
import type { PersonalLibrary } from "@/lib/canvas/personal-library-types";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: 27, username: "素材所有者" } }) }));

let root: Root, host: HTMLDivElement, library: PersonalLibrary;
const picker = vi.fn(), posted: FormData[] = [];
let failCreate = false;
const button = (name: string, within: ParentNode = document) => Array.from(within.querySelectorAll<HTMLButtonElement>("button")).find(el => (el.getAttribute("aria-label") || el.textContent?.trim()) === name)!;
const click = async (el: HTMLElement) => act(async () => el.click());
async function open(mode: string) { await click(button("添加素材或文件夹")); await click(button(mode)); }
async function name(value: string) {
  const input = document.querySelector<HTMLInputElement>('[aria-label="新文件夹名称"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
beforeEach(async () => {
  window.localStorage.clear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  library = { version: 1, folders: [{ id: "product", name: "产品", parentId: null }, { id: "scene", name: "场景", parentId: null }], items: [] };
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  failCreate = false; posted.length = 0; picker.mockClear();
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) { if (this.type === "file") picker(); });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.body instanceof FormData) { posted.push(init.body); return { ok: true, json: async () => ({ success: true }) }; }
    if (init?.method === "POST") {
      if (failCreate) return { ok: false, json: async () => ({ error: "此位置已有同名文件夹" }) };
      const action = JSON.parse(String(init.body));
      if (action.operation === "delete" && action.type === "item") library = { ...library, items: library.items.filter(item => item.id !== action.id) };
      else library = { ...library, folders: [...library.folders, { id: "created", name: action.name, parentId: action.parentId }] };
    }
    return { ok: true, json: async () => ({ success: true, library }) };
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(view()));
});
afterEach(() => { act(() => root.unmount()); host.remove(); cache.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("personal library asset manager", () => {
  const manager = () => document.querySelector<HTMLElement>('[data-canvas-asset-manager] [role="dialog"]')!;
  const escape = async (target: EventTarget = window) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  async function openMaterialDetails() {
    library = { ...library, items: ["椅子正面", "椅子侧面"].map((name, index) => ({ id: `image-${index}`, folderId: "product", name, fileName: `${index}.png`, kind: "image" as const, mime: "image/png", size: 10, createdAt: "2026-10-15T00:00:00.000Z" })) };
    await cache.invalidateQueries({ queryKey: personalLibraryOptions(27).queryKey });
    await act(async () => window.dispatchEvent(new Event("focus")));
    await click(button("文件管理", host)); await click(button("打开文件夹 产品", manager()));
    await click(button("预览 椅子正面", manager()));
    return manager().querySelector<HTMLElement>('[aria-label="素材详情"]')!;
  }
  it("keeps the grid visible and switches the inline detail panel without opening another dialog or importing", async () => {
    const use = vi.fn(); window.addEventListener("canvas-personal-material-use", use);
    try {
      const details = await openMaterialDetails();
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(manager().querySelectorAll('[data-managed-material]')).toHaveLength(2);
      expect(details.textContent).toContain("素材所有者");
      expect(use).not.toHaveBeenCalled();
      await click(button("预览 椅子侧面", manager()));
      expect(details.querySelector("h3")?.textContent).toBe("椅子侧面");
      await click(button("添加到画布", details));
      expect(use).toHaveBeenCalledTimes(1);
      expect((use.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: "image-1" });
      await escape(manager());
      expect(manager()).not.toBeNull();
      expect(manager().querySelector('[aria-label="素材详情"]')).toBeNull();
    } finally { window.removeEventListener("canvas-personal-material-use", use); }
  });
  it("confirms deletion above the details panel and removes only the chosen material", async () => {
    const details = await openMaterialDetails();
    await click(button("删除", details));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    await escape(document.querySelectorAll('[role="dialog"]')[1]);
    expect(manager().querySelector('[aria-label="素材详情"]')).not.toBeNull();
    expect(library.items).toHaveLength(2);
    await click(button("删除", details)); await click(button("确定"));
    expect(library.items.map(item => item.id)).toEqual(["image-1"]);
    expect(manager().querySelector('[aria-label="素材详情"]')).toBeNull();
    expect(button("预览 椅子侧面", manager())).toBeDefined();
  });
  it("downloads the selected original with its filename from the details panel", async () => {
    const details = await openMaterialDetails();
    const createObjectURL = vi.fn(() => "blob:material-download");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL; });
    let downloadedName = "";
    const anchor = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloadedName = this.download; });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["image"]) } as Response);
    await click(button("下载", details));
    expect(fetch).toHaveBeenCalledWith("/api/canvas/materials/image-0/file?download=1");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchor).toHaveBeenCalledTimes(1);
    expect(downloadedName).toBe("椅子正面.png");
    expect(details.textContent).toContain("椅子正面");
  });
  it("opens at the root in a grid and navigates nested folders without changing the sidebar location", async () => {
    library = { ...library, folders: [...library.folders, { id: "nested", name: "子目录", parentId: "product" }], items: [
      { id: "image", folderId: "nested", name: "椅子图片", fileName: "chair.png", kind: "image", mime: "image/png", size: 10, createdAt: "2026-10-15T00:00:00.000Z" },
    ] };
    await cache.invalidateQueries({ queryKey: personalLibraryOptions(27).queryKey });
    await act(async () => window.dispatchEvent(new Event("focus")));
    await click(button("场景", host));
    await click(button("文件管理", host));
    expect(manager().querySelector('[data-library-layout="grid"]')).not.toBeNull();
    expect(button("打开文件夹 子目录", manager())).toBeUndefined();
    await click(button("打开文件夹 产品", manager()));
    await click(button("打开文件夹 子目录", manager()));
    expect(manager().querySelector('[aria-label="文件夹路径"]')?.textContent).toBe("个人资产库产品子目录");
    expect(manager().querySelector('[data-managed-material="image"] time')?.textContent).toBe("2026-10-15");
    await click(button("产品", manager().querySelector("nav")!));
    expect(button("打开文件夹 子目录", manager())).toBeDefined();
    await click(button("关闭资产管理", manager()));
    expect(host.textContent).toContain("当前：场景");
    await click(button("文件管理", host));
    expect(button("打开文件夹 产品", manager())).toBeDefined();
    expect(button("打开文件夹 子目录", manager())).toBeUndefined();
  });
  it("creates a folder in the current location and immediately shows the saved result without opening the file picker", async () => {
    await click(button("文件管理", host));
    await click(button("打开文件夹 产品", manager()));
    await click(button("新建", manager())); await click(button("新建文件夹", manager()));
    const input = document.querySelector<HTMLInputElement>('[aria-label="名称"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "管理器子目录"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(button("确定"));
    expect(library.folders).toContainEqual({ id: "created", name: "管理器子目录", parentId: "product" });
    expect(button("打开文件夹 管理器子目录", manager())).toBeDefined();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(picker).not.toHaveBeenCalled();
  });
  it("closes search, menus, and nested dialogs one layer at a time and restores the invoking control", async () => {
    const opener = button("文件管理", host);
    opener.focus(); await click(opener);
    await click(button("搜索资产", manager()));
    await act(async () => manager().focus());
    await escape(manager());
    expect(manager()).not.toBeNull(); expect(manager().querySelector("input")).toBeNull();
    await click(button("新建", manager()));
    await escape(button("新建", manager()));
    expect(manager().querySelector('[role="menu"]')).toBeNull();
    await click(button("产品的更多操作", manager()));
    await click(button("重命名", manager()));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    await escape(document.querySelector('[aria-label="名称"]')!);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await escape(manager());
    expect(manager()).toBeNull(); expect(document.activeElement).toBe(opener);
  });
  it("preserves the manager when a pointer gesture starts inside and ends on the backdrop", async () => {
    await click(button("文件管理", host));
    const backdrop = document.querySelector<HTMLElement>("[data-canvas-asset-manager]")!;
    await act(async () => { manager().dispatchEvent(new Event("pointerdown", { bubbles: true })); backdrop.click(); });
    expect(manager()).not.toBeNull();
    await act(async () => { backdrop.dispatchEvent(new Event("pointerdown", { bubbles: true })); backdrop.click(); });
    expect(manager()).toBeNull();
  });
});

describe("personal library upload folder confirmation", () => {
  it("combines expandable search, type filtering, grid layout and folder controls", async () => {
    library = { ...library, items: [
      { id: "image", folderId: "product", name: "椅子图片", fileName: "chair.png", kind: "image", mime: "image/png", size: 10, createdAt: new Date().toISOString() },
      { id: "audio", folderId: "scene", name: "椅子音频", fileName: "chair.mp3", kind: "audio", mime: "audio/mpeg", size: 10, createdAt: new Date().toISOString() },
    ] };
    await cache.invalidateQueries({ queryKey: personalLibraryOptions(27).queryKey });
    await act(async () => window.dispatchEvent(new Event("focus")));
    const item = (id: string) => host.querySelector(`[data-personal-material="${id}"]`);
    expect(host.querySelector('input[placeholder="搜索我的素材和文件夹"]')).toBeNull();
    await click(button("展示设置", host)); await click(button("展开全部分组", host));
    expect(button("产品", host).getAttribute("aria-expanded")).toBe("true");
    await click(button("展示设置", host)); await click(button("宫格展示", host));
    expect(host.querySelector('[data-library-layout="grid"]')).not.toBeNull();
    await click(button("筛选：全部", host));
    expect(button("文本", host)).toBeUndefined();
    await click(button("音频", host));
    expect(item("image")).toBeNull(); expect(item("audio")).not.toBeNull();
    expect(button("产品", host)).toBeUndefined();
    await click(button("搜索我的素材和文件夹", host));
    const input = host.querySelector<HTMLInputElement>('input[placeholder="搜索我的素材和文件夹"]')!;
    expect(document.activeElement).toBe(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "图片");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(item("audio")).toBeNull(); expect(host.textContent).toContain("没有找到匹配的素材");
    await click(button("关闭搜索", host));
    expect(item("audio")).not.toBeNull();
    await click(button("筛选：音频", host));
    expect(button("音频", host).getAttribute("aria-pressed")).toBe("true");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(button("音频", host)).toBeUndefined();
    await click(button("展示设置", host)); await click(button("收起全部分组", host));
    expect(button("产品", host).getAttribute("aria-expanded")).toBe("false");
    expect(button("场景", host).getAttribute("aria-expanded")).toBe("false");
    await act(async () => root.render(null)); await act(async () => root.render(view()));
    expect(host.querySelector('[data-library-layout="grid"]')).not.toBeNull();
  });
  it("restores nested folders and scroll on reopen, with separate positions per canvas and owner", async () => {
    library = { ...library, folders: [...library.folders, { id: "mx650", name: "MX650", parentId: "product" }] };
    await cache.invalidateQueries({ queryKey: personalLibraryOptions(27).queryKey });
    await act(async () => window.dispatchEvent(new Event("focus")));
    await click(button("产品", host)); await click(button("MX650", host));
    const list = host.querySelector<HTMLDivElement>(".scrollbar-hide")!;
    await act(async () => { list.scrollTop = 240; list.dispatchEvent(new Event("scroll", { bubbles: true })); });
    // Closing immediately must flush the last scroll event, even before the debounce.
    await act(async () => root.render(null));
    await act(async () => root.render(view()));
    expect(host.textContent).toContain("当前：MX650");
    expect(button("产品", host).getAttribute("aria-expanded")).toBe("true");
    expect(button("MX650", host).getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector<HTMLDivElement>(".scrollbar-hide")!.scrollTop).toBe(240);
    await act(async () => root.render(view(27, 2)));
    expect(host.textContent).toContain("个人素材库根目录");
    expect(button("产品", host).getAttribute("aria-expanded")).toBe("false");
    await click(button("场景", host));
    await act(async () => root.render(view(28, 1)));
    expect(host.textContent).toContain("个人素材库根目录");
    await act(async () => root.render(view(27, 1)));
    expect(host.textContent).toContain("当前：MX650");
    await act(async () => root.render(view(27, 2)));
    expect(host.textContent).toContain("当前：场景");
  });
  it("keeps a saved location through a cold catalog load and falls back if the folder was deleted", async () => {
    await click(button("产品", host));
    await act(async () => root.render(null)); cache.clear();
    let finish!: (value: unknown) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }));
    await act(async () => root.render(view()));
    expect(host.textContent).toContain("加载中");
    await act(async () => finish({ ok: true, json: async () => ({ library }) }));
    expect(host.textContent).toContain("当前：产品");
    library = { ...library, folders: library.folders.filter(folder => folder.id !== "product") };
    await cache.invalidateQueries({ queryKey: personalLibraryOptions(27).queryKey });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.textContent).toContain("个人素材库根目录");
    expect(button("产品", host)).toBeUndefined();
  });

  it("expands existing materials and nested folders in the picker without opening uploads or adding canvas nodes", async () => {
    library = { ...library, folders: [...library.folders, { id: "child", name: "子目录", parentId: "product" }], items: [
      { id: "portrait", folderId: "scene", name: "已有角色.png", fileName: "portrait.png", kind: "image", mime: "image/png", size: 10, createdAt: new Date().toISOString() },
      { id: "nested", folderId: "child", name: "子目录素材.png", fileName: "nested.png", kind: "image", mime: "image/png", size: 10, createdAt: new Date().toISOString() },
    ] };
    await cache.invalidateQueries({ queryKey: personalLibraryOptions(27).queryKey });
    await act(async () => window.dispatchEvent(new Event("focus")));
    await open("上传素材");
    const modal = document.querySelector('[role="dialog"]')!;
    const use = vi.fn(); window.addEventListener("canvas-personal-material-use", use);
    try {
      expect(button("展开场景", modal).disabled).toBe(false);
      await click(button("展开场景", modal));
      expect(modal.textContent).toContain("已有角色.png");
      expect(modal.querySelector('img')?.getAttribute("src")).toContain("preview=120&owner=27");
      expect(button("确认", modal).disabled).toBe(true);
      await click(button("场景", modal));
      expect(button("确认", modal).disabled).toBe(false);
      expect(modal.textContent).not.toContain("已有角色.png");
      await click(button("产品", modal)); await click(button("子目录", modal));
      expect(modal.textContent).toContain("子目录素材.png");
      expect(button("子目录", modal).getAttribute("aria-pressed")).toBe("true");
      expect(picker).not.toHaveBeenCalled(); expect(use).not.toHaveBeenCalled();
      await click(button("确认", modal)); expect(picker).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener("canvas-personal-material-use", use); }
  });
  it("requires explicit confirmation and keeps the chosen upload destination even when sidebar selection changes", async () => {
    await open("上传素材");
    const modal = document.querySelector('[role="dialog"]')!;
    expect(button("确认", modal).disabled).toBe(true); expect(picker).not.toHaveBeenCalled();
    await click(button("场景", modal)); await click(button("确认", modal));
    expect(picker).toHaveBeenCalledTimes(1);
    await click(button("产品", host));
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "test.png", { type: "image/png" })] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(posted[0].get("folderId")).toBe("scene");
  });
  it("creates a named folder inside the same picker before opening file selection", async () => {
    await open("新建文件夹");
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(button("确认").disabled).toBe(true);
    await name("新产品"); await click(button("确认"));
    expect(library.folders).toContainEqual({ id: "created", name: "新产品", parentId: null });
    expect(picker).toHaveBeenCalledTimes(1);
  });
  it("creates inside the selected folder and uploads to the new child rather than its parent", async () => {
    await open("上传素材");
    const modal = document.querySelector('[role="dialog"]')!;
    await click(button("产品", modal));
    await click(button("新建文件夹", modal));
    expect(modal.textContent).toContain("新建位置：个人素材库 / 产品");
    expect(button("产品", modal).getAttribute("aria-pressed")).toBe("true");
    await name("子素材"); await click(button("确认", modal));
    expect(library.folders).toContainEqual({ id: "created", name: "子素材", parentId: "product" });
    expect(picker).toHaveBeenCalledTimes(1);
    expect(button("产品", host).getAttribute("aria-expanded")).toBe("true");
    expect(button("子素材", host).getAttribute("aria-expanded")).toBe("true");
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "test.png", { type: "image/png" })] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(posted[0].get("folderId")).toBe("created");
  });
  it("can switch the new folder destination back to the root", async () => {
    await open("上传素材");
    const modal = document.querySelector('[role="dialog"]')!;
    await click(button("产品", modal)); await click(button("新建文件夹", modal));
    await click(button("改为根目录", modal)); await name("根目录文件夹");
    await click(button("确认", modal));
    expect(library.folders).toContainEqual({ id: "created", name: "根目录文件夹", parentId: null });
    expect(picker).toHaveBeenCalledTimes(1);
  });
  it("shows an inline input from the picker header and does not open files after a failed creation or cancellation", async () => {
    await open("上传素材");
    await click(button("新建文件夹", document.querySelector('[role="dialog"]')!));
    await name("产品"); failCreate = true; await click(button("确认"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("同名"); expect(picker).not.toHaveBeenCalled();
    await click(button("取消")); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(picker).not.toHaveBeenCalled();
  });
});

describe("personal library material interaction", () => {
  it("reopens from the shared cache without a request and keeps cached rows visible during revalidation", async () => {
    const requests = vi.mocked(fetch).mock.calls.length;
    await act(async () => root.render(null));
    await act(async () => root.render(view()));
    expect(button("产品", host)).toBeDefined();
    expect(host.textContent).not.toContain("加载中");
    expect(vi.mocked(fetch).mock.calls.length).toBe(requests);
    await cache.invalidateQueries({ queryKey: personalLibraryOptions(27).queryKey });
    let finish!: (value: unknown) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }));
    await act(async () => root.render(null));
    await act(async () => root.render(view()));
    expect(button("产品", host)).toBeDefined();
    expect(host.textContent).not.toContain("加载中");
    const next = { ...library, folders: [{ id: "updated", name: "更新后的目录", parentId: null }] };
    await act(async () => finish({ ok: true, json: async () => ({ library: next }) }));
    expect(button("更新后的目录", host)).toBeDefined();
    expect(button("产品", host)).toBeUndefined();
  });
  it("never shows another owner's cached catalog while the new owner is loading", async () => {
    let finish!: (value: unknown) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as typeof finish; }));
    await act(async () => root.render(view(28)));
    expect(button("产品", host)).toBeUndefined();
    await act(async () => finish({ ok: true, json: async () => ({ library: { version: 1, folders: [], items: [] } }) }));
    expect(cache.getQueryData(personalLibraryOptions(27).queryKey)).toEqual(library);
    expect(cache.getQueryData(personalLibraryOptions(28).queryKey)).toEqual({ version: 1, folders: [], items: [] });
  });
  async function materialButton() {
    library = { ...library, items: [...library.items, { id: "portrait", folderId: "product", name: "角色.png", fileName: "portrait.png", kind: "image", mime: "image/png", size: 10, createdAt: new Date().toISOString() }] };
    await cache.invalidateQueries({ queryKey: personalLibraryOptions(27).queryKey });
    await act(async () => window.dispatchEvent(new Event("focus")));
    await click(button("产品", host));
    return button("角色.png（添加到画布）", host);
  }
  it("toggles from the arrow, icon, name and row space, reuses thumbnails, and isolates the menu", async () => {
    const material = await materialButton();
    const folder = button("产品", host);
    const thumbnail = material.querySelector("img");
    expect(folder.getAttribute("aria-expanded")).toBe("true");
    const requests = vi.mocked(fetch).mock.calls.length;
    // Children all bubble to the same full-row button, including its empty area.
    for (const select of [() => folder.querySelector("svg")!, () => folder.querySelectorAll("svg")[1], () => folder.querySelector("span")!, () => folder]) {
      const target = select();
      await act(async () => target.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(folder.getAttribute("aria-expanded")).toBe("false");
      expect(material.closest("[hidden]")).not.toBeNull();
      await click(folder);
      expect(folder.getAttribute("aria-expanded")).toBe("true");
      expect(material.closest("[hidden]")).toBeNull();
      expect(host.querySelector('[data-personal-material="portrait"] img')).toBe(thumbnail);
    }
    await click(button("产品的更多操作", host));
    expect(folder.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(vi.mocked(fetch).mock.calls.length).toBe(requests);
  });
  it("previews on hover without importing, imports on a single click, and keeps the more menu separate", async () => {
    const material = await materialButton();
    const use = vi.fn(); window.addEventListener("canvas-personal-material-use", use);
    try {
      await act(async () => material.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
      expect(document.querySelector('[role="tooltip"] img')?.getAttribute("src")).toBe("/api/canvas/materials/portrait/file?preview=600&owner=27");
      expect(use).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      await click(material);
      expect(use).toHaveBeenCalledTimes(1);
      expect((use.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: "portrait" });
      expect(document.querySelector('[role="tooltip"]')).toBeNull();
      await click(button("角色.png的更多操作"));
      expect(document.querySelector('[role="menu"]')).not.toBeNull();
      expect(use).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener("canvas-personal-material-use", use); }
  });
  it("dismisses hover previews on leave, scrolling and Escape, and retains drag data", async () => {
    const material = await materialButton();
    const hover = async () => act(async () => material.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    await hover();
    await act(async () => material.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await hover(); await act(async () => window.dispatchEvent(new Event("scroll")));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await hover(); await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    await act(async () => material.focus());
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    const transfer = { setData: vi.fn(), effectAllowed: "" };
    const drag = new Event("dragstart", { bubbles: true }); Object.defineProperty(drag, "dataTransfer", { value: transfer });
    await act(async () => material.dispatchEvent(drag));
    expect(transfer.setData).toHaveBeenCalledWith("application/x-canvas-personal-material", "portrait");
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
});
