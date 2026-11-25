import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "preview-user" }, openLoginModal: vi.fn() }) }));
vi.mock("@/components/ui/app-video-player", () => ({ AppVideoPlayer: () => null }));
vi.mock("@/components/ui/video-poster-preview", () => ({ VideoPosterPreview: () => null }));
const editor = vi.hoisted(() => ({ props: null as any }));
vi.mock("next/dynamic", () => ({ default: () => (props: any) => { editor.props = props; return null; } }));
vi.mock("@/components/ui/media-lightbox", () => ({
  MediaLightbox: ({ open, src }: { open: boolean; src: string }) => open
    ? React.createElement("div", { "data-lightbox-src": src }) : null,
}));

import { MultiUploadDropzone, type MultiUploadItem } from "@/components/ui/multi-upload-dropzone";

let root: Root;
let host: HTMLDivElement;
const onItemsChange = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onItemsChange.mockReset();
  editor.props = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function mount(items: MultiUploadItem[], maxFiles?: number) {
  await act(async () => root.render(React.createElement(MultiUploadDropzone, {
    title: "参考图", accept: "image/*", items, onItemsChange, maxFiles,
  })));
  return host.querySelector<HTMLImageElement>("[data-upload-replace-index] img")!;
}

describe("upload previews avoid decoding full resolution references", () => {
  it("uses small asynchronous gallery previews and opens the original reference", async () => {
    const original = "/uploads/imports/large-reference.png";
    const items = [{ file: null, url: original }, { file: null, url: "/uploads/imports/other.png" }];
    const image = await mount(items);
    expect(image.getAttribute("src")).toBe(`/api/thumb?src=${encodeURIComponent(original)}&w=300`);
    expect(image.getAttribute("decoding")).toBe("async");
    await act(async () => image.click());
    expect(host.querySelector("[data-lightbox-src]")?.getAttribute("data-lightbox-src")).toBe(original);
    expect(items[0].url).toBe(original);
    expect(onItemsChange).not.toHaveBeenCalled();
  });

  it("uses the larger preview tier for a single reference and falls back if thumbnails fail", async () => {
    const original = "/uploads/imports/single-reference.png";
    const image = await mount([{ file: null, url: original }]);
    expect(image.getAttribute("src")).toBe(`/api/thumb?src=${encodeURIComponent(original)}&w=600`);
    await act(async () => image.dispatchEvent(new Event("error")));
    await act(async () => image.dispatchEvent(new Event("error")));
    expect(image.getAttribute("src")).toBe(original);
    expect(onItemsChange).not.toHaveBeenCalled();
  });

  it.each(["blob:http://localhost/new-reference", "data:image/png;base64,AA=="])("keeps temporary preview %s intact", async (src) => {
    const image = await mount([{ file: null, url: src }]);
    expect(image.getAttribute("src")).toBe(src);
    expect(image.getAttribute("decoding")).toBe("async");
  });
});


describe("shared canvas editor upload integration", () => {
  async function openEditor(items: MultiUploadItem[], maxFiles?: number) {
    await mount(items, maxFiles);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="涂抹编辑"]')!.click());
    expect(editor.props.initialMode).toBe("brush");
    expect(editor.props.imageUrl).toContain("original.png");
  }

  it("queues edited files with the original retained for upload failure recovery", async () => {
    const original = { url: "/uploads/original.png", mediaId: "original-media" };
    await openEditor([original]);
    const file = new File(["edited"], "brush.png", { type: "image/png" });
    await act(async () => editor.props.onFilesResult([file], "brush"));
    const next = onItemsChange.mock.calls[0][0];
    expect(next[0]).toMatchObject({ file, uploadState: "queued", replacement: { previousItem: original } });
    expect(original.url).toBe("/uploads/original.png");
  });

  it("inserts all grid results in order while preserving other references", async () => {
    const other = { url: "/uploads/other.png" };
    await openEditor([{ url: "/uploads/original.png" }, other], 4);
    const files = [1, 2, 3].map(n => new File([String(n)], `grid_${n}.png`, { type: "image/png" }));
    await act(async () => editor.props.onFilesResult(files, "grid"));
    const next = onItemsChange.mock.calls[0][0];
    expect(next.slice(0, 3).map((item: MultiUploadItem) => item.file)).toEqual(files);
    expect(next[3]).toBe(other);
  });

  it("rejects grid overflow without changing or silently truncating references", async () => {
    await openEditor([{ url: "/uploads/original.png" }], 1);
    const files = [new File(["a"], "1.png"), new File(["b"], "2.png")];
    expect(() => editor.props.onFilesResult(files, "grid")).toThrow("最多支持 1 张参考图");
    expect(onItemsChange).not.toHaveBeenCalled();
  });

  it("closing the editor leaves the original reference untouched", async () => {
    await openEditor([{ url: "/uploads/original.png" }]);
    await act(async () => editor.props.onClose());
    expect(onItemsChange).not.toHaveBeenCalled();
  });
});
