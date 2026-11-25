import { getVideoModelSpec, sora2Models, type Sora2ModelSpec } from "@/lib/sora2";
import { isMiniMaxH3MaxVideoModel } from "@/lib/minimax-models";

export type LiveVideoBatchInputMode = "first_frame" | "multimodal";

export function getLiveVideoBatchInputModes(spec: Sora2ModelSpec): LiveVideoBatchInputMode[] {
  if (spec.supportedInputModes.includes("multimodal")) return ["multimodal"];
  return isMiniMaxH3MaxVideoModel(spec.id) && spec.supportedInputModes.includes("first_frame")
    ? ["first_frame"]
    : [];
}

export function getLiveVideoDurationOptions(spec: Sora2ModelSpec) {
  if (spec.durationOptions?.length) {
    return [...new Set(spec.durationOptions.filter((value) =>
      Number.isInteger(value) && value > 0,
    ))];
  }
  const min = Math.ceil(spec.minDurationSeconds);
  const max = Math.floor(spec.maxDurationSeconds);
  return max < min
    ? []
    : Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

export function supportsLiveVideoDuration(spec: Sora2ModelSpec, duration: unknown) {
  const value = Number(duration);
  return Number.isInteger(value) && getLiveVideoDurationOptions(spec).includes(value);
}

export function supportsLiveVideoBatchModel(spec: Sora2ModelSpec) {
  return getLiveVideoBatchInputModes(spec).length > 0
    && getLiveVideoDurationOptions(spec).length > 0;
}

export function filterLiveVideoBatchModelSpecs(enabledModelIds: Iterable<string>) {
  const enabled = new Set(Array.from(enabledModelIds, (value) => String(value || "").trim()));
  return sora2Models.filter((spec) =>
    enabled.has(spec.id) && supportsLiveVideoBatchModel(spec),
  );
}

export function getLiveVideoBatchModelSpec(modelId: unknown) {
  const normalized = String(modelId || "").trim();
  const spec = sora2Models.find((candidate) => candidate.id === normalized) || null;
  return spec && supportsLiveVideoBatchModel(spec) ? spec : null;
}

export function getLiveVideoBatchSnapshotModelSpec(modelId: unknown) {
  const normalized = String(modelId || "").trim();
  // Retired metadata remains valid for saved tasks, but never enters the active catalog.
  const spec = getVideoModelSpec(normalized);
  return spec?.id === normalized
    && spec.supportedInputModes.some((mode) => mode === "first_frame" || mode === "multimodal")
    && getLiveVideoDurationOptions(spec).length > 0
    ? spec
    : null;
}
