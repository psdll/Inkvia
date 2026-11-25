import { isSeedream55Model } from "@/lib/volcengine-seedream-55";
import { supportsGptImage26Gif } from "@/lib/gpt-image-26-animation";
import { normalizeGoogleImageSettings } from "@/lib/google-image-settings";
import { isOpenRouterImageModel } from "@/lib/openrouter-image-params";
import { supportsImageBackground, getImageBackgroundOptions, isGptImageVariantModel } from "@/lib/gpt-image-25-models";
import type { CanvasNodeData } from "@/lib/canvas/document";
import { isSeedAudioModel, SEED_AUDIO_DEFAULT_FORMAT, SEED_AUDIO_DEFAULT_SAMPLE_RATE, SEED_AUDIO_FORMATS, SEED_AUDIO_SAMPLE_RATES, type SeedAudioFormat } from "@/lib/seed-audio-models";
import { getCanvasImageModelParams, type CanvasImageModelParams, type CanvasImageTaskSettings } from "@/lib/canvas/image-task";
import { isMiniMaxH3VideoModel } from "@/lib/minimax-models";
import { getMiniMaxSpeechCapabilities, MINIMAX_SPEECH_EMOTIONS, MINIMAX_SPEECH_DEFAULT_VOICE_ID, MINIMAX_SPEECH_DEFAULT_VOICE_NAME, MINIMAX_SPEECH_SOUND_EFFECTS } from "@/lib/minimax-speech-models";
import { isSeedance25VideoModel, type Sora2ModelSpec } from "@/lib/sora2";
import type { CanvasVideoReference } from "@/lib/canvas/video-references";

type ImageTaskData = Extract<CanvasNodeData, { kind: "imageTask" }>;
type VideoTaskData = Extract<CanvasNodeData, { kind: "videoTask" }>;
type ImagePreferences = Partial<Omit<CanvasImageTaskSettings, "model" | "prompt">>;
type VideoPreferences = Partial<Pick<VideoTaskData, "inputMode" | "resolution" | "ratio" | "duration" | "generateAudio" | "omniReferenceTaskType" | "outputFormat">>;
type AudioTaskData = Extract<CanvasNodeData, { kind: "audioTask" }>;
type AudioPreferences = Partial<Pick<AudioTaskData, "voiceId" | "voiceName" | "audioFormat" | "sampleRate" | "emotion" | "speed" | "pitch" | "volume" | "modifyPitch" | "modifyIntensity" | "modifyTimbre" | "soundEffect">>;

export type CanvasModelPreferenceBucket<T> = {
  lastModel?: string;
  byModel: Record<string, T>;
};

export type CanvasTaskPreferences = {
  image?: CanvasModelPreferenceBucket<ImagePreferences>;
  video?: CanvasModelPreferenceBucket<VideoPreferences>;
  audio?: CanvasModelPreferenceBucket<AudioPreferences>;
};

type PreferenceStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const STORAGE_PREFIX = "canvas_task_preferences_v2_";
const LEGACY_STORAGE_PREFIX = "canvas_task_preferences_v1_";

function storageKey(ownerId: number | string) {
  return `${STORAGE_PREFIX}${ownerId}`;
}

function legacyStorageKey(ownerId: number | string) {
  return `${LEGACY_STORAGE_PREFIX}${ownerId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanModelId(value: unknown) {
  const model = typeof value === "string" ? value.trim() : "";
  return model && model !== "__proto__" && model !== "prototype" && model !== "constructor" ? model : "";
}

function sanitizeImagePreferences(value: unknown): ImagePreferences | undefined {
  if (!isRecord(value)) return undefined;
  const result: ImagePreferences = {};
  if (typeof value.aspectRatio === "string" && value.aspectRatio) result.aspectRatio = value.aspectRatio;
  if (typeof value.resolution === "string" && value.resolution) result.resolution = value.resolution;
  if (typeof value.customSize === "string") result.customSize = value.customSize;
  if (typeof value.googleThinkingLevel === "string") result.googleThinkingLevel = value.googleThinkingLevel;
  if (typeof value.googleSearchMode === "string") result.googleSearchMode = value.googleSearchMode;
  if (typeof value.quality === "string") result.quality = value.quality;
  if (value.gptImage25Mode === "flare" || value.gptImage25Mode === "sunburst") result.gptImage25Mode = value.gptImage25Mode;
  if (["auto", "transparent", "opaque"].includes(String(value.background))) result.background = value.background as string;
  if (["png", "jpeg", "webp", "gif"].includes(String(value.outputFormat))) result.outputFormat = value.background === "transparent" && value.outputFormat === "jpeg" ? "png" : value.outputFormat as string;
  if (typeof value.gifSize === "string") result.gifSize = value.gifSize;
  if (typeof value.frameCount === "number" && Number.isInteger(value.frameCount)) result.frameCount = value.frameCount;
  if (isRecord(value.seedream55)) {
    const settings = value.seedream55;
    result.seedream55 = {
      layerDecomposition: settings.layerDecomposition === true,
      textRecognition: settings.textRecognition === true,
      ...(typeof settings.layerMaxImages === "number" && Number.isInteger(settings.layerMaxImages) && settings.layerMaxImages >= 2 && settings.layerMaxImages <= 100 ? { layerMaxImages: settings.layerMaxImages } : {}),
    };
  }
  if (typeof value.frameDurationMs === "number" && Number.isInteger(value.frameDurationMs)) result.frameDurationMs = value.frameDurationMs;
  if (typeof value.count === "number" && Number.isFinite(value.count)) result.count = Math.max(1, Math.min(8, Math.round(value.count)));
  return Object.keys(result).length ? result : undefined;
}

function sanitizeVideoPreferences(value: unknown): VideoPreferences | undefined {
  if (!isRecord(value)) return undefined;
  const result: VideoPreferences = {};
  if (typeof value.inputMode === "string" && value.inputMode) result.inputMode = value.inputMode;
  if (typeof value.resolution === "string" && value.resolution) result.resolution = value.resolution;
  if (typeof value.ratio === "string" && value.ratio) result.ratio = value.ratio;
  if (typeof value.duration === "number" && Number.isFinite(value.duration)) result.duration = value.duration;
  if (typeof value.generateAudio === "boolean") result.generateAudio = value.generateAudio;
  if (value.omniReferenceTaskType === "auto" || value.omniReferenceTaskType === "edit" || value.omniReferenceTaskType === "extend") result.omniReferenceTaskType = value.omniReferenceTaskType;
  if (value.outputFormat === "mp4" || value.outputFormat === "mov") result.outputFormat = value.outputFormat;
  return Object.keys(result).length ? result : undefined;
}

function sanitizeAudioPreferences(value: unknown): AudioPreferences | undefined {
  if (!isRecord(value)) return undefined;
  const result: AudioPreferences = {};
  if (SEED_AUDIO_FORMATS.includes(value.audioFormat as SeedAudioFormat)) result.audioFormat = value.audioFormat as SeedAudioFormat;
  if (typeof value.sampleRate === "number" && SEED_AUDIO_SAMPLE_RATES.wav.includes(value.sampleRate)) result.sampleRate = value.sampleRate;
  if (typeof value.voiceId === "string" && value.voiceId.trim()) {
    result.voiceId = value.voiceId.trim();
    if (typeof value.voiceName === "string") result.voiceName = value.voiceName;
  }
  const ranges = { speed: [0.5, 2], pitch: [-12, 12], volume: [0.01, 10], modifyPitch: [-100, 100], modifyIntensity: [-100, 100], modifyTimbre: [-100, 100] } as const;
  for (const key of Object.keys(ranges) as Array<keyof typeof ranges>) {
    const candidate = value[key];
    const [min, max] = ranges[key];
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= min && candidate <= max
      && (key === "speed" || key === "volume" || Number.isInteger(candidate))) result[key] = candidate;
  }
  if (typeof value.emotion === "string" && MINIMAX_SPEECH_EMOTIONS.some((emotion) => emotion === value.emotion)) result.emotion = value.emotion as AudioTaskData["emotion"];
  if (MINIMAX_SPEECH_SOUND_EFFECTS.some((effect) => effect.value === value.soundEffect)) result.soundEffect = value.soundEffect as AudioTaskData["soundEffect"];
  return Object.keys(result).length ? result : undefined;
}

function sanitizeBucket<T>(
  value: unknown,
  sanitize: (candidate: unknown) => T | undefined,
): CanvasModelPreferenceBucket<T> | undefined {
  if (!isRecord(value) || !isRecord(value.byModel)) return undefined;
  const byModel: Record<string, T> = {};
  for (const [rawModel, rawPreferences] of Object.entries(value.byModel)) {
    const model = cleanModelId(rawModel);
    const preferences = sanitize(rawPreferences);
    if (model && preferences) byModel[model] = preferences;
  }
  const requestedLastModel = cleanModelId(value.lastModel);
  const lastModel = requestedLastModel && byModel[requestedLastModel]
    ? requestedLastModel
    : Object.keys(byModel)[0];
  return Object.keys(byModel).length ? { ...(lastModel ? { lastModel } : {}), byModel } : undefined;
}

function migrateLegacyBucket<T>(
  value: unknown,
  sanitize: (candidate: unknown) => T | undefined,
): CanvasModelPreferenceBucket<T> | undefined {
  if (!isRecord(value)) return undefined;
  const model = cleanModelId(value.model);
  const preferences = sanitize(value);
  return model && preferences ? { lastModel: model, byModel: { [model]: preferences } } : undefined;
}

function sanitizePreferences(value: unknown): CanvasTaskPreferences {
  if (!isRecord(value)) return {};
  const image = sanitizeBucket(value.image, sanitizeImagePreferences)
    || migrateLegacyBucket(value.image, sanitizeImagePreferences);
  const video = sanitizeBucket(value.video, sanitizeVideoPreferences)
    || migrateLegacyBucket(value.video, sanitizeVideoPreferences);
  const audio = sanitizeBucket(value.audio, sanitizeAudioPreferences);
  return {
    ...(image ? { image } : {}),
    ...(video ? { video } : {}),
    ...(audio ? { audio } : {}),
  };
}

export function readCanvasTaskPreferences(storage: PreferenceStorage, ownerId: number | string): CanvasTaskPreferences {
  try {
    const raw = storage.getItem(storageKey(ownerId));
    if (raw) return sanitizePreferences(JSON.parse(raw));
    const legacyRaw = storage.getItem(legacyStorageKey(ownerId));
    return legacyRaw ? sanitizePreferences(JSON.parse(legacyRaw)) : {};
  } catch {
    return {};
  }
}

export function writeCanvasTaskPreferences(storage: PreferenceStorage, ownerId: number | string, preferences: CanvasTaskPreferences) {
  try {
    storage.setItem(storageKey(ownerId), JSON.stringify(preferences));
  } catch {
    // Storage may be unavailable in private browsing or under a strict quota.
  }
}

function imagePreferencesFromData(data: ImageTaskData): ImagePreferences {
  return sanitizeImagePreferences(data.task.settings) || {};
}

function videoPreferencesFromData(data: VideoTaskData): VideoPreferences {
  return sanitizeVideoPreferences(data) || {};
}

export function rememberCanvasTaskPreferences(current: CanvasTaskPreferences, data: CanvasNodeData): CanvasTaskPreferences {
  if (data.kind === "audioTask") {
    const model = cleanModelId(data.model);
    if (!model) return current;
    return { ...current, audio: { lastModel: model, byModel: { ...current.audio?.byModel, [model]: sanitizeAudioPreferences(data) || {} } } };
  }
  if (data.kind === "imageTask") {
    const model = cleanModelId(data.task.settings.model);
    if (!model) return current;
    const preferences = imagePreferencesFromData(data);
    return {
      ...current,
      image: {
        lastModel: model,
        byModel: { ...current.image?.byModel, [model]: preferences },
      },
    };
  }
  if (data.kind === "videoTask") {
    const model = cleanModelId(data.model);
    if (!model) return current;
    const preferences = videoPreferencesFromData(data);
    return {
      ...current,
      video: {
        lastModel: model,
        byModel: { ...current.video?.byModel, [model]: preferences },
      },
    };
  }
  return current;
}

export function applyCanvasTaskPreferences(data: CanvasNodeData, preferences: CanvasTaskPreferences): CanvasNodeData {
  if (data.kind === "audioTask" && preferences.audio) {
    const model = cleanModelId(data.model) || preferences.audio.lastModel || "";
    return model ? restoreCanvasAudioModelPreference(data, model, preferences) : data;
  }
  if (data.kind === "imageTask" && preferences.image) {
    const model = cleanModelId(data.task.settings.model) || preferences.image.lastModel || "";
    const saved = model ? preferences.image.byModel[model] : undefined;
    if (!model || !saved) return data;
    return { ...data, task: { ...data.task, settings: { ...data.task.settings, ...saved, model } } };
  }
  if (data.kind === "videoTask" && preferences.video) {
    const model = cleanModelId(data.model) || preferences.video.lastModel || "";
    const saved = model ? preferences.video.byModel[model] : undefined;
    if (!model || !saved) return data;
    return { ...data, ...saved, model };
  }
  return data;
}

function enabledOption(options: Array<{ value: string; disabled?: boolean }>, value: unknown) {
  return options.some((option) => option.value === value && !option.disabled);
}

export function restoreCanvasAudioModelPreference(data: AudioTaskData, model: string, preferences: CanvasTaskPreferences): AudioTaskData {
  const saved = sanitizeAudioPreferences(preferences.audio?.byModel[model]);
  const audioFormat = saved?.audioFormat || SEED_AUDIO_DEFAULT_FORMAT;
  const sampleRate = saved?.sampleRate && SEED_AUDIO_SAMPLE_RATES[audioFormat].includes(saved.sampleRate)
    ? saved.sampleRate : audioFormat === "ogg_opus" ? 48000 : SEED_AUDIO_DEFAULT_SAMPLE_RATE;
  return {
    ...data,
    model,
    voiceId: saved?.voiceId || MINIMAX_SPEECH_DEFAULT_VOICE_ID,
    audioFormat: isSeedAudioModel(model) ? audioFormat : undefined,
    sampleRate: isSeedAudioModel(model) ? sampleRate : undefined,
    voiceName: saved?.voiceId ? saved.voiceName : MINIMAX_SPEECH_DEFAULT_VOICE_NAME,
    emotion: getMiniMaxSpeechCapabilities(model).emotions.some((emotion) => emotion === saved?.emotion) ? saved?.emotion : undefined,
    speed: saved?.speed ?? 1,
    pitch: saved?.pitch ?? 0,
    volume: isSeedAudioModel(model) ? Math.min(2, Math.max(0.5, saved?.volume ?? 1)) : saved?.volume ?? 1,
    modifyPitch: saved?.modifyPitch ?? 0,
    modifyIntensity: saved?.modifyIntensity ?? 0,
    modifyTimbre: saved?.modifyTimbre ?? 0,
    soundEffect: saved?.soundEffect ?? "",
  };
}

function normalizeImagePreference(
  data: ImageTaskData,
  model: string,
  params: CanvasImageModelParams,
  saved: ImagePreferences | undefined,
): ImageTaskData {
  const aspectRatio = enabledOption(params.aspectRatios, saved?.aspectRatio)
    ? saved!.aspectRatio!
    : params.defaultAspectRatio;
  const modelResolutionsForRatio = getCanvasImageModelParams(model, undefined, aspectRatio).resolutions;
  const compatibleResolutions = (isOpenRouterImageModel(model) ? modelResolutionsForRatio : params.resolutions).filter((option) =>
    !option.disabled && enabledOption(modelResolutionsForRatio, option.value));
  const resolution = enabledOption(compatibleResolutions, saved?.resolution)
    ? saved!.resolution!
    : enabledOption(compatibleResolutions, params.defaultResolution)
      ? params.defaultResolution
      : compatibleResolutions[0]?.value || params.defaultResolution;
  const quality = enabledOption(params.qualities, saved?.quality)
    ? saved!.quality!
    : params.defaultQuality;
  return {
    ...data,
    task: {
      ...data.task,
      settings: {
        ...data.task.settings,
        model,
        aspectRatio,
        resolution,
        quality,
        googleThinkingLevel: undefined,
        googleSearchMode: undefined,
        ...normalizeGoogleImageSettings(model, saved || {}),
        gptImage25Mode: isGptImageVariantModel(model) ? saved?.gptImage25Mode || "flare" : undefined,
        background: supportsImageBackground(model) ? isOpenRouterImageModel(model) && !getImageBackgroundOptions(model).some(o => o.value === saved?.background) ? "auto" : saved?.background || "auto" : undefined,
        outputFormat: supportsImageBackground(model) ? saved?.outputFormat === "gif" && !supportsGptImage26Gif(model) ? "png" : saved?.outputFormat || "png" : undefined,
        gifSize: supportsGptImage26Gif(model) ? saved?.gifSize || "512x512" : undefined,
        frameCount: supportsGptImage26Gif(model) ? saved?.frameCount ?? 9 : undefined,
        seedream55: isSeedream55Model(model) ? saved?.seedream55 : undefined,
        frameDurationMs: supportsGptImage26Gif(model) ? saved?.frameDurationMs ?? 200 : undefined,
        count: saved?.count ?? 1,
        customSize: aspectRatio === "custom" && typeof saved?.customSize === "string" ? saved.customSize : undefined,
      },
    },
  };
}

export function restoreCanvasImageModelPreference(
  data: ImageTaskData,
  model: string,
  params: CanvasImageModelParams,
  preferences: CanvasTaskPreferences,
): ImageTaskData {
  return normalizeImagePreference(data, model, params, preferences.image?.byModel[model]);
}

export function carryCanvasImageTaskSettingsToModel(
  data: ImageTaskData,
  model: string,
  params: CanvasImageModelParams,
): ImageTaskData {
  return normalizeImagePreference(data, model, params, imagePreferencesFromData(data));
}

function defaultVideoResolution(spec: Sora2ModelSpec) {
  return spec.supportedResolutions[0] || "720p";
}

function defaultVideoDuration(spec: Sora2ModelSpec) {
  return spec.durationOptions?.[0] ?? spec.minDurationSeconds;
}

function normalizeVideoDuration(spec: Sora2ModelSpec, value: unknown, allowEditAuto: boolean) {
  const duration = Number(value);
  if (duration === -1 && (spec.allowAutoDuration || allowEditAuto)) return -1;
  if (spec.durationOptions?.includes(duration)) return duration;
  if (!spec.durationOptions && Number.isFinite(duration) && duration >= spec.minDurationSeconds && duration <= spec.maxDurationSeconds) return duration;
  if (allowEditAuto) return -1;
  return defaultVideoDuration(spec);
}

function normalizeVideoPreference(
  data: VideoTaskData,
  model: string,
  spec: Sora2ModelSpec,
  saved: VideoPreferences | undefined,
): VideoTaskData {
  const inputMode = spec.supportedInputModes.includes(saved?.inputMode as never)
    ? saved!.inputMode!
    : spec.supportedInputModes[0] || "text_to_video";
  const resolution = spec.supportedResolutions.includes(saved?.resolution as never)
    ? saved!.resolution!
    : defaultVideoResolution(spec);
  const isSeedance25 = isSeedance25VideoModel(model);
  const omniReferenceTaskType = isSeedance25
    ? inputMode === "multimodal" && (saved?.omniReferenceTaskType === "edit" || saved?.omniReferenceTaskType === "extend")
      ? saved.omniReferenceTaskType
      : "auto"
    : undefined;
  const ratios = spec.supportedRatios || ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
  const requiresAdaptive = (isSeedance25 || isMiniMaxH3VideoModel(model)) && (
    inputMode === "first_frame"
    || inputMode === "first_last_frame"
    || omniReferenceTaskType === "edit"
    || omniReferenceTaskType === "extend"
  );
  const savedRatioAllowed = ratios.includes(saved?.ratio || "")
    && !(isMiniMaxH3VideoModel(model) && inputMode === "text_to_video" && saved?.ratio === "adaptive");
  const ratio = requiresAdaptive && ratios.includes("adaptive")
    ? "adaptive"
    : savedRatioAllowed
      ? saved!.ratio!
      : isMiniMaxH3VideoModel(model) && inputMode === "text_to_video" && ratios.includes("9:16")
        ? "9:16"
        : ratios[0] || "16:9";
  const duration = normalizeVideoDuration(spec, saved?.duration, isSeedance25 && omniReferenceTaskType === "edit");
  return {
    ...data,
    model,
    inputMode,
    resolution,
    ratio,
    duration,
    generateAudio: spec.supportsGenerateAudio ? Boolean(saved?.generateAudio) : false,
    omniReferenceTaskType,
    outputFormat: isSeedance25 && (saved?.outputFormat === "mov" || saved?.outputFormat === "mp4")
      ? saved.outputFormat
      : isSeedance25 ? "mp4" : undefined,
  };
}

export function restoreCanvasVideoModelPreference(
  data: VideoTaskData,
  model: string,
  spec: Sora2ModelSpec,
  preferences: CanvasTaskPreferences,
): VideoTaskData {
  return normalizeVideoPreference(data, model, spec, preferences.video?.byModel[model]);
}

export function resolveCanvasVideoInputMode(inputMode: string | undefined, spec: Sora2ModelSpec, references: boolean | readonly CanvasVideoReference[]) {
  const hasReferenceMedia = typeof references === "boolean" ? references : references.length > 0;
  const media = typeof references === "boolean" ? undefined : references;
  const referenceMode = spec.supportedInputModes.includes("multimodal") ? "multimodal"
    : media?.length === 2 && media.every(reference => reference.kind === "image") && spec.supportedInputModes.includes("first_last_frame")
      ? "first_last_frame" : spec.supportedInputModes[0];
  if (!hasReferenceMedia && spec.supportedInputModes.includes("text_to_video")) return "text_to_video";
  if (media && (inputMode === "first_frame" || inputMode === "first_last_frame")
    && (media.some(reference => reference.kind !== "image") || media.length > (inputMode === "first_frame" ? 1 : 2))) return referenceMode;
  if (hasReferenceMedia && (!inputMode || inputMode === "text_to_video" || !spec.supportedInputModes.includes(inputMode as never))) {
    return referenceMode;
  }
  return spec.supportedInputModes.includes(inputMode as never) ? inputMode! : spec.supportedInputModes[0];
}

export function normalizeCanvasVideoTaskForModel(
  data: VideoTaskData,
  model: string,
  spec: Sora2ModelSpec,
  references?: boolean | readonly CanvasVideoReference[],
): VideoTaskData {
  if (data.subtitleRemoval) return data;
  const inputMode = references === undefined ? data.inputMode : resolveCanvasVideoInputMode(data.inputMode, spec, references);
  const missingEditVideo = data.omniReferenceTaskType === "edit" && references !== undefined
    && typeof references !== "boolean" && !references.some(reference => reference.kind === "video");
  return normalizeVideoPreference(data, model, spec, videoPreferencesFromData({
    ...data,
    inputMode,
    ...(inputMode !== data.inputMode || missingEditVideo ? { omniReferenceTaskType: "auto" } : {}),
  }));
}
