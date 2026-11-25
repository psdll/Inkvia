import { getVideoModelSpec, SEEDANCE_25_MODEL_ID, APIMART_SEEDANCE_25_MODEL_ID } from "@/lib/sora2";
import { WAN_VIDEO_MODEL_ID } from "@/lib/wan-models";

export const CONFIGURABLE_30_SECOND_MODELS = [SEEDANCE_25_MODEL_ID, APIMART_SEEDANCE_25_MODEL_ID, WAN_VIDEO_MODEL_ID];
export type VideoDurationVisibility = Record<string, boolean>;

export function has30SecondControl(modelId: string) {
  return CONFIGURABLE_30_SECOND_MODELS.some((id) => id === modelId);
}

export function normalizeVideoDurationVisibility(input: unknown): VideoDurationVisibility {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown> : {};
  return Object.fromEntries(CONFIGURABLE_30_SECOND_MODELS.map((id) => [id, source[id] !== false]));
}

export function getEffectiveVideoDuration(modelId: string, visibility: VideoDurationVisibility) {
  const spec = getVideoModelSpec(modelId);
  const limited = has30SecondControl(modelId) && visibility[modelId] === false;
  return {
    maxDurationSeconds: limited ? 15 : spec.maxDurationSeconds,
    allowAutoDuration: spec.allowAutoDuration,
  };
}
