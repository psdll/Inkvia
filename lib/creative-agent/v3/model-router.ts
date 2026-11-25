import "server-only";

import type { EffectiveMediaCatalog, EffectiveImageModel, EffectiveVideoModel } from "../effective-media-catalog";
import { normalizeCreativeMediaRequest, type ResolvedReference, type CreativeAgentMediaReference } from "../media-capabilities";
import type { CreativeAgentImagePreference, CreativeAgentVideoPreference } from "../preferences";
import { CreativeAgentError } from "../errors";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { imageProfile, videoProfile, type ImageStrength } from "./model-profiles";

export type RouteReason = "preference" | "requested" | "auto";
export type RoutedMedia = {
  kind: "image.generate" | "video.generate";
  model: string;
  label: string;
  reason: RouteReason;
  /** 预计耗时（秒） */
  eta: number;
  /** 通过 normalizeCreativeMediaRequest 校验后的完整请求，直接交给媒体执行层 */
  args: { model: string; prompt: string; references: CreativeAgentMediaReference[]; params: Record<string, unknown> };
};

type ImageIntent = {
  prompt: string;
  /** 用户本轮原话，用来识别任务类型和点名的模型 */
  userText: string;
  aspectRatio?: string;
  resolution?: string;
  modelHint?: string;
  references: ResolvedReference[];
  /** 本次出几个版本：多方向草稿优先出图快的模型 */
  count?: number;
  /** 刚失败过的模型：自动换模型重试时跳过 */
  exclude?: string[];
};
type VideoIntent = ImageIntent & {
  duration?: number;
  audio?: boolean;
  mode?: "auto" | "first_frame" | "first_last_frame" | "reference";
};

const SMART = new Set(["", "auto", "smart", "智能"]);
const fixed = (value: unknown) => typeof value === "string" && !SMART.has(value.trim()) ? value.trim() : undefined;

function ratioValue(value: string) {
  const match = /^(\d+(?:\.\d+)?)\s*[:：xX×]\s*(\d+(?:\.\d+)?)$/.exec(value.trim());
  return match ? Number(match[1]) / Number(match[2]) : undefined;
}
/** 在模型支持的比例里取最接近的一个；auto 只在模型支持时保留 */
export function nearestRatio(requested: string | undefined, supported: string[], fallback: string) {
  const options = supported.filter(Boolean);
  if (!requested) return options.includes(fallback) ? fallback : options[0] ?? fallback;
  const normalized = requested.replace(/[：xX×]/g, ":").replace(/\s+/g, "");
  if (options.includes(normalized)) return normalized;
  const target = ratioValue(normalized);
  if (target === undefined) return options.includes(fallback) ? fallback : options[0] ?? fallback;
  let best = fallback, distance = Infinity;
  for (const option of options) {
    const value = ratioValue(option);
    if (value === undefined) continue;
    const d = Math.abs(Math.log(value) - Math.log(target));
    if (d < distance) { distance = d; best = option; }
  }
  return best;
}
/** 视频默认 720p；没有 720p 时取不低于 720 的最小档，都低于 720 就取最高档 */
function defaultVideoResolution(resolutions: string[]) {
  const exact = resolutions.find(option => option.toLowerCase() === "720p");
  if (exact) return exact;
  const height = (option: string) => /4k/i.test(option) ? 2160 : /2k/i.test(option) ? 1440 : Number(option.match(/\d+/)?.[0] ?? NaN);
  const sized = resolutions.filter(option => Number.isFinite(height(option))).sort((a, b) => height(a) - height(b));
  return sized.find(option => height(option) >= 720) ?? sized.at(-1) ?? resolutions[0];
}
const muteCue = /(无声|静音|不要声音|不用声音|不需要声音|去掉声音|关掉声音|关闭声音|没有声音|不要音频|不加声音|默片)/;
function pickOption(requested: string | undefined, supported: string[], fallback: string) {
  if (!requested) return fallback;
  const found = supported.find(option => option.toLowerCase() === requested.toLowerCase());
  return found ?? fallback;
}

const textCue = /(海报|封面|标题|文字|字样|标语|文案|logo|招牌|banner|传单|菜单|名片|邀请函|字体|「|“)/i;
const artCue = /(插画|手绘|水彩|油画|动漫|二次元|漫画|国潮插画|卡通|概念图|概念设计|艺术|赛博朋克|像素风|版画|3D 卡通)/i;
const photoCue = /(摄影|写实|真实|实拍|照片|产品图|主图|场景图|白底|电商|模特|街拍|人像)/i;
const qualityCue = /(高清|精修|4K|最高质量|高质量|精品|定稿|超清|细节拉满)/i;
const speedCue = /(快速|草稿|先看看|随便|试试|快点|小样)/i;

function wanted(intent: ImageIntent): Set<ImageStrength> {
  const text = `${intent.userText}\n${intent.prompt}`;
  const tags = new Set<ImageStrength>(["general"]);
  if (intent.references.length) tags.add("edit");
  if (textCue.test(text)) tags.add("text");
  if (artCue.test(text)) tags.add("art");
  if (photoCue.test(text)) { tags.add("photo"); tags.add("product"); }
  return tags;
}

/** 文本里点名了哪个模型（按 id 与显示名匹配） */
function mentionedModel<T extends { id: string; label: string; aliases?: string[] }>(models: T[], text: string) {
  const lower = text.toLowerCase();
  return models.find(model => [model.id, model.label, ...(model.aliases ?? [])].some(name => name && name.length >= 4 && lower.includes(name.toLowerCase())));
}
function findModel<T extends { id: string; label: string; aliases?: string[] }>(models: T[], name: string | undefined) {
  if (!name) return undefined;
  const lower = name.trim().toLowerCase();
  return models.find(model => model.id.toLowerCase() === lower)
    ?? models.find(model => [model.label, ...(model.aliases ?? [])].some(alias => alias?.toLowerCase() === lower));
}

function imageScore(model: EffectiveImageModel, intent: ImageIntent, tags: Set<ImageStrength>) {
  const profile = imageProfile(model.id);
  // 质量/速度诉求只看用户原话：Agent 写提示词时习惯加“高清”“精致”，不能当成用户要求
  const text = intent.userText;
  let score = 0;
  for (const tag of tags) if (profile.strengths.includes(tag)) score += tag === "general" ? 0.5 : 2;
  // 速度：越快越好，22 秒约 +2.3，60 秒约 +1，90 秒约 0
  score += Math.max(0, (90 - profile.speed) / 30);
  score += profile.reliability * 3;
  if (qualityCue.test(text)) score += profile.tier === "pro" ? 2.5 : profile.tier === "standard" ? 1 : -1;
  if (speedCue.test(text)) score += profile.tier === "fast" ? 2 : 0;
  // 一次出 3 个以上方向是“先挑方向”的草稿：优先快模型，选定后再精修
  if ((intent.count ?? 1) >= 3 && !qualityCue.test(text) && !intent.references.length) score += profile.tier === "fast" ? 3 : 0;
  if (intent.references.length && profile.textOnly) score -= 100;
  return score;
}

function imageArgs(model: EffectiveImageModel, intent: ImageIntent, preference: CreativeAgentImagePreference | undefined, variantMode?: "flare" | "sunburst") {
  const params = model.params;
  const ratios = params.aspectRatios.filter(option => !option.disabled).map(option => option.value);
  const resolutions = params.resolutions.filter(option => !option.disabled).map(option => option.value);
  const qualities = params.qualities.filter(option => !option.disabled).map(option => option.value);
  // 偏好里固定的参数优先于 Agent 的建议
  const aspectRatio = nearestRatio(fixed(preference?.params?.aspectRatio) ?? intent.aspectRatio, ratios, params.defaultAspectRatio);
  // 分辨率默认 2K：只有用户在偏好里固定、或在消息里点名了别的档位才换；模型在该比例下不支持 2K 时用模型默认
  const forRatio = getImageModelParams(model.id, undefined, aspectRatio).resolutions.filter(option => !option.disabled).map(option => option.value);
  const allowed = resolutions.filter(value => forRatio.includes(value));
  const usable = allowed.length ? allowed : resolutions;
  const named = fixed(intent.resolution) && intent.userText.toLowerCase().includes(fixed(intent.resolution)!.toLowerCase()) ? fixed(intent.resolution) : undefined;
  const resolution = pickOption(fixed(preference?.params?.resolution) ?? named, usable, usable.includes("2K") ? "2K" : usable.includes(params.defaultResolution) ? params.defaultResolution : usable[0] ?? params.defaultResolution);
  const quality = pickOption(fixed(preference?.params?.quality), qualities, params.defaultQuality);
  return {
    model: model.id,
    prompt: intent.prompt,
    references: intent.references.map(({ kind: _kind, url: _url, facts: _facts, ...reference }) => reference),
    params: { count: 1, aspectRatio, resolution, ...(quality ? { quality } : {}), ...(variantMode ? { gptImage25Mode: variantMode } : {}) },
  };
}

function tryImage(catalog: EffectiveMediaCatalog, model: EffectiveImageModel, intent: ImageIntent, preference: CreativeAgentImagePreference | undefined, variantMode?: "flare" | "sunburst") {
  const args = imageArgs(model, intent, preference, variantMode);
  const normalized = normalizeCreativeMediaRequest("image.generate", args, intent.references, catalog);
  return { ...args, params: normalized.params };
}

/** 按偏好或任务挑选图片模型，并把参数规整到该模型支持的范围 */
export function routeImage(catalog: EffectiveMediaCatalog, preference: CreativeAgentImagePreference | undefined, intent: ImageIntent): RoutedMedia {
  const models = catalog.image.filter(model => model.qualification.available);
  if (!models.length) throw new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", "当前没有可用的图片模型，请联系管理员开启", 400);
  const variantOf = (name?: string) => {
    for (const model of models) for (const variant of model.variants ?? []) if (variant.selectionId === name) return { model, mode: variant.mode };
    return undefined;
  };
  const finish = (model: EffectiveImageModel, reason: RouteReason, mode?: "flare" | "sunburst"): RoutedMedia => ({
    kind: "image.generate", model: model.id, reason,
    label: model.variants?.find(variant => variant.mode === mode)?.label ?? model.label,
    eta: imageProfile(model.id).speed,
    args: tryImage(catalog, model, intent, preference, mode),
  });
  // 1) 用户在偏好里固定了模型：严格使用；消息里明确点名另一个模型时以消息为准
  if (preference?.mode === "explicit" && preference.model) {
    const named = mentionedModel(models, intent.userText);
    if (named && named.id !== preference.model) return finishOrExplain(() => finish(named, "requested"), named.label);
    const variant = variantOf(preference.model);
    const chosen = variant?.model ?? findModel(models, preference.model);
    if (!chosen) throw new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", `你在创作偏好里选择的图片模型「${preference.model}」当前不可用，请换一个模型或改回智能匹配`, 400);
    return finishOrExplain(() => finish(chosen, "preference", variant?.mode), chosen.label);
  }
  // 2) 智能匹配：用户点名或 Agent 根据技能/任务指定了模型，校验能力后使用
  const hinted = mentionedModel(models, intent.userText) ?? findModel(models, intent.modelHint) ?? variantOf(intent.modelHint)?.model;
  if (hinted && !intent.exclude?.includes(hinted.id)) {
    try { return finish(hinted, "requested", variantOf(intent.modelHint)?.mode); } catch { /* 不支持这组参数时回到自动挑选 */ }
  }
  // 3) 按任务打分，从高到低选第一个能满足参数与参考图要求的模型
  const tags = wanted(intent);
  const ranked = models.filter(model => !intent.exclude?.includes(model.id)).sort((a, b) => imageScore(b, intent, tags) - imageScore(a, intent, tags));
  let lastError: unknown;
  for (const model of ranked) {
    try { return finish(model, "auto"); } catch (error) { lastError = error; }
  }
  throw lastError instanceof CreativeAgentError ? lastError : new CreativeAgentError("MEDIA_PARAMS_INVALID", "当前可用图片模型都不支持这组参数或参考图，请调整比例、分辨率或参考图数量", 400);
}

function finishOrExplain(run: () => RoutedMedia, label: string): RoutedMedia {
  try { return run(); }
  catch (error) {
    const reason = error instanceof CreativeAgentError ? error.message : "参数不受支持";
    throw new CreativeAgentError("MEDIA_PARAMS_INVALID", `模型「${label}」无法按这组要求生成：${reason}。可以调整比例/参考图，或在创作偏好里换个模型`, 400);
  }
}

function inputMode(model: EffectiveVideoModel, intent: VideoIntent): string {
  const images = intent.references.filter(reference => reference.kind === "image").length;
  const others = intent.references.length - images;
  const supports = (mode: string) => model.supportedInputModes.includes(mode as never);
  if (!intent.references.length) return "text_to_video";
  if (intent.mode === "first_last_frame" && images === 2 && !others && supports("first_last_frame")) return "first_last_frame";
  if (intent.mode === "reference" && supports("multimodal")) return "multimodal";
  if (images === 1 && !others && supports("first_frame") && intent.mode !== "reference") return "first_frame";
  if (supports("multimodal")) return "multimodal";
  if (images === 2 && supports("first_last_frame")) return "first_last_frame";
  return "first_frame";
}

function videoArgs(model: EffectiveVideoModel, intent: VideoIntent, preference: CreativeAgentVideoPreference | undefined) {
  const mode = inputMode(model, intent);
  const ratios = model.supportedRatios ?? ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
  const wantedRatio = fixed(preference?.params?.ratio) ?? intent.aspectRatio;
  const ratio = wantedRatio ? nearestRatio(wantedRatio, ratios.filter(value => value !== "adaptive"), ratios.includes("16:9") ? "16:9" : ratios[0])
    : mode === "text_to_video" ? (ratios.includes("16:9") ? "16:9" : ratios.find(value => value !== "adaptive") ?? ratios[0]) : ratios.includes("adaptive") ? "adaptive" : ratios[0];
  const resolutions = model.supportedResolutions as string[];
  // 默认 720p 档；只有用户自己说了分辨率（如“1080p”）才换档，模型自己填的不算
  const named = fixed(intent.resolution) && intent.userText.toLowerCase().includes(fixed(intent.resolution)!.toLowerCase()) ? fixed(intent.resolution) : undefined;
  const resolution = pickOption(fixed(preference?.params?.resolution) ?? named, resolutions, defaultVideoResolution(resolutions));
  const durationWanted = preference?.params?.duration ?? intent.duration ?? 5;
  const durations = model.durationOptions?.length ? model.durationOptions : undefined;
  const duration = durations ? durations.reduce((best, value) => Math.abs(value - durationWanted) < Math.abs(best - durationWanted) ? value : best, durations[0])
    : Math.min(model.maxDurationSeconds, Math.max(model.minDurationSeconds, Math.round(durationWanted)));
  // 默认带声音（对白、音效、氛围）；用户明确说不要声音或在偏好里关掉才静音，Agent 自己传的 false 不算
  const generateAudio = model.supportsGenerateAudio ? (preference?.params?.generateAudio ?? (muteCue.test(intent.userText) ? false : true)) : false;
  return {
    model: model.id,
    prompt: intent.prompt,
    references: intent.references.map(({ kind: _kind, url: _url, facts: _facts, ...reference }) => reference),
    params: { inputMode: mode, ratio, resolution, duration, generateAudio },
  };
}
function tryVideo(catalog: EffectiveMediaCatalog, model: EffectiveVideoModel, intent: VideoIntent, preference: CreativeAgentVideoPreference | undefined) {
  const args = videoArgs(model, intent, preference);
  const normalized = normalizeCreativeMediaRequest("video.generate", args, intent.references, catalog);
  return { ...args, params: normalized.params };
}

/** 视频同理：偏好固定的模型必须使用；智能匹配默认选出片快且稳的模型 */
export function routeVideo(catalog: EffectiveMediaCatalog, preference: CreativeAgentVideoPreference | undefined, intent: VideoIntent): RoutedMedia {
  const models = catalog.video.filter(model => model.qualification.available);
  if (!models.length) throw new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", "当前没有可用的视频模型，请联系管理员开启", 400);
  const finish = (model: EffectiveVideoModel, reason: RouteReason): RoutedMedia => ({
    kind: "video.generate", model: model.id, label: model.label, reason, eta: videoProfile(model.id).speed,
    args: tryVideo(catalog, model, intent, preference),
  });
  if (preference?.mode === "explicit" && preference.model) {
    const named = mentionedModel(models, intent.userText);
    if (named && named.id !== preference.model) return finishOrExplain(() => finish(named, "requested"), named.label);
    const chosen = findModel(models, preference.model);
    if (!chosen) throw new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", `你在创作偏好里选择的视频模型「${preference.model}」当前不可用，请换一个模型或改回智能匹配`, 400);
    return finishOrExplain(() => finish(chosen, "preference"), chosen.label);
  }
  const hinted = mentionedModel(models, intent.userText) ?? findModel(models, intent.modelHint);
  if (hinted && !intent.exclude?.includes(hinted.id)) {
    try { return finish(hinted, "requested"); } catch { /* 回到自动挑选 */ }
  }
  const text = intent.userText;
  const quality = qualityCue.test(text) || /(电影感|大片|运镜|史诗)/.test(text);
  const score = (model: EffectiveVideoModel) => {
    const profile = videoProfile(model.id);
    let value = profile.reliability * 3 + Math.max(0, (900 - profile.speed) / 200);
    if (quality) value += profile.tier === "pro" ? 2.5 : 0;
    if (/(人物|口播|模特|主播|对话)/.test(text) && profile.strengths.includes("person")) value += 1;
    if ((intent.duration ?? 0) > model.maxDurationSeconds) value -= 5;
    return value;
  };
  let lastError: unknown;
  for (const model of models.filter(model => !intent.exclude?.includes(model.id)).sort((a, b) => score(b) - score(a))) {
    try { return finish(model, "auto"); } catch (error) { lastError = error; }
  }
  throw lastError instanceof CreativeAgentError ? lastError : new CreativeAgentError("MEDIA_PARAMS_INVALID", "当前可用视频模型都不支持这组参数或参考素材", 400);
}

/** 给 Agent 的模型菜单（精简，每个模型一行） */
export function describeModelMenu(catalog: EffectiveMediaCatalog) {
  const image = catalog.image.filter(model => model.qualification.available).map(model => `${model.id}（${model.label}）：${imageProfile(model.id).note}`);
  const video = catalog.video.filter(model => model.qualification.available).map(model => `${model.id}（${model.label}）：${videoProfile(model.id).note}，${model.minDurationSeconds}-${model.maxDurationSeconds}秒`);
  return { image, video };
}
