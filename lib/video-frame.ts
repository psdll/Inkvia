export const VIDEO_FRAME_LABELS = {
  current: "当前帧",
  first: "首帧",
  last: "尾帧",
} as const;

export type VideoFrameMode = keyof typeof VIDEO_FRAME_LABELS;

export function videoFrameNodeName(mode: VideoFrameMode, time: number) {
  if (mode !== "current") return VIDEO_FRAME_LABELS[mode];
  const milliseconds = Math.max(0, Math.floor(time * 1000));
  const minutes = String(Math.floor(milliseconds / 60000)).padStart(2, "0");
  const seconds = String(Math.floor(milliseconds / 1000) % 60).padStart(2, "0");
  return `截图 ${minutes}:${seconds}.${String(milliseconds % 1000).padStart(3, "0")}`;
}

export function isVideoFrameMode(value: string): value is VideoFrameMode {
  return Object.prototype.hasOwnProperty.call(VIDEO_FRAME_LABELS, value);
}

export function videoFrameTime(mode: VideoFrameMode, currentTime: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("视频时长尚未就绪，请稍后重试");
  // Stay inside the final frame, including short clips and variable frame rates.
  const end = Math.max(0, duration - 0.000001);
  if (mode === "first") return 0;
  if (mode === "last") return end;
  return Math.min(Math.max(Number.isFinite(currentTime) ? currentTime : 0, 0), end);
}
