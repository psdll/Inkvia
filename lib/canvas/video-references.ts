import { getVideoReferenceLimits } from "@/lib/sora2";

export type CanvasVideoReference = { kind: string };

export function getCanvasVideoReferenceError(
  model: string,
  references: readonly CanvasVideoReference[],
  inputMode?: string,
  requireComplete = false,
): string | null {
  const images = references.filter(reference => reference.kind === "image").length;
  const videos = references.filter(reference => reference.kind === "video").length;
  const audios = references.filter(reference => reference.kind === "audio").length;
  const limits = getVideoReferenceLimits(model);
  if (limits) {
    if (images > limits.images) return `该模型最多支持 ${limits.images} 张参考图片`;
    if (videos > limits.videos) return limits.videos ? `该模型最多支持 ${limits.videos} 个参考视频` : "该模型不支持视频参考素材";
    if (audios > limits.audios) return limits.audios ? `该模型最多支持 ${limits.audios} 个参考音频` : "该模型不支持音频参考素材";
    if (references.length > limits.total) return `该模型最多支持 ${limits.total} 个参考素材`;
    if (requireComplete && audios > 0 && !limits.standaloneAudio && images + videos === 0) return "该模型的音频不能作为唯一参考素材，请同时添加图片或视频";
  }
  if (inputMode === "first_frame" || inputMode === "first_last_frame") {
    const count = inputMode === "first_frame" ? 1 : 2;
    if (videos || audios || images > count || (requireComplete && images !== count)) {
      return inputMode === "first_frame" ? "首帧图模式需要 1 张图片" : "首尾帧模式需要 2 张图片，分别作为首帧和尾帧";
    }
  }
  return null;
}
