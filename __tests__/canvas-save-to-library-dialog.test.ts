// @vitest-environment ./__tests__/jsdom-no-canvas-environment.ts
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act, Simulate } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasSaveToLibraryDialog } from "@/components/canvas/CanvasSaveToLibraryDialog";

const library = {
  version: 1 as const,
  folders: [{ id: "product", name: "产品", parentId: null }],
  items: [],
};

describe("canvas save to personal library", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.stubGlobal("BroadcastChannel", class { postMessage() {} close() {} });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const render = async (onSaved = vi.fn()) => {
    await act(async () => root.render(React.createElement(CanvasSaveToLibraryDialog, {
      open: true,
      items: [{ id: "image", kind: "image", url: "/source.png", name: "产品图" }],
      onClose: () => {},
      onSaved,
    })));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    return onSaved;
  };
  const confirm = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === "确认添加")!;

  it("saves the selected material into an existing folder", async () => {
    const uploads: FormData[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/canvas/materials" && !init?.method) return { ok: true, json: async () => ({ library }) };
      if (url === "/source.png") return { ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) };
      if (url === "/api/canvas/materials" && init?.body instanceof FormData) { uploads.push(init.body); return { ok: true, json: async () => ({ success: true }) }; }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const onSaved = await render();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="产品"]')!.click());
    await act(async () => confirm().click());
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
    expect(uploads).toHaveLength(1);
    expect(uploads[0].get("folderId")).toBe("product");
    expect((uploads[0].get("file") as File).name).toBe("产品图.png");
  });

  it("creates a folder and saves into it after confirmation", async () => {
    const uploads: FormData[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/canvas/materials" && !init?.method) return { ok: true, json: async () => ({ library }) };
      if (url === "/api/canvas/materials" && typeof init?.body === "string") return { ok: true, json: async () => ({ library: { ...library, folders: [...library.folders, { id: "created", name: "新品", parentId: null }] } }) };
      if (url === "/source.png") return { ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) };
      if (url === "/api/canvas/materials" && init?.body instanceof FormData) { uploads.push(init.body); return { ok: true, json: async () => ({ success: true }) }; }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const onSaved = await render();
    await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === "新建文件夹")!.click());
    const input = document.querySelector<HTMLInputElement>('[aria-label="新文件夹名称"]')!;
    await act(async () => { input.value = "新品"; Simulate.change(input); });
    await act(async () => confirm().click());
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(1));
    expect(uploads[0].get("folderId")).toBe("created");
  });
});
