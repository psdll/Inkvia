export type CanvasAudioPlaybackTarget = {
  src: string;
  currentTime: number;
  duration: number;
  paused: boolean;
  ended: boolean;
  play: () => Promise<void> | void;
  pause: () => void;
  load: () => void;
  removeAttribute: (name: string) => void;
};

export type CanvasAudioPlaybackSnapshot = Readonly<{
  active: boolean;
  isPlaying: boolean;
  currentTime: number;
  durationSeconds: number;
  error: string | null;
}>;

const INACTIVE_SNAPSHOT: CanvasAudioPlaybackSnapshot = Object.freeze({
  active: false,
  isPlaying: false,
  currentTime: 0,
  durationSeconds: 0,
  error: null,
});

function finiteNonNegative(value: number, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function createCanvasAudioPlaybackController(initialTarget?: CanvasAudioPlaybackTarget) {
  let target: CanvasAudioPlaybackTarget | null = initialTarget ?? null;
  let activeNodeId: string | null = null;
  let activeUrl = "";
  let activeSnapshot: CanvasAudioPlaybackSnapshot = INACTIVE_SNAPSHOT;
  let pendingSeekSeconds: number | null = null;
  let frameId: number | null = null;
  const listeners = new Map<string, Set<() => void>>();

  const notify = (nodeId: string | null) => {
    if (!nodeId) return;
    for (const listener of listeners.get(nodeId) ?? []) listener();
  };

  const publish = (patch: Partial<CanvasAudioPlaybackSnapshot>) => {
    if (!activeNodeId) return;
    activeSnapshot = { ...activeSnapshot, ...patch, active: true };
    notify(activeNodeId);
  };

  const stopProgressLoop = () => {
    if (frameId === null || typeof cancelAnimationFrame !== "function") return;
    cancelAnimationFrame(frameId);
    frameId = null;
  };

  const syncFromTarget = () => {
    if (!target || !activeNodeId) return;
    const duration = finiteNonNegative(target.duration, activeSnapshot.durationSeconds);
    if (pendingSeekSeconds !== null) {
      try {
        target.currentTime = clamp(pendingSeekSeconds, 0, duration || Number.MAX_SAFE_INTEGER);
        pendingSeekSeconds = null;
      } catch {
        // Metadata is still unavailable; keep the requested position for the next media event.
      }
    }
    const currentTime = pendingSeekSeconds ?? clamp(finiteNonNegative(target.currentTime), 0, duration || Number.MAX_SAFE_INTEGER);
    const isPlaying = !target.paused && !target.ended;
    publish({ currentTime, durationSeconds: duration, isPlaying });
    if (!isPlaying) stopProgressLoop();
  };

  const startProgressLoop = () => {
    if (frameId !== null || !activeSnapshot.isPlaying || typeof requestAnimationFrame !== "function") return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      syncFromTarget();
      startProgressLoop();
    });
  };

  const prepare = (nodeId: string, url: string, durationHint: number) => {
    if (!target) return false;
    if (activeNodeId === nodeId && activeUrl === url) {
      if (!activeSnapshot.durationSeconds && durationHint > 0) publish({ durationSeconds: durationHint });
      return true;
    }
    const previousNodeId = activeNodeId;
    if (previousNodeId && !target.paused) target.pause();
    stopProgressLoop();
    activeNodeId = nodeId;
    activeUrl = url;
    pendingSeekSeconds = null;
    activeSnapshot = {
      active: true,
      isPlaying: false,
      currentTime: 0,
      durationSeconds: finiteNonNegative(durationHint),
      error: null,
    };
    target.src = url;
    target.currentTime = 0;
    target.load();
    notify(previousNodeId);
    notify(activeNodeId);
    return true;
  };

  const stop = () => {
    const previousNodeId = activeNodeId;
    stopProgressLoop();
    if (target) {
      target.pause();
      target.removeAttribute("src");
      target.load();
    }
    activeNodeId = null;
    activeUrl = "";
    pendingSeekSeconds = null;
    activeSnapshot = INACTIVE_SNAPSHOT;
    notify(previousNodeId);
  };

  const controller = {
    attach(nextTarget: CanvasAudioPlaybackTarget | null) {
      target = nextTarget;
    },
    subscribe(nodeId: string, listener: () => void) {
      const current = listeners.get(nodeId) ?? new Set<() => void>();
      current.add(listener);
      listeners.set(nodeId, current);
      return () => {
        current.delete(listener);
        if (!current.size) listeners.delete(nodeId);
      };
    },
    snapshot(nodeId: string): CanvasAudioPlaybackSnapshot {
      return activeNodeId === nodeId ? activeSnapshot : INACTIVE_SNAPSHOT;
    },
    async play(nodeId: string, url: string, durationHint = 0) {
      if (!prepare(nodeId, url, durationHint) || !target) return false;
      if (target.ended) target.currentTime = 0;
      try {
        await target.play();
        publish({
          currentTime: finiteNonNegative(target.currentTime),
          durationSeconds: activeSnapshot.durationSeconds || finiteNonNegative(durationHint),
          isPlaying: true,
          error: null,
        });
        startProgressLoop();
        return true;
      } catch {
        publish({ isPlaying: false, error: "音频播放失败" });
        stopProgressLoop();
        return false;
      }
    },
    async toggle(nodeId: string, url: string, durationHint = 0) {
      if (activeNodeId === nodeId && activeSnapshot.isPlaying && target) {
        target.pause();
        publish({ isPlaying: false });
        stopProgressLoop();
        return false;
      }
      return controller.play(nodeId, url, durationHint);
    },
    seek(nodeId: string, url: string, seconds: number, durationHint = 0) {
      if (!prepare(nodeId, url, durationHint) || !target) return;
      const duration = activeSnapshot.durationSeconds || finiteNonNegative(durationHint) || finiteNonNegative(target.duration);
      const currentTime = clamp(finiteNonNegative(seconds), 0, duration || Number.MAX_SAFE_INTEGER);
      try {
        target.currentTime = currentTime;
        pendingSeekSeconds = null;
      } catch {
        pendingSeekSeconds = currentTime;
      }
      publish({ currentTime, durationSeconds: duration });
    },
    syncFromTarget,
    ended() {
      if (!activeNodeId) return;
      stopProgressLoop();
      publish({
        currentTime: activeSnapshot.durationSeconds,
        isPlaying: false,
      });
    },
    fail(message = "音频加载失败") {
      if (!activeNodeId) return;
      stopProgressLoop();
      publish({ isPlaying: false, error: message });
    },
    retainNodes(nodeIds: ReadonlySet<string>) {
      if (activeNodeId && !nodeIds.has(activeNodeId)) stop();
    },
    stop,
  };

  return controller;
}

export type CanvasAudioPlaybackController = ReturnType<typeof createCanvasAudioPlaybackController>;
