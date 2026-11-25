export type CanvasVideoPlaybackTarget = {
  muted: boolean;
  currentTime: number;
  play: () => Promise<void> | void;
  pause: () => void;
};

export type CanvasVideoPlaybackController = {
  hoverStart: (video: CanvasVideoPlaybackTarget) => Promise<void>;
  hoverEnd: (video: CanvasVideoPlaybackTarget) => void;
  lockAndPlay: (video: CanvasVideoPlaybackTarget) => Promise<void>;
  ended: (video: CanvasVideoPlaybackTarget) => void;
  reset: (video: CanvasVideoPlaybackTarget) => void;
  isLocked: () => boolean;
};

export function formatCanvasVideoTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function resetVideo(video: CanvasVideoPlaybackTarget) {
  video.pause();
  video.currentTime = 0;
}

async function requestUnmutedPlayback(video: CanvasVideoPlaybackTarget) {
  video.muted = false;
  try {
    await video.play();
  } catch {}
}

export function createCanvasVideoPlaybackController(): CanvasVideoPlaybackController {
  let locked = false;

  return {
    hoverStart: async (video) => {
      if (!locked) await requestUnmutedPlayback(video);
    },
    hoverEnd: (video) => {
      if (!locked) resetVideo(video);
    },
    lockAndPlay: async (video) => {
      locked = true;
      await requestUnmutedPlayback(video);
    },
    ended: (video) => {
      locked = false;
      resetVideo(video);
    },
    reset: (video) => {
      locked = false;
      resetVideo(video);
    },
    isLocked: () => locked,
  };
}
