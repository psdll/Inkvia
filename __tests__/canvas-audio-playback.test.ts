import { describe, expect, it, vi } from "vitest";

function createAudio() {
  const audio = {
    src: "",
    currentTime: 0,
    duration: 90,
    paused: true,
    ended: false,
    play: vi.fn<() => Promise<void>>(),
    pause: vi.fn<() => void>(),
    load: vi.fn(),
    removeAttribute: vi.fn<(name: string) => void>(),
  };
  audio.play.mockImplementation(async () => {
    audio.paused = false;
    audio.ended = false;
  });
  audio.pause.mockImplementation(() => {
    audio.paused = true;
  });
  audio.removeAttribute.mockImplementation((name) => {
    if (name === "src") audio.src = "";
  });
  return audio;
}

describe("canvas audio playback controller", () => {
  it("switches playback to the newest node and clears the previous snapshot", async () => {
    const module = await import("@/lib/canvas/audio-playback").catch(() => ({}));
    const createCanvasAudioPlaybackController = (module as any).createCanvasAudioPlaybackController;
    expect(createCanvasAudioPlaybackController).toBeTypeOf("function");
    const audio = createAudio();
    const controller = createCanvasAudioPlaybackController(audio);

    await controller.play("audio-a", "/a.mp3", 12);
    await controller.play("audio-b", "/b.mp3", 20);

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.src).toBe("/b.mp3");
    expect(controller.snapshot("audio-a").isPlaying).toBe(false);
    expect(controller.snapshot("audio-b")).toMatchObject({ active: true, isPlaying: true, durationSeconds: 20 });
  });

  it("toggles pause and resume on the active node", async () => {
    const module = await import("@/lib/canvas/audio-playback").catch(() => ({}));
    const createCanvasAudioPlaybackController = (module as any).createCanvasAudioPlaybackController;
    expect(createCanvasAudioPlaybackController).toBeTypeOf("function");
    const audio = createAudio();
    const controller = createCanvasAudioPlaybackController(audio);

    await controller.toggle("audio-a", "/a.mp3", 12);
    await controller.toggle("audio-a", "/a.mp3", 12);
    expect(controller.snapshot("audio-a").isPlaying).toBe(false);
    await controller.toggle("audio-a", "/a.mp3", 12);

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(controller.snapshot("audio-a").isPlaying).toBe(true);
  });

  it("prepares and clamps a seek without starting playback", async () => {
    const module = await import("@/lib/canvas/audio-playback").catch(() => ({}));
    const createCanvasAudioPlaybackController = (module as any).createCanvasAudioPlaybackController;
    expect(createCanvasAudioPlaybackController).toBeTypeOf("function");
    const audio = createAudio();
    const controller = createCanvasAudioPlaybackController(audio);

    controller.seek("audio-a", "/a.mp3", 99, 40);

    expect(audio.src).toBe("/a.mp3");
    expect(audio.currentTime).toBe(40);
    expect(audio.play).not.toHaveBeenCalled();
    expect(controller.snapshot("audio-a")).toMatchObject({ active: true, isPlaying: false, currentTime: 40, durationSeconds: 40 });
  });

  it("retries a seek after metadata becomes available", async () => {
    const module = await import("@/lib/canvas/audio-playback").catch(() => ({}));
    const createCanvasAudioPlaybackController = (module as any).createCanvasAudioPlaybackController;
    expect(createCanvasAudioPlaybackController).toBeTypeOf("function");
    const audio = createAudio();
    let storedTime = 0;
    let metadataReady = false;
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      get: () => storedTime,
      set: (value: number) => {
        if (!metadataReady && value > 0) throw new DOMException("metadata pending", "InvalidStateError");
        storedTime = value;
      },
    });
    const controller = createCanvasAudioPlaybackController(audio);

    controller.seek("audio-a", "/a.mp3", 30, 60);
    expect(controller.snapshot("audio-a").currentTime).toBe(30);
    expect(storedTime).toBe(0);

    metadataReady = true;
    controller.syncFromTarget();

    expect(storedTime).toBe(30);
    expect(controller.snapshot("audio-a").currentTime).toBe(30);
  });

  it("publishes progress only to the active node subscriber", async () => {
    const module = await import("@/lib/canvas/audio-playback").catch(() => ({}));
    const createCanvasAudioPlaybackController = (module as any).createCanvasAudioPlaybackController;
    expect(createCanvasAudioPlaybackController).toBeTypeOf("function");
    const audio = createAudio();
    const controller = createCanvasAudioPlaybackController(audio);
    const notifyA = vi.fn();
    const notifyB = vi.fn();
    controller.subscribe("audio-a", notifyA);
    controller.subscribe("audio-b", notifyB);
    await controller.play("audio-b", "/b.mp3", 20);
    notifyA.mockClear();
    notifyB.mockClear();

    audio.currentTime = 7;
    controller.syncFromTarget();

    expect(notifyA).not.toHaveBeenCalled();
    expect(notifyB).toHaveBeenCalledOnce();
    expect(controller.snapshot("audio-b").currentTime).toBe(7);
  });

  it("stops and releases the media when the active node is deleted", async () => {
    const module = await import("@/lib/canvas/audio-playback").catch(() => ({}));
    const createCanvasAudioPlaybackController = (module as any).createCanvasAudioPlaybackController;
    expect(createCanvasAudioPlaybackController).toBeTypeOf("function");
    const audio = createAudio();
    const controller = createCanvasAudioPlaybackController(audio);
    await controller.play("audio-a", "/a.mp3", 12);
    audio.pause.mockClear();

    controller.retainNodes(new Set());

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.removeAttribute).toHaveBeenCalledWith("src");
    expect(audio.load).toHaveBeenCalled();
    expect(controller.snapshot("audio-a").active).toBe(false);
  });

  it("keeps a rejected playback request visibly paused", async () => {
    const module = await import("@/lib/canvas/audio-playback").catch(() => ({}));
    const createCanvasAudioPlaybackController = (module as any).createCanvasAudioPlaybackController;
    expect(createCanvasAudioPlaybackController).toBeTypeOf("function");
    const audio = createAudio();
    audio.play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    const controller = createCanvasAudioPlaybackController(audio);

    await expect(controller.play("audio-a", "/a.mp3", 12)).resolves.toBe(false);

    expect(controller.snapshot("audio-a")).toMatchObject({ active: true, isPlaying: false, error: "音频播放失败" });
  });
});
