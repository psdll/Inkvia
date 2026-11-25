import {
  isApimartVideoModel,
  isVolcengineVideoModel,
  sora2Models,
  type Sora2ModelSpec,
  type Sora2ResolutionValue,
} from "@/lib/sora2";
import { isMiniMaxH3VideoModel } from "@/lib/minimax-models";
import { isWanVideoModel } from "@/lib/wan-models";
import { has30SecondControl } from "@/lib/video-duration-visibility";

export const CONFIGURABLE_SEEDANCE_RESOLUTIONS = ["1080p", "2k", "4k"] as const;

export type ConfigurableSeedanceResolution = typeof CONFIGURABLE_SEEDANCE_RESOLUTIONS[number];

export type SeedanceResolutionVisibility = Record<
  string,
  Partial<Record<ConfigurableSeedanceResolution, boolean>>
>;

export type VideoModelCapabilityPayload = {
  id?: unknown;
  label?: unknown;
  supportedResolutions?: unknown;
  maxDurationSeconds?: unknown;
  allowAutoDuration?: unknown;
};

function findVideoSpec(modelId: string) {
  const id = String(modelId || "").trim();
  return sora2Models.find((model) => model.id === id);
}

function isSeedanceModel(modelId: string) {
  return isVolcengineVideoModel(modelId) || isApimartVideoModel(modelId);
}

function hasConfigurableResolution(modelId: string) {
  return isSeedanceModel(modelId) || isMiniMaxH3VideoModel(modelId) || isWanVideoModel(modelId);
}

export function getConfigurableSeedanceResolutions(modelId: string): ConfigurableSeedanceResolution[] {
  const spec = findVideoSpec(modelId);
  if (!spec || !hasConfigurableResolution(spec.id)) return [];
  return CONFIGURABLE_SEEDANCE_RESOLUTIONS.filter((resolution) =>
    spec.supportedResolutions.includes(resolution),
  );
}

export function normalizeSeedanceResolutionVisibility(input: unknown): SeedanceResolutionVisibility {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const normalized: SeedanceResolutionVisibility = {};

  for (const spec of sora2Models) {
    if (!hasConfigurableResolution(spec.id)) continue;
    const controls = getConfigurableSeedanceResolutions(spec.id);
    const rawModel = source[spec.id] && typeof source[spec.id] === "object" && !Array.isArray(source[spec.id])
      ? source[spec.id] as Record<string, unknown>
      : {};
    normalized[spec.id] = Object.fromEntries(
      controls.map((resolution) => [
        resolution,
        typeof rawModel[resolution] === "boolean" ? rawModel[resolution] : true,
      ]),
    );
  }

  return normalized;
}

export function getEffectiveVideoResolutions(
  modelId: string,
  visibility: SeedanceResolutionVisibility,
): Sora2ResolutionValue[] {
  const spec = findVideoSpec(modelId);
  if (!spec) return [];
  const controls = new Set(getConfigurableSeedanceResolutions(spec.id));
  return spec.supportedResolutions.filter((resolution) =>
    !controls.has(resolution as ConfigurableSeedanceResolution)
      || visibility[spec.id]?.[resolution as ConfigurableSeedanceResolution] !== false,
  );
}

function getFailClosedResolutions(spec: Sora2ModelSpec): Sora2ResolutionValue[] {
  if (!hasConfigurableResolution(spec.id)) return [...spec.supportedResolutions];
  return spec.supportedResolutions.filter((resolution) =>
    !CONFIGURABLE_SEEDANCE_RESOLUTIONS.includes(resolution as ConfigurableSeedanceResolution),
  );
}

export function getVideoDisplaySpec(
  modelId: string,
  payload: readonly VideoModelCapabilityPayload[] = [],
): Sora2ModelSpec {
  const spec = findVideoSpec(modelId) || sora2Models[0];
  const item = payload.find((candidate) => String(candidate?.id || "").trim() === spec.id);
  const allowed = Array.isArray(item?.supportedResolutions)
    ? item.supportedResolutions
        .map(String)
        .filter((resolution): resolution is Sora2ResolutionValue =>
          spec.supportedResolutions.includes(resolution as Sora2ResolutionValue),
        )
    : [];

  return {
    ...spec,
    label: String(item?.label || "").trim() || spec.label,
    ...(has30SecondControl(spec.id) ? {
      maxDurationSeconds: item?.maxDurationSeconds === 30 ? 30 : 15,
    } : {}),
    supportedResolutions: allowed.length ? allowed : getFailClosedResolutions(spec),
  };
}

export function getVideoDisplayResolution(spec: Sora2ModelSpec, current: unknown): Sora2ResolutionValue {
  const normalized = String(current || "");
  return spec.supportedResolutions.find((resolution) => resolution === normalized)
    || spec.supportedResolutions[0]
    || "720p";
}
