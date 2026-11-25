// @vitest-environment jsdom
import * as React from "react";
import { act } from "react-dom/test-utils";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AgentMaterialLibraryPicker from "@/components/creative-agent/AgentMaterialLibraryPicker";
import { personalLibraryOptions } from "@/components/canvas/canvas-library-cache";
import type { PersonalLibrary, PersonalMaterial } from "@/lib/canvas/personal-library-types";

vi.mock("@/components/ui/media-image", () => ({ MediaImage: () => null }));

let root: Root, host: HTMLDivElement, cache: QueryClient, library: PersonalLibrary;
const onSelect = vi.fn();
const key = personalLibraryOptions(7).queryKey;
const material = (folderId: string | null): PersonalMaterial => ({
  id: "image", folderId, name: "产品.png", fileName: "product.png", kind: "image",
  mime: "image/png", size: 10, createdAt: "2026-10-15T00:00:00Z",
});
const button = (name: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
  .find(el => (el.getAttribute("aria-label") || el.textContent?.trim()) === name);
async function render() {
  cache.setQueryData(key, library);
  await act(async () => root.render(React.createElement(QueryClientProvider, { client: cache },
    React.createElement(AgentMaterialLibraryPicker, { ownerId: 7, query: "", disabled: false, selectedIds: [], onSelect }))));
}
async function updateLibrary(next: PersonalLibrary) {
  library = next;
  await act(async () => {
    cache.setQueryData(key, library);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  library = { version: 1, folders: [
    { id: "product", name: "产品", parentId: null },
    { id: "scene", name: "场景", parentId: null },
    { id: "empty-child", name: "空子目录", parentId: "scene" },
  ], items: [] };
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ success: true, library }) })));
  onSelect.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); cache.clear(); vi.unstubAllGlobals();
});

describe("Agent mention material folders", () => {
  it("shows empty folders and expands all folders by default", async () => {
    library.items = [material("product")];
    await render();
    for (const name of ["产品", "场景", "空子目录"]) {
      expect(button(name)?.getAttribute("aria-expanded")).toBe("true");
    }
    expect(button("产品.png，引用素材")).toBeDefined();
  });

  it("exposes nested materials immediately and still supports collapsing and selecting", async () => {
    library.folders.push(
      { id: "child", name: "子目录", parentId: "product" },
      { id: "leaf", name: "末级目录", parentId: "child" },
      { id: "sibling", name: "空同级目录", parentId: "child" },
    );
    library.items = [material("leaf")];
    await render();
    expect(button("空同级目录")).toBeDefined();
    expect(button("产品.png，引用素材")).toBeDefined();
    await act(async () => button("产品")!.click());
    expect(button("产品")?.getAttribute("aria-expanded")).toBe("false");
    expect(button("产品.png，引用素材")).toBeUndefined();
    await act(async () => button("产品")!.click());
    await act(async () => button("产品.png，引用素材")!.click());
    expect(onSelect).toHaveBeenCalledWith(library.items[0]);
  });

  it("shows the empty-library message when there are no folders or materials", async () => {
    library.folders = [];
    await render();
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(host.textContent).toContain("素材库暂无素材");
  });

  it("expands newly loaded folders without reopening folders the user collapsed", async () => {
    library.items = [material(null)];
    await render();
    expect(button("产品.png，引用素材")).toBeDefined();
    await act(async () => button("产品")!.click());
    await updateLibrary({ ...library, folders: [...library.folders, { id: "new", name: "新目录", parentId: null }], items: [material("new")] });
    expect(button("新目录")?.getAttribute("aria-expanded")).toBe("true");
    expect(button("产品.png，引用素材")).toBeDefined();
    expect(button("产品")?.getAttribute("aria-expanded")).toBe("false");
    await updateLibrary({ ...library, items: [] });
    expect(button("新目录")).toBeDefined();
    expect(button("产品.png，引用素材")).toBeUndefined();
  });
});

it("renders cached materials immediately while the refresh is pending, then applies the fresh list", async () => {
  library.items = [material("product")];
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise<Response>(done => { resolve = done; }));
  await render();
  expect(button("产品.png，引用素材")).toBeDefined();
  expect(host.textContent).not.toContain("正在加载素材库");
  await act(async () => {
    resolve(Response.json({ success: true, library: { ...library, items: [{ ...material("product"), name: "最新产品.png" }] } }));
    await new Promise(done => setTimeout(done, 10));
  });
  expect(button("最新产品.png，引用素材")).toBeDefined();
  expect(button("产品.png，引用素材")).toBeUndefined();
});
