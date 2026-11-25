import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import { collectCanvasTaskAssets } from "@/lib/canvas/task-references";
import { isSeedAudioModel, validateSeedAudioReferences, type SeedAudioMediaReference } from "@/lib/seed-audio-models";

export function getCanvasAudioModelReferenceError(model: string, assets: readonly { kind: string }[]) {
  if (isSeedAudioModel(model)) return null;
  if (assets.some((asset) => asset.kind === "image")) return "该模型不支持图片参考";
  if (assets.some((asset) => asset.kind === "video")) return "该模型不支持视频参考";
  if (assets.some((asset) => asset.kind === "audio")) return "该模型不支持音频参考";
  return null;
}

export function buildCanvasSeedAudioInput(document: CanvasDocumentV2, nodeId: string, text: string) {
  const references: SeedAudioMediaReference[] = collectCanvasTaskAssets(document, nodeId).map((asset) => {
    if (asset.kind !== "image" && asset.kind !== "audio") throw new Error("Seed Audio 只支持图片或音频参考");
    return { kind: asset.kind, url: asset.url || "", ...(asset.durationSeconds !== undefined ? { durationSeconds: asset.durationSeconds } : {}) };
  });
  validateSeedAudioReferences(references);
  return { text, references };
}
