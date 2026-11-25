import {
  AGENT_AUDIO_RESULTS_FOLDER,
  AGENT_IMAGE_RESULTS_FOLDER,
  AGENT_VIDEO_RESULTS_FOLDER,
} from "@/lib/upload-buckets";

export function generationOutputFolder(type: string, source?: string) {
  const normalizedType = String(type || "");
  const isCanvas = source === "canvas";
  const isBatch = source === "batch";
  const isAudio = normalizedType === "audio_gen" || normalizedType === "audio_generate" || normalizedType === "audio";
  const isVideo = normalizedType === "video_gen" || normalizedType === "video_generate";

  if (source === "agent") {
    if (isAudio) return AGENT_AUDIO_RESULTS_FOLDER;
    if (isVideo) return AGENT_VIDEO_RESULTS_FOLDER;
    return AGENT_IMAGE_RESULTS_FOLDER;
  }

  if (isCanvas && isAudio) {
    return "canvas_audio_results";
  }
  if (isVideo) {
    return isCanvas ? "canvas_video_results" : "video_results";
  }
  if (normalizedType === "face_swap") return "face_results";
  if (isBatch) return "batch-image_results";
  return isCanvas ? "canvas_image_results" : "image_results";
}
