import { creativeSelectionSchema, imageAngleSchema } from "./types";
import { imageAnglePrompt } from "./angle";
import { composeCanvasModelPrompt } from "@/lib/canvas/text-references";
import { creativeTokenPattern, withLegacyCreativeTokens } from "./inline-token";

export class CanvasCreativeInputError extends Error {}

/** Called once at canvas server boundaries, never from the prompt editor or provider adapters. */
export function composeCanvasCreativePrompt(input: {
  kind: "image" | "video"; prompt: string; textList?: unknown;
  creativePresets?: unknown; imageAngle?: unknown; cameraFixed?: boolean;
}) {
  // Style, filter and motion presets were retired; old selections and inline tags are dropped.
  const parsed = creativeSelectionSchema.safeParse(input.creativePresets ?? {});
  if (!parsed.success) throw new CanvasCreativeInputError("预设设置格式不正确，请重新选择。");
  if (input.kind === "video" && input.imageAngle != null) throw new CanvasCreativeInputError("图片角度仅适用于图片节点。");
  const base = composeCanvasModelPrompt(withLegacyCreativeTokens(input.prompt), input.textList);
  // The character-sheet tag is resolved before submission; reaching the provider boundary is an error.
  if (creativeTokenPattern().test(base)) throw new CanvasCreativeInputError("所选预设不存在，请重新选择。");
  const sections: string[] = [];
  if (input.imageAngle != null) {
    const angle = imageAngleSchema.safeParse(input.imageAngle);
    if (!angle.success) throw new CanvasCreativeInputError("图片角度参数无效，请重新调整。");
    sections.push(`【相机视角要求】\n${imageAnglePrompt(angle.data)}`);
  }
  if (!sections.length) return base;
  const boundary = "主体身份、产品结构和内容遵循正文与参考素材。若选择角度，观察方向及取景以角度要求为准。";
  return [base, boundary, ...sections].filter(Boolean).join("\n\n");
}
