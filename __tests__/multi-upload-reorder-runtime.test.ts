import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ user: { id: "reorder-user" }, openLoginModal: vi.fn() }) }));
vi.mock("@/components/ui/app-video-player", () => ({ AppVideoPlayer: () => null }));
vi.mock("@/components/ui/video-poster-preview", () => ({ VideoPosterPreview: () => null }));
vi.mock("@/components/ui/image-paint-editor", () => ({ ImagePaintEditor: () => null }));
vi.mock("@/components/ui/media-lightbox", () => ({ MediaLightbox: ({ open, src }: { open: boolean; src: string }) => open ? React.createElement("div", { "data-lightbox-src": src }) : null }));

import { MultiUploadDropzone, type MultiUploadItem } from "@/components/ui/multi-upload-dropzone";
import { insertMediaItem } from "@/lib/media-item-order";

const items: MultiUploadItem[] = ["a", "b", "c", "d", "e", "f"].map((id) => ({
  mediaId: id, file: null, url: `/uploads/${id}.png`, uploadState: "ready",
}));
let root: Root;
let host: HTMLDivElement;
let hitTarget: Element | null;
const onItemsChange = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = (file: File) => `blob:${file.name}`;
    static revokeObjectURL = vi.fn();
  });
  onItemsChange.mockReset();
  hitTarget = null;
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => hitTarget });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (document as Partial<Document>).elementFromPoint;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(accept = "image/*", disabled = false, maxFiles?: number) {
  function Gallery() {
    const [currentItems, setItems] = React.useState(items);
    return React.createElement(MultiUploadDropzone, {
      title: "上传素材", accept, items: currentItems, replaceOnItemDrop: true, disabled, maxFiles,
      onItemsChange: (next) => { onItemsChange(next); setItems(next); },
    });
  }
  await act(async () => root.render(React.createElement(Gallery)));
  const cards = Array.from(host.querySelectorAll<HTMLElement>("[data-upload-replace-index]"));
  cards.forEach((card, index) => {
    const left = (index % 3) * 110;
    const top = Math.floor(index / 3) * 110;
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
      x: left, y: top, left, top, right: left + 100, bottom: top + 100,
      width: 100, height: 100, toJSON() {},
    });
    const handle = card;
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    handle.hasPointerCapture = () => true;
  });
  return cards;
}

function pointer(target: Element, type: string, x = 0, y = 50) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, "pointerId", { value: 1 });
  act(() => { target.dispatchEvent(event); });
}

function start(cards: HTMLElement[], source: number) {
  const handle = cards[source];
  pointer(handle, "pointerdown");
  return handle;
}

function expectOrder(ids: string[]) {
  expect(onItemsChange).toHaveBeenCalledTimes(1);
  const next: MultiUploadItem[] = onItemsChange.mock.calls[0][0];
  expect(next.map((item) => item.mediaId)).toEqual(ids);
  expect(next).toHaveLength(items.length);
  for (const item of next) expect(items).toContain(item);
  expect(items.map((item) => item.mediaId)).toEqual(["a", "b", "c", "d", "e", "f"]);
  expect(host.querySelector("[data-upload-reorder-placement]")).toBeNull();
}

describe("creation upload reference insertion", () => {
  it("opens preview only with the expand button, without starting a reorder", async () => {
    const cards = await mount();
    act(() => cards[0].click());
    expect(host.querySelector("[data-lightbox-src]")).toBeNull();
    const preview = cards[0].querySelector<HTMLButtonElement>("[data-upload-preview-button]")!;
    pointer(preview, "pointerdown");
    expect(cards[0].setPointerCapture).not.toHaveBeenCalled();
    act(() => preview.click());
    expect(document.querySelector("[data-lightbox-src]")?.getAttribute("data-lightbox-src")).toBe("/uploads/a.png");
    expect(onItemsChange).not.toHaveBeenCalled();
  });

  it("does not start reordering from delete or paint controls", async () => {
    const cards = await mount();
    for (const label of ["删除", "涂抹编辑"]) {
      pointer(cards[0].querySelector('[aria-label="' + label + '"]')!, "pointerdown");
    }
    expect(cards[0].setPointerCapture).not.toHaveBeenCalled();
    expect(onItemsChange).not.toHaveBeenCalled();
  });
  it.each(["image/*", "image/*,video/*,audio/*"])("inserts before a later reference in %s without exchanging it", async (accept) => {
    const cards = await mount(accept);
    const handle = start(cards, 0);
    hitTarget = cards[4];
    pointer(handle, "pointermove", 115, 150);
    expect(cards[4].dataset.uploadReorderPlacement).toBe("before");
    expect(cards[4].textContent).toContain("插入到前面");
    pointer(handle, "pointerup", 115, 150);
    expectOrder(["b", "c", "d", "a", "e", "f"]);
  });

  it.each([
    { source: 0, target: 5, x: 315, y: 150, placement: "after", order: ["b", "c", "d", "e", "f", "a"] },
    { source: 5, target: 0, x: 5, y: 50, placement: "before", order: ["f", "a", "b", "c", "d", "e"] },
    { source: 5, target: 1, x: 205, y: 50, placement: "after", order: ["a", "b", "f", "c", "d", "e"] },
    { source: 0, target: 4, x: 160, y: 150, placement: "swap", order: ["e", "b", "c", "d", "a", "f"] },
  ])("supports $placement from $source to $target", async ({ source, target, x, y, placement, order }) => {
    const cards = await mount();
    const handle = start(cards, source);
    hitTarget = cards[target];
    pointer(handle, "pointermove", x, y);
    expect(cards[target].dataset.uploadReorderPlacement).toBe(placement);
    pointer(handle, "pointerup", x, y);
    expectOrder(order);
  });

  it("accepts gaps between cards and keeps the surrounding sequence", async () => {
    const cards = await mount();
    const handle = start(cards, 5);
    hitTarget = host.querySelector("[data-upload-gallery]");
    pointer(handle, "pointermove", 105);
    expect(cards[0].dataset.uploadReorderPlacement).toBe("after");
    pointer(handle, "pointerup", 105);
    expectOrder(["a", "f", "b", "c", "d", "e"]);
  });

  it("refreshes the insertion target when scrolling during a drag", async () => {
    const cards = await mount();
    const handle = start(cards, 0);
    hitTarget = cards[1];
    pointer(handle, "pointermove", 115);
    hitTarget = cards[4];
    act(() => host.querySelector("[data-upload-gallery]")!.dispatchEvent(new Event("scroll")));
    expect(cards[4].dataset.uploadReorderPlacement).toBe("before");
    pointer(handle, "pointerup", 115);
    expectOrder(["b", "c", "d", "a", "e", "f"]);
  });

  it("treats the gap between wrapped rows as insertion rather than exchange", async () => {
    const cards = await mount();
    const handle = start(cards, 5);
    hitTarget = host.querySelector("[data-upload-gallery]");
    pointer(handle, "pointermove", 160, 105);
    expect(cards[1].dataset.uploadReorderPlacement).toBe("after");
    pointer(handle, "pointerup", 160, 105);
    expectOrder(["a", "b", "f", "c", "d", "e"]);
  });

  it.each(["pointercancel", "lostpointercapture", "outside"])("cancels on %s without applying the last hovered target", async (ending) => {
    const cards = await mount();
    const handle = start(cards, 0);
    hitTarget = cards[4];
    pointer(handle, "pointermove", 115, 150);
    if (ending === "outside") hitTarget = document.body;
    pointer(handle, ending === "outside" ? "pointerup" : ending, 115, 150);
    expect(onItemsChange).not.toHaveBeenCalled();
    expect(host.querySelector("[data-upload-reorder-placement]")).toBeNull();
  });

  it("does nothing when dropped in the current position or when disabled", async () => {
    const cards = await mount();
    const handle = start(cards, 0);
    hitTarget = cards[1];
    pointer(handle, "pointerup", 115);
    expect(onItemsChange).not.toHaveBeenCalled();
    await mount("image/*", true);
    const disabledHandle = host.querySelector<HTMLElement>("[data-upload-replace-index]")!;
    pointer(disabledHandle, "pointerdown");
    pointer(disabledHandle, "pointerup", 315, 150);
    expect(onItemsChange).not.toHaveBeenCalled();
  });

  it("preserves external asset replacement when dropping a URL on a card", async () => {
    const cards = await mount();
    const drop = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX: 160 });
    Object.defineProperty(drop, "dataTransfer", { value: {
      types: ["text/uri-list"], getData: (type: string) => type === "text/uri-list" ? "/uploads/new.png" : "",
    } });
    act(() => { cards[1].dispatchEvent(drop); });
    expect(onItemsChange).toHaveBeenCalledTimes(1);
    const next = onItemsChange.mock.calls[0][0];
    expect(next[1].url).toBe("/uploads/new.png");
    expect(next.filter((_: unknown, i: number) => i !== 1)).toEqual(items.filter((_, i) => i !== 1));
  });

  it("ignores invalid insertion indexes", () => {
    for (const [source, target] of [[-1, 2], [0, 6], [NaN, 2], [0, 1.5], [2, 2]]) {
      expect(insertMediaItem(items, source, target, "after")).toBe(items);
    }
  });

  describe.each(["image/*", "image/*,video/*,audio/*"])("new material insertion in %s", (accept) => {
    function nativeDrag(target: Element, type: string, x: number, data: Record<string, string>, files: File[] = []) {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 50 });
      Object.defineProperty(event, "dataTransfer", { value: {
        types: [...Object.keys(data), ...(files.length ? ["Files"] : [])], files,
        getData: (key: string) => data[key] || "",
      } });
      act(() => { target.dispatchEvent(event); });
    }

    it.each([
      { x: 115, placement: "before", urls: ["a", "new", "b", "c", "d", "e", "f"] },
      { x: 205, placement: "after", urls: ["a", "b", "new", "c", "d", "e", "f"] },
    ])("inserts a dragged result $placement an existing card", async ({ x, placement, urls }) => {
      const cards = await mount(accept);
      const data = { "application/x-history-media-url": "/uploads/new.png" };
      nativeDrag(cards[1], "dragover", x, data);
      expect(cards[1].dataset.uploadReorderPlacement).toBe(placement);
      nativeDrag(cards[1], "drop", x, data);
      expect(onItemsChange).toHaveBeenCalledOnce();
      expect(onItemsChange.mock.calls[0][0].map((item: MultiUploadItem) => item.url)).toEqual(urls.map((id) => `/uploads/${id}.png`));
      expect(host.querySelector("[data-upload-reorder-placement]")).toBeNull();
    });

    it("inserts a multi-selection into a gap without losing its order or existing materials", async () => {
      await mount(accept);
      const gallery = host.querySelector("[data-upload-gallery]")!;
      const data = { "application/x-media-library-items": JSON.stringify([
        { id: 1, url: "/uploads/new1.png", kind: "image" }, { id: 2, url: "/uploads/new2.png", kind: "image" },
      ]) };
      nativeDrag(gallery, "dragover", 105, data);
      nativeDrag(gallery, "drop", 105, data);
      expect(onItemsChange).toHaveBeenCalledOnce();
      expect(onItemsChange.mock.calls[0][0].map((item: MultiUploadItem) => item.url)).toEqual(
        ["a", "new1", "new2", "b", "c", "d", "e", "f"].map((id) => `/uploads/${id}.png`),
      );
    });

    it("keeps existing materials when only one upload slot is left", async () => {
      const cards = await mount(accept, false, 7);
      nativeDrag(cards[0], "drop", 5, {}, [
        new File(["x"], "new1.png", { type: "image/png" }), new File(["y"], "new2.png", { type: "image/png" }),
      ]);
      const next: MultiUploadItem[] = onItemsChange.mock.calls[0][0];
      expect(next).toHaveLength(7);
      expect(next[0].file?.name).toBe("new1.png");
      expect(next.slice(1)).toEqual(items);
    });

    it.each([{ disabled: true, maxFiles: 8 }, { disabled: false, maxFiles: 6 }])("rejects insertion when disabled or full: %j", async ({ disabled, maxFiles }) => {
      const cards = await mount(accept, disabled, maxFiles);
      nativeDrag(cards[1], "drop", 115, { "text/uri-list": "/uploads/new.png" });
      expect(onItemsChange).not.toHaveBeenCalled();
    });
  });
});
