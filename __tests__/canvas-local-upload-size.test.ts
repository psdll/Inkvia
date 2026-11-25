import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_CANVAS_AUDIO_NODE_SIZE,
  DEFAULT_CANVAS_MEDIA_NODE_SIZE,
} from "@/lib/canvas/media-size";
import {
  CANVAS_PENDING_AUDIO_NODE_SIZE,
  getCanvasLocalUploadNodeSize,
  getCanvasUrlMediaNodeSize,
} from "@/lib/canvas/local-upload-size";
import { createEmptyCanvasDocumentV2, type CanvasNode } from "@/lib/canvas/document";
import * as localUpload from "@/lib/canvas/local-upload-size";

class FakeMediaElement extends EventTarget {
  naturalWidth = 0;
  naturalHeight = 0;
  videoWidth = 0;
  videoHeight = 0;
  preload = "";
  src = "";
  load = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });
}

const imageFile = { name: "portrait.png", type: "image/png" } as File;
const videoFile = { name: "wide.mp4", type: "video/mp4" } as File;
const audioFile = { name: "voice.mp3", type: "audio/mpeg" } as File;

function installBrowserFakes(element: FakeMediaElement) {
  const createObjectURL = vi.fn(() => "blob:local-upload");
  const revokeObjectURL = vi.fn();
  const createElement = vi.fn(() => element);

  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  vi.stubGlobal("document", { createElement });

  return { createElement, createObjectURL, revokeObjectURL };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("canvas local upload sizing", () => {
  it("sizes history videos from source metadata instead of a fixed landscape box", async () => {
    const video = new FakeMediaElement();
    const browser = installBrowserFakes(video);
    video.videoWidth = 1080; video.videoHeight = 1920;
    const result = getCanvasUrlMediaNodeSize("/uploads/history.mp4", "video");
    expect(video.src).toBe("/uploads/history.mp4");
    expect(video.preload).toBe("metadata");
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(await result).toEqual({ width: 350, height: 622 });
    expect(browser.createObjectURL).not.toHaveBeenCalled();
    expect(video.removeAttribute).toHaveBeenCalledWith("src");
  });
  it("sizes history images from their real aspect and reports unreadable media", async () => {
    const image = new FakeMediaElement(); installBrowserFakes(image);
    image.naturalWidth = 1920; image.naturalHeight = 1080;
    const result = getCanvasUrlMediaNodeSize("/uploads/history.png", "image");
    image.dispatchEvent(new Event("load"));
    expect(await result).toEqual({ width: 622, height: 350 });
    const failed = getCanvasUrlMediaNodeSize("/uploads/missing.png", "image");
    image.dispatchEvent(new Event("error"));
    await expect(failed).rejects.toThrow();
    expect(await getCanvasUrlMediaNodeSize("/uploads/a.mp3", "audio")).toEqual(DEFAULT_CANVAS_AUDIO_NODE_SIZE);
  });
  it("lays multiple uploads out horizontally using each real node width", () => {
    const layout = (localUpload as typeof localUpload & {
      getCanvasLocalUploadPositions?: (
        sizes: Array<{ width: number; height: number }>,
        origin: { x: number; y: number },
      ) => Array<{ x: number; y: number }>;
    }).getCanvasLocalUploadPositions;

    expect(layout).toBeTypeOf("function");
    if (!layout) return;

    expect(layout([
      { width: 300, height: 300 },
      { width: 350, height: 622 },
      { width: 622, height: 350 },
    ], { x: 100, y: 200 })).toEqual([
      { x: 100, y: 200 },
      { x: 550, y: 200 },
      { x: 1050, y: 200 },
    ]);
  });

  it("preserves a free origin and avoids grouped nodes in world coordinates", () => {
    const parent: CanvasNode = { id: "group", type: "group", position: { x: 1000, y: 1000 }, width: 100, height: 100, data: { kind: "group", title: "group", collapsed: false } };
    const child: CanvasNode = { id: "image", type: "image", parentId: "group", position: { x: 200, y: 0 }, width: 300, height: 300, data: { kind: "image", url: "/image.png" } };
    const size = [{ width: 350, height: 350 }];
    expect(localUpload.getCanvasLocalUploadPositions(size, { x: 0, y: 0 }, [parent, child])).toEqual([{ x: 0, y: 0 }]);
    const [position] = localUpload.getCanvasLocalUploadPositions(size, { x: 1200, y: 1000 }, [parent, child]);
    expect(position.x >= 1650 || position.y >= 1450).toBe(true);
  });

  it("reads image natural dimensions before returning the normalized node size", async () => {
    const image = new FakeMediaElement();
    image.naturalWidth = 900;
    image.naturalHeight = 1600;
    const removeEventListener = vi.spyOn(image, "removeEventListener");
    const browser = installBrowserFakes(image);

    const sizing = getCanvasLocalUploadNodeSize(imageFile);
    image.dispatchEvent(new Event("load"));

    await expect(sizing).resolves.toEqual({ width: 350, height: 622 });
    expect(browser.createElement).toHaveBeenCalledWith("img");
    expect(browser.createObjectURL).toHaveBeenCalledWith(imageFile);
    expect(browser.revokeObjectURL).toHaveBeenCalledWith("blob:local-upload");
    expect(removeEventListener).toHaveBeenCalledWith(
      "load",
      expect.any(Function),
    );
    expect(removeEventListener).toHaveBeenCalledWith(
      "error",
      expect.any(Function),
    );
    expect(image.removeAttribute).toHaveBeenCalledWith("src");
    expect(image.src).toBe("");
  });

  it("reads video dimensions from loadedmetadata before returning the normalized node size", async () => {
    const video = new FakeMediaElement();
    video.videoWidth = 1920;
    video.videoHeight = 1080;
    const removeEventListener = vi.spyOn(video, "removeEventListener");
    const browser = installBrowserFakes(video);

    const sizing = getCanvasLocalUploadNodeSize(videoFile);
    video.dispatchEvent(new Event("loadedmetadata"));

    await expect(sizing).resolves.toEqual({ width: 622, height: 350 });
    expect(browser.createElement).toHaveBeenCalledWith("video");
    expect(video.preload).toBe("metadata");
    expect(video.load).toHaveBeenCalledTimes(2);
    expect(removeEventListener).toHaveBeenCalledWith(
      "loadedmetadata",
      expect.any(Function),
    );
    expect(removeEventListener).toHaveBeenCalledWith(
      "error",
      expect.any(Function),
    );
    expect(video.removeAttribute).toHaveBeenCalledWith("src");
    expect(browser.revokeObjectURL).toHaveBeenCalledWith("blob:local-upload");
  });

  it("reuses the preview URL without revoking an image that is still on the canvas", async () => {
    const image = new FakeMediaElement(); image.naturalWidth = 900; image.naturalHeight = 1600;
    const browser = installBrowserFakes(image);
    const sizing = getCanvasLocalUploadNodeSize(imageFile, "image", "blob:existing-preview");
    expect(image.src).toBe("blob:existing-preview");
    image.dispatchEvent(new Event("load"));
    await expect(sizing).resolves.toEqual({ width: 350, height: 622 });
    expect(browser.createObjectURL).not.toHaveBeenCalled();
    expect(browser.revokeObjectURL).not.toHaveBeenCalled();
  });
  it.each([imageFile, videoFile])("does not hang indefinitely when metadata never loads", async file => {
    vi.useFakeTimers();
    const element = new FakeMediaElement(); const browser = installBrowserFakes(element);
    const sizing = getCanvasLocalUploadNodeSize(file);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(sizing).resolves.toEqual(DEFAULT_CANVAS_MEDIA_NODE_SIZE);
    expect(browser.revokeObjectURL).toHaveBeenCalled();
    expect(element.src).toBe("");
  });
  it("uses the square upload placeholder for audio without creating a temporary object URL", async () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });

    await expect(getCanvasLocalUploadNodeSize(audioFile)).resolves.toEqual(
      CANVAS_PENDING_AUDIO_NODE_SIZE,
    );
    expect(CANVAS_PENDING_AUDIO_NODE_SIZE).toEqual({ width: 300, height: 300 });
    expect(CANVAS_PENDING_AUDIO_NODE_SIZE).not.toEqual(DEFAULT_CANVAS_AUDIO_NODE_SIZE);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("falls back to the default media size when local metadata loading fails", async () => {
    const image = new FakeMediaElement();
    const browser = installBrowserFakes(image);

    const sizing = getCanvasLocalUploadNodeSize(imageFile);
    image.dispatchEvent(new Event("error"));

    await expect(sizing).resolves.toEqual(DEFAULT_CANVAS_MEDIA_NODE_SIZE);
    expect(image.removeAttribute).toHaveBeenCalledWith("src");
    expect(browser.revokeObjectURL).toHaveBeenCalledWith("blob:local-upload");
  });

  it("falls back safely when DOM media probing is unavailable during SSR", async () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });

    await expect(getCanvasLocalUploadNodeSize(imageFile)).resolves.toEqual(
      DEFAULT_CANVAS_MEDIA_NODE_SIZE,
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe("pending batch layout hydration", () => {
  const before: CanvasNode = { id: "upload", type: "image", position: { x: 100, y: 200 }, width: 350, height: 350, data: { kind: "image", url: "blob:shared", name: "original" } };
  const after = { ...before, width: 622, height: 350 };
  it("updates a pending copy's dimensions without changing its own name or position", () => {
    const copy = { ...before, id: "copy", position: { x: 700, y: 800 }, data: { ...before.data, name: "renamed copy" } };
    const document = { ...createEmptyCanvasDocumentV2(), nodes: [before, copy] };
    const next = localUpload.hydrateCanvasLocalUploadLayout(document, [before], [after]);
    expect(next.nodes[1]).toMatchObject({ width: 622, height: 350, position: { x: 700, y: 800 }, data: { name: "renamed copy" } });
  });
  it("keeps user-sized nodes unchanged", () => {
    const resized = { ...before, width: 123, height: 456 };
    const document = { ...createEmptyCanvasDocumentV2(), nodes: [resized] };
    expect(localUpload.hydrateCanvasLocalUploadLayout(document, [before], [after])).toBe(document);
  });
  it("expands a group around a pending image after its real size becomes known", () => {
    const group: CanvasNode = { id: "group", type: "group", position: { x: 0, y: 0 }, width: 500, height: 500, data: { kind: "group", title: "Group", collapsed: false } };
    const member = { ...before, parentId: "group", position: { x: 80, y: 100 } };
    const document = { ...createEmptyCanvasDocumentV2(), nodes: [group, member] };
    const next = localUpload.hydrateCanvasLocalUploadLayout(document, [before], [after]);
    expect(next.nodes[0].width).toBeGreaterThanOrEqual(782);
    expect(next.nodes[1]).toMatchObject({ width: 622, parentId: "group", position: { x: 80, y: 100 } });
  });
});
