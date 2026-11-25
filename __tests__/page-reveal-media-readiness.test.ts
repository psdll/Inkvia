import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isElementInRevealViewport,
  waitForPageMedia,
} from "@/lib/page-reveal/media-readiness";

function makeVisible(element: Element) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 10,
    y: 10,
    top: 10,
    right: 210,
    bottom: 130,
    left: 10,
    width: 200,
    height: 120,
    toJSON: () => ({}),
  });
}

function setReadonlyValue(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, {
    configurable: true,
    value,
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("page reveal media readiness", () => {
  it("waits for a visible image to load and decode", async () => {
    const root = document.createElement("main");
    const image = document.createElement("img");
    image.src = "/preview.png";
    makeVisible(image);
    setReadonlyValue(image, "complete", false);
    setReadonlyValue(image, "naturalWidth", 320);
    const decode = vi.fn().mockResolvedValue(undefined);
    setReadonlyValue(image, "decode", decode);
    root.append(image);
    document.body.append(root);

    const waiting = waitForPageMedia(root, { timeoutMs: 1000, settleFrames: 0 });
    await Promise.resolve();
    image.dispatchEvent(new Event("load"));

    await expect(waiting).resolves.toEqual({ timedOut: false });
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("treats an image error as settled instead of blocking the page", async () => {
    const root = document.createElement("main");
    const image = document.createElement("img");
    makeVisible(image);
    setReadonlyValue(image, "complete", false);
    root.append(image);
    document.body.append(root);

    const waiting = waitForPageMedia(root, { timeoutMs: 1000, settleFrames: 0 });
    await Promise.resolve();
    image.dispatchEvent(new Event("error"));

    await expect(waiting).resolves.toEqual({ timedOut: false });
  });

  it("ignores media outside the current viewport", async () => {
    const root = document.createElement("main");
    const image = document.createElement("img");
    setReadonlyValue(image, "complete", false);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 2000,
      top: 2000,
      right: 200,
      bottom: 2120,
      left: 0,
      width: 200,
      height: 120,
      toJSON: () => ({}),
    });
    root.append(image);
    document.body.append(root);

    expect(isElementInRevealViewport(image)).toBe(false);
    await expect(
      waitForPageMedia(root, { timeoutMs: 30, settleFrames: 0, quietMs: 0 }),
    ).resolves.toEqual({ timedOut: false });
  });

  it("waits for video metadata when no poster is available", async () => {
    const root = document.createElement("main");
    const video = document.createElement("video");
    video.src = "/clip.mp4";
    makeVisible(video);
    setReadonlyValue(video, "readyState", 0);
    root.append(video);
    document.body.append(root);

    const waiting = waitForPageMedia(root, { timeoutMs: 1000, settleFrames: 0 });
    await Promise.resolve();
    video.dispatchEvent(new Event("loadedmetadata"));

    await expect(waiting).resolves.toEqual({ timedOut: false });
  });

  it("waits for a video poster to decode without downloading the full video", async () => {
    const root = document.createElement("main");
    const video = document.createElement("video");
    video.src = "/long-clip.mp4";
    video.poster = "/poster.jpg";
    makeVisible(video);
    setReadonlyValue(video, "readyState", 0);
    root.append(video);
    document.body.append(root);

    const poster = document.createElement("img");
    setReadonlyValue(poster, "complete", true);
    setReadonlyValue(poster, "naturalWidth", 640);
    const decode = vi.fn().mockResolvedValue(undefined);
    setReadonlyValue(poster, "decode", decode);
    const imageConstructor = vi.fn(() => poster);
    vi.stubGlobal("Image", imageConstructor);

    const waiting = waitForPageMedia(root, { timeoutMs: 1000, settleFrames: 0 });
    await Promise.resolve();
    video.dispatchEvent(new Event("loadedmetadata"));

    await expect(waiting).resolves.toEqual({ timedOut: false });
    expect(imageConstructor).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("includes visible media inserted during the DOM stability window", async () => {
    const root = document.createElement("main");
    document.body.append(root);

    const waiting = waitForPageMedia(root, { timeoutMs: 1000, settleFrames: 0, quietMs: 40 });
    await new Promise((resolve) => window.setTimeout(resolve, 10));

    const image = document.createElement("img");
    makeVisible(image);
    setReadonlyValue(image, "complete", false);
    setReadonlyValue(image, "naturalWidth", 320);
    const decode = vi.fn().mockResolvedValue(undefined);
    setReadonlyValue(image, "decode", decode);
    root.append(image);
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    image.dispatchEvent(new Event("load"));

    await expect(waiting).resolves.toEqual({ timedOut: false });
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("does not restart the stability window for non-media DOM churn", async () => {
    const root = document.createElement("main");
    document.body.append(root);

    const startedAt = Date.now();
    const waiting = waitForPageMedia(root, { timeoutMs: 1000, settleFrames: 0, quietMs: 40 });
    const timer = window.setInterval(() => {
      const status = document.createElement("span");
      status.textContent = String(Date.now());
      root.append(status);
    }, 5);

    await expect(waiting).resolves.toEqual({ timedOut: false });
    window.clearInterval(timer);
    expect(Date.now() - startedAt).toBeLessThan(300);
  });

  it("uses a safety timeout for media that never settles", async () => {
    const root = document.createElement("main");
    const image = document.createElement("img");
    makeVisible(image);
    setReadonlyValue(image, "complete", false);
    root.append(image);
    document.body.append(root);

    await expect(
      waitForPageMedia(root, { timeoutMs: 10, settleFrames: 0 }),
    ).resolves.toEqual({ timedOut: true });
  });
});
