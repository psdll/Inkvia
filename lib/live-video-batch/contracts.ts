export const LIVE_VIDEO_BATCH_MAX_MEDIA = 10;
export const LIVE_VIDEO_BATCH_DEFAULT_DURATION_SECONDS = 4;

export type LiveVideoBatchMode = "live_video";

export type LiveVideoBatchPromptStatus =
  | "prompt_queued"
  | "prompt_running"
  | "prompt_ready"
  | "prompt_failed";

export type LiveVideoBatchOutputStatus =
  | "queued"
  | "submitting"
  | "waiting_provider"
  | "success"
  | "failed"
  | "cancelled";
