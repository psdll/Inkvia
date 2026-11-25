import { describe, expect, it, vi } from "vitest";

import { createCanvasVideoPlaybackController, formatCanvasVideoTime } from "@/lib/canvas/video-playback";

function createVideo() {
  return {
    muted: true,
    currentTime: 4,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    load: vi.fn(),
  };
}

describe("canvas video playback controller", () => {
  it("formats control times as minutes and zero-padded seconds", () => {
    expect(formatCanvasVideoTime(0)).toBe("0:00");
    expect(formatCanvasVideoTime(9.8)).toBe("0:09");
    expect(formatCanvasVideoTime(70)).toBe("1:10");
    expect(formatCanvasVideoTime(Number.NaN)).toBe("0:00");
  });

  it("plays with sound on hover and resets without reloading on mouse leave", async () => {
    const controller = createCanvasVideoPlaybackController();
    const video = createVideo();

    await controller.hoverStart(video);

    expect(video.muted).toBe(false);
    expect(video.play).toHaveBeenCalledOnce();

    controller.hoverEnd(video);

    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(0);
    expect(video.load).not.toHaveBeenCalled();
  });

  it("keeps clicked playback running after mouse leave", async () => {
    const controller = createCanvasVideoPlaybackController();
    const video = createVideo();

    await controller.lockAndPlay(video);
    controller.hoverEnd(video);

    expect(controller.isLocked()).toBe(true);
    expect(video.muted).toBe(false);
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.load).not.toHaveBeenCalled();
  });

  it("unlocks and resets without reloading after natural completion", async () => {
    const controller = createCanvasVideoPlaybackController();
    const video = createVideo();

    await controller.lockAndPlay(video);
    controller.ended(video);

    expect(controller.isLocked()).toBe(false);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(0);
    expect(video.load).not.toHaveBeenCalled();
  });

  it("does not retry muted when unmuted autoplay is rejected", async () => {
    const controller = createCanvasVideoPlaybackController();
    const video = createVideo();
    video.play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));

    await expect(controller.hoverStart(video)).resolves.toBeUndefined();

    expect(video.muted).toBe(false);
    expect(video.play).toHaveBeenCalledOnce();
  });
});
