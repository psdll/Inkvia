import { isMiniMaxH3VideoModel } from "@/lib/minimax-models";
import { isWanVideoModel } from "@/lib/wan-models";
import { isSeedance20VideoModel, SEEDANCE_25_MODEL_ID, APIMART_SEEDANCE_25_MODEL_ID } from "@/lib/sora2";
import { buildPromptWithAssetReferences, type PromptAssetKind, type PromptReferenceOptions } from "@/lib/prompt-asset-references";

export type GenerationPromptMedia = { kind: PromptAssetKind; url?: string };

// All generation entry points submit raw prompts; model-specific formatting lives here.
export function generationReferenceFormat(kind: "image" | "video", model: string): NonNullable<PromptReferenceOptions["format"]> {
  if (kind === "image") return "ordinal";
  const modelId = String(model || "").trim();
  if (modelId === SEEDANCE_25_MODEL_ID) return "seedance25_mentions";
  if (modelId === APIMART_SEEDANCE_25_MODEL_ID) return "apimart_seedance25_mentions";
  if (isWanVideoModel(modelId)) return "wan_mentions";
  if (isSeedance20VideoModel(modelId) || isMiniMaxH3VideoModel(modelId)) return "ordinal";
  return "reference_map";
}

export function buildGenerationPrompt(input: {
  kind: "image" | "video";
  model: string;
  prompt: string;
  media: readonly GenerationPromptMedia[];
}) {
  const counts = { image: 0, video: 0, audio: 0 };
  const labels = { image: "图片", video: "视频", audio: "音频" };
  const assets = input.media.map((media, index) => ({
    ...media,
    id: `input-${index}`,
    token: `${labels[media.kind]}${++counts[media.kind]}`,
  }));
  return buildPromptWithAssetReferences(input.prompt, assets, {
    format: generationReferenceFormat(input.kind, input.model),
  });
}
