import { GOOGLE_NANO_BANANA_21_MODEL } from "@/lib/google-nano-banana-21";
import { APIMART_GPT_IMAGE_26_MODEL_ID } from "@/lib/apimart-image-models";
import prisma from "@/lib/prisma";
import { expandGptImage25ModelOptions, getGptImage25ModelLabel, getGptImage25SelectionValue, isGptImageVariantModel, resolveGptImage25Selection } from "@/lib/gpt-image-25-models";
import { getEffectiveVideoDuration, has30SecondControl, normalizeVideoDurationVisibility, type VideoDurationVisibility } from "@/lib/video-duration-visibility";
import {
  AUDIO_MODEL_DEFINITIONS,
  DOUBAO_SEEDREAM_5_LITE_MODEL,
  DOUBAO_SEEDREAM_5_PRO_MODEL,
  GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL,
  GOOGLE_AI_STUDIO_FLASH_IMAGE_MODEL,
  GOOGLE_AI_STUDIO_PRO_IMAGE_MODEL,
  IMAGE_EDIT_MODEL_DEFINITIONS,
  TOOLBOX_MODEL_DEFINITIONS,
  VIDEO_MODEL_DEFINITIONS,
  getToolboxModelDefinitions,
  type ImageEditModelDefinition,
  type ToolboxModelCategory,
  type ToolboxModelDefinition,
} from "@/lib/toolbox-models";
import {
  REAPI_GPT_IMAGE_2_MODEL_ID,
} from "@/lib/gpt-image-2-official";
import { isMidjourneyV8Model } from "@/lib/midjourney-v8";
import {
  AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID,
  AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID,
} from "@/lib/aicoming-merchant-models";
import {
  getConfigurableSeedanceResolutions,
  getEffectiveVideoResolutions,
  normalizeSeedanceResolutionVisibility,
  type SeedanceResolutionVisibility,
} from "@/lib/video-resolution-visibility";

export {
  AUDIO_MODEL_DEFINITIONS,
  DOUBAO_SEEDREAM_5_LITE_MODEL,
  DOUBAO_SEEDREAM_5_PRO_MODEL,
  GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL,
  GOOGLE_AI_STUDIO_FLASH_IMAGE_MODEL,
  GOOGLE_AI_STUDIO_PRO_IMAGE_MODEL,
  IMAGE_EDIT_MODEL_DEFINITIONS,
  TOOLBOX_MODEL_DEFINITIONS,
  VIDEO_MODEL_DEFINITIONS,
  getToolboxModelDefinitions,
  type ImageEditModelDefinition,
  type ToolboxModelCategory,
  type ToolboxModelDefinition,
};

export const GOOGLE_AI_STUDIO_IMAGE_MODELS = new Set([
  GOOGLE_NANO_BANANA_21_MODEL,
  GOOGLE_AI_STUDIO_FLASH_IMAGE_MODEL,
  GOOGLE_AI_STUDIO_FLASH_LITE_IMAGE_MODEL,
  GOOGLE_AI_STUDIO_PRO_IMAGE_MODEL,
]);

const SETTING_KEY_IMAGE_EDIT_MODEL_VISIBILITY = "image_edit_model_visibility";
const SETTING_KEY_SEEDANCE_RESOLUTION_VISIBILITY = "seedance_video_resolution_visibility";
const SETTING_KEY_VIDEO_DURATION_VISIBILITY = "video_duration_visibility";
const SETTING_KEY_TOOLBOX_MODEL_DISPLAY_NAMES = "toolbox_model_display_names";

function modelIds() {
  return [...new Set([...TOOLBOX_MODEL_DEFINITIONS, ...configurableModelDefinitions()].map((model) => model.id))];
}

function configurableModelDefinitions() {
  return TOOLBOX_MODEL_DEFINITIONS.flatMap((model) => expandGptImage25ModelOptions([{ value: model.id, label: model.label }])
    .map((option) => ({ ...model, id: option.value, label: option.label })));
}

function defaultVisibility() {
  const hiddenGptImage26 = [
    APIMART_GPT_IMAGE_26_MODEL_ID,
    getGptImage25SelectionValue(APIMART_GPT_IMAGE_26_MODEL_ID, "flare"),
    getGptImage25SelectionValue(APIMART_GPT_IMAGE_26_MODEL_ID, "sunburst"),
  ];
  return Object.fromEntries(modelIds().map((id) => [
    id,
    id !== REAPI_GPT_IMAGE_2_MODEL_ID
      && id !== AICOMING_HAIYA_GPT_IMAGE_2_MODEL_ID
      && id !== AICOMING_HAIYA_NANO_BANANA_PRO_MODEL_ID
      && id !== "gpt-image-2-tuzi"
      && !hiddenGptImage26.includes(id),
  ])) as Record<string, boolean>;
}

function normalizeVisibility(input: unknown) {
  const defaults = defaultVisibility();
  const source =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const next = { ...defaults };
  for (const id of modelIds()) {
    if (typeof source[id] === "boolean") next[id] = source[id] as boolean;
  }
  if (typeof source["qwen-image-global-2.1"] !== "boolean" && typeof source["qwen-image-2.1"] === "boolean") {
    next["qwen-image-global-2.1"] = source["qwen-image-2.1"] as boolean;
  }
  for (const model of TOOLBOX_MODEL_DEFINITIONS.filter((model) => isGptImageVariantModel(model.id))) {
    const ids = [getGptImage25SelectionValue(model.id, "flare"), getGptImage25SelectionValue(model.id, "sunburst")];
    for (const id of ids) {
      if (typeof source[id] !== "boolean") next[id] = next[model.id];
    }
    next[model.id] = ids.some((id) => next[id]);
  }
  return next;
}

function parseVisibility(value: string | null | undefined) {
  if (!value) return defaultVisibility();
  try {
    return normalizeVisibility(JSON.parse(value));
  } catch {
    return defaultVisibility();
  }
}

function normalizeDisplayNames(input: unknown) {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const defaults = new Map([...TOOLBOX_MODEL_DEFINITIONS, ...configurableModelDefinitions()].map((model) => [model.id, model.label]));
  const next: Record<string, string> = {};
  for (const id of modelIds()) {
    const label = typeof source[id] === "string" ? source[id].trim() : "";
    if (label && label !== defaults.get(id)) next[id] = label;
  }
  return next;
}

function parseDisplayNames(value: string | null | undefined) {
  if (!value) return {};
  try {
    return normalizeDisplayNames(JSON.parse(value));
  } catch {
    return {};
  }
}

function applyDisplayName<T extends ToolboxModelDefinition>(
  model: T,
  displayNames: Record<string, string>,
  visibility: Record<string, boolean>,
): T {
  const label = displayNames[model.id];
  if (isGptImageVariantModel(model.id)) {
    return {
      ...model,
      label: label || model.label,
      gptImage25Variants: (["flare", "sunburst"] as const)
        .filter((mode) => visibility[getGptImage25SelectionValue(model.id, mode)] !== false)
        .map((mode) => ({ mode, label: displayNames[getGptImage25SelectionValue(model.id, mode)] || getGptImage25ModelLabel(model.id, label || model.label, mode) })),
    };
  }
  return label ? { ...model, label } as T : model;
}

export function normalizeImageEditVisibilityModel(model: string) {
  if (model === "gpt-image-2-text-to-image" || model === "gpt-image-2-image-to-image") {
    return "gpt-image-2";
  }
  return String(model || "").trim();
}

export function isKnownImageEditModel(model: string) {
  const normalized = normalizeImageEditVisibilityModel(model);
  return IMAGE_EDIT_MODEL_DEFINITIONS.some((item) => item.id === normalized);
}

export async function getImageEditModelVisibility() {
  const row = await prisma.appSetting.findUnique({
    where: { key: SETTING_KEY_IMAGE_EDIT_MODEL_VISIBILITY },
  });
  return parseVisibility(row?.value);
}

export async function saveImageEditModelVisibility(visibility: Record<string, boolean>) {
  const normalized = normalizeVisibility(visibility);
  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY_IMAGE_EDIT_MODEL_VISIBILITY },
    create: { key: SETTING_KEY_IMAGE_EDIT_MODEL_VISIBILITY, value: JSON.stringify(normalized) },
    update: { value: JSON.stringify(normalized) },
  });
  return normalized;
}

export async function getToolboxModelDisplayNames() {
  const row = await prisma.appSetting.findUnique({
    where: { key: SETTING_KEY_TOOLBOX_MODEL_DISPLAY_NAMES },
  });
  return parseDisplayNames(row?.value);
}

export async function saveToolboxModelDisplayNames(displayNames: Record<string, string>) {
  const normalized = normalizeDisplayNames(displayNames);
  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY_TOOLBOX_MODEL_DISPLAY_NAMES },
    create: { key: SETTING_KEY_TOOLBOX_MODEL_DISPLAY_NAMES, value: JSON.stringify(normalized) },
    update: { value: JSON.stringify(normalized) },
  });
  return normalized;
}

function parseSeedanceResolutionVisibility(value: string | null | undefined) {
  if (!value) return normalizeSeedanceResolutionVisibility({});
  try {
    return normalizeSeedanceResolutionVisibility(JSON.parse(value));
  } catch {
    return normalizeSeedanceResolutionVisibility({});
  }
}

export async function getSeedanceResolutionVisibility() {
  const row = await prisma.appSetting.findUnique({
    where: { key: SETTING_KEY_SEEDANCE_RESOLUTION_VISIBILITY },
  });
  return parseSeedanceResolutionVisibility(row?.value);
}

export async function saveSeedanceResolutionVisibility(visibility: SeedanceResolutionVisibility) {
  const normalized = normalizeSeedanceResolutionVisibility(visibility);
  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY_SEEDANCE_RESOLUTION_VISIBILITY },
    create: { key: SETTING_KEY_SEEDANCE_RESOLUTION_VISIBILITY, value: JSON.stringify(normalized) },
    update: { value: JSON.stringify(normalized) },
  });
  return normalized;
}

export async function getToolboxModelsOverview() {
  const [visibility, resolutionVisibility, displayNames, durationVisibility] = await Promise.all([
    getImageEditModelVisibility(),
    getSeedanceResolutionVisibility(),
    getToolboxModelDisplayNames(),
    getVideoDurationVisibility(),
  ]);
  return {
    models: configurableModelDefinitions().map((model) => ({
      ...model,
      defaultLabel: model.label,
      label: displayNames[model.id] || (() => {
        const selection = resolveGptImage25Selection(model.id);
        return selection.gptImage25Mode
          ? getGptImage25ModelLabel(selection.model, displayNames[selection.model] || model.label, selection.gptImage25Mode)
          : model.label;
      })(),
      resolutionControls: model.category === "video"
        ? getConfigurableSeedanceResolutions(model.id)
        : [],
      durationControl: model.category === "video" && has30SecondControl(model.id),
    })),
    visibility,
    resolutionVisibility,
    durationVisibility,
    displayNames,
  };
}

export async function getImageEditModelsOverview() {
  return getToolboxModelsOverview();
}

export async function saveToolboxModelVisibility(visibility: Record<string, boolean>) {
  return saveImageEditModelVisibility(visibility);
}

export async function getVisibleToolboxModels(category?: ToolboxModelCategory) {
  const [visibility, displayNames] = await Promise.all([
    getImageEditModelVisibility(),
    getToolboxModelDisplayNames(),
  ]);
  const definitions = getToolboxModelDefinitions(category)
    .filter((model) => !isMidjourneyV8Model(model.id))
    .filter((model) => visibility[model.id] !== false)
    .map((model) => applyDisplayName(model, displayNames, visibility));
  if (!definitions.some((model) => model.category === "video")) return definitions;
  const [resolutionVisibility, durationVisibility] = await Promise.all([getSeedanceResolutionVisibility(), getVideoDurationVisibility()]);
  return definitions.map((model) => model.category === "video"
    ? { ...model, supportedResolutions: getEffectiveVideoResolutions(model.id, resolutionVisibility), ...getEffectiveVideoDuration(model.id, durationVisibility) }
    : model);
}

export async function getVisibleImageEditModels() {
  const [visibility, displayNames] = await Promise.all([
    getImageEditModelVisibility(),
    getToolboxModelDisplayNames(),
  ]);
  return IMAGE_EDIT_MODEL_DEFINITIONS
    .filter((model) => visibility[model.id] !== false)
    .map((model) => applyDisplayName(model, displayNames, visibility));
}

export async function isImageEditModelVisible(model: string, gptImage25Mode?: string) {
  const normalized = normalizeImageEditVisibilityModel(model);
  const visibility = await getImageEditModelVisibility();
  const key = isGptImageVariantModel(normalized) && gptImage25Mode !== undefined
    ? getGptImage25SelectionValue(normalized, gptImage25Mode)
    : normalized;
  return visibility[key] !== false;
}

export async function isVideoModelVisible(model: string, resolution?: string, duration?: number) {
  const normalized = String(model || "").trim();
  const normalizedResolution = String(resolution || "").trim();
  if (normalizedResolution || duration !== undefined) {
    const visibleModel = (await getVisibleToolboxModels("video"))
      .find((definition) => definition.id === normalized);
    return Boolean(visibleModel
      && (!normalizedResolution || visibleModel.supportedResolutions?.includes(normalizedResolution as never))
      && (duration === undefined || !has30SecondControl(normalized)
        || (duration === -1 ? visibleModel.allowAutoDuration : duration <= (visibleModel.maxDurationSeconds ?? 15))));
  }
  const visibility = await getImageEditModelVisibility();
  return visibility[normalized] !== false;
}

export async function getVideoDurationVisibility() {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY_VIDEO_DURATION_VISIBILITY } });
  try { return normalizeVideoDurationVisibility(JSON.parse(row?.value || "{}")); }
  catch { return normalizeVideoDurationVisibility({}); }
}

export async function saveVideoDurationVisibility(visibility: VideoDurationVisibility) {
  const normalized = normalizeVideoDurationVisibility(visibility);
  await prisma.appSetting.upsert({ where: { key: SETTING_KEY_VIDEO_DURATION_VISIBILITY },
    create: { key: SETTING_KEY_VIDEO_DURATION_VISIBILITY, value: JSON.stringify(normalized) },
    update: { value: JSON.stringify(normalized) } });
  return normalized;
}

export async function isAudioModelVisible(model: string) {
  const normalized = String(model || "").trim();
  const visibility = await getImageEditModelVisibility();
  return visibility[normalized] !== false;
}

export async function isFaceModeVisible(mode: string) {
  const normalized = String(mode || "").trim();
  const visibility = await getImageEditModelVisibility();
  return visibility[normalized] !== false;
}
