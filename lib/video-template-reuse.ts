import { isSeedance25VideoModel } from "@/lib/sora2";
﻿import { isVideoMediaUrl, normalizeMediaUrl } from "@/lib/media-url";

import { writeEphemeralToolTemplate } from "@/lib/ephemeral-input-draft";
import { stripPromptAssetMentions } from "@/lib/prompt-rich-editor-content";

type TemplateSource = {
  id?: string | number | null;
  type?: string | null;
  prompt?: string | null;
  model?: string | null;
  localPath?: string | null;
  url?: string | null;
  inputImages?: string[] | null;
  params?: Record<string, any> | null;
  templateData?: Record<string, any> | string | null;
};

export type VideoTemplateReferenceAsset = {
  kind: "image" | "video" | "audio";
  url: string;
  role?: string;
};

export type VideoTemplatePayload = {
  prompt: string;
  model: string;
  inputMode: string;
  resolution: string;
  ratio: string;
  duration: string;
  seed: string;
  returnLastFrame: boolean;
  generateAudio: boolean;
  cameraFixed: boolean;
  watermark: boolean;
  webSearch: boolean;
  omniReferenceTaskType?: "auto" | "edit" | "extend";
  outputFormat?: "mp4" | "mov";
  referenceAssets?: VideoTemplateReferenceAsset[];
  imagePaths: string[];
};

type PrepareVideoTemplateOptions = {
  timeoutMs?: number;
};

type PrepareVideoTemplateFinalized = {
  payload: VideoTemplatePayload;
  notice: string;
};

export type PrepareVideoTemplateResult = PrepareVideoTemplateFinalized & {
  degraded: boolean;
  deferred?: Promise<PrepareVideoTemplateFinalized>;
};

const VIDEO_INPUT_MODES = new Set(["text_to_video", "first_frame", "first_last_frame", "multimodal"]);

export type VideoTemplateResolvedMode =
  | "text_to_video"
  | "first_frame"
  | "first_last_frame"
  | "multimodal";

export function sanitizeVideoTemplatePrompt(prompt: string | null | undefined) {
  const raw = String(prompt || "");
  if (!raw.trim()) return "";
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const filtered = lines.filter((line) => {
    const t = line.trim();
    if (!t) return false;
    if (/^(aspect|resolution|provider|model|n_frames|aspect_ratio)\s*:/i.test(t)) return false;
    if (/^seedream_[a-z0-9_]+\s*:/i.test(t)) return false;
    return true;
  });
  return stripPromptAssetMentions(filtered.join("\n")).trim();
}

function isVideoTemplateMode(value: unknown): value is VideoTemplateResolvedMode {
  return VIDEO_INPUT_MODES.has(String(value || "").trim());
}

function parseTemplateObject(value: unknown): Record<string, any> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasMeaningfulValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function mergeTemplateParams(base: Record<string, any> | null, override: Record<string, any> | null) {
  const out: Record<string, any> = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    if (hasMeaningfulValue(value) || !hasMeaningfulValue(out[key])) out[key] = value;
  }
  return out;
}

function getTemplateParams(item: TemplateSource) {
  return mergeTemplateParams(parseTemplateObject(item.templateData), parseTemplateObject(item.params));
}

function getTemplateReferenceAssets(params: Record<string, any> | null | undefined) {
  return Array.isArray(params?.referenceAssets)
    ? params.referenceAssets.filter((entry: any) => entry && typeof entry === "object")
    : [];
}

export function isRemovedVideoReference(item: { url?: unknown; avatarAssetUri?: unknown }) {
  const url = String(item.url || "").trim();
  return Boolean(item.avatarAssetUri)
    || /^asset:\/\//i.test(url)
    || /(?:^|\/)uploads\/virtual_avatars\//i.test(url.split(/[?#]/, 1)[0]);
}

function legacyPreviewPaths(item: TemplateSource, params: Record<string, any>) {
  const oldReferences = getTemplateReferenceAssets(params).filter((entry: any) => entry.kind === "avatar");
  const previews = [
    ...(Array.isArray(params.avatarPreviewUrls) ? params.avatarPreviewUrls : []),
    params.avatarPreviewUrl,
    ...oldReferences.map((entry: any) => entry.previewUrl || entry.url),
  ].map((entry) => normalizeMediaUrl(entry || "")).filter(Boolean);
  if (previews.length || !item.inputImages?.length || Array.isArray(params.imagePaths)) return new Set(previews);
  // Older templates recorded preview paths at the front of inputImages without marking them.
  const oldUris = new Set([
    ...(Array.isArray(params.avatarAssetUris) ? params.avatarAssetUris : []),
    params.avatarAssetUri,
    ...(Array.isArray(params.inputMedia) ? params.inputMedia.map((entry: any) => entry?.url) : []),
    ...oldReferences.map((entry: any) => entry.assetUri),
  ].filter((entry) => typeof entry === "string" && entry.startsWith("asset://")));
  return new Set(item.inputImages.slice(0, oldUris.size).map(normalizeMediaUrl));
}

function getOrdinaryVideoTemplatePaths(item: TemplateSource, params: Record<string, any>) {
  const excluded = legacyPreviewPaths(item, params);
  const pathLists = [
    getTemplateReferenceAssets(params).filter((entry: any) => entry.kind !== "avatar").map((entry: any) => entry.url),
    Array.isArray(params.inputMedia) ? params.inputMedia.map((entry: any) => entry?.url) : [],
    Array.isArray(params.imagePaths) ? params.imagePaths : item.inputImages || [],
  ];
  for (const values of pathLists) {
    const paths = values.map((value: unknown) => typeof value === "string" ? normalizeMediaUrl(value) : "")
      .filter((url: string) => url && !isRemovedVideoReference({ url }) && !excluded.has(url));
    if (paths.length) return Array.from(new Set<string>(paths));
  }
  return [];
}

function inferReferenceKind(url: string): "image" | "video" | "audio" {
  const lower = String(url || "").split("?")[0].toLowerCase();
  if (/\.(mp4|webm|mov|m4v|avi|mkv)$/.test(lower)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(lower)) return "audio";
  return "image";
}

function buildReferenceAssets(mediaPaths: string[], inputMedia: any[] = []) {
  return mediaPaths.map((url): VideoTemplateReferenceAsset => {
    const media = inputMedia.find((entry) => entry && normalizeMediaUrl(entry.url || "") === url);
    const mediaType = String(media?.kind || media?.type || "").toLowerCase();
    const kind = mediaType === "video" || mediaType === "audio" || mediaType === "image" ? mediaType : inferReferenceKind(url);
    return {
      kind,
      url,
      role: String(media?.role || (kind === "video" ? "reference_video" : kind === "audio" ? "reference_audio" : "reference_image")),
    };
  });
}

export function resolveVideoTemplateInputMode(item: TemplateSource): VideoTemplateResolvedMode {
  const params = getTemplateParams(item);
  const rawMode = String(params.inputMode || "").trim();
  if (isVideoTemplateMode(rawMode)) return rawMode;

  const paths = getOrdinaryVideoTemplatePaths(item, params);
  const references = [
    ...getTemplateReferenceAssets(params),
    ...(Array.isArray(params.inputMedia) ? params.inputMedia : []),
  ];
  if (references.length && (paths.length > 2 || buildReferenceAssets(paths, references).some((reference) => reference.kind !== "image"))) return "multimodal";
  if (paths.length >= 2) return "first_last_frame";
  if (paths.length === 1) return "first_frame";
  return "text_to_video";
}

export function getVideoTemplateModeLabel(mode: VideoTemplateResolvedMode) {
  if (mode === "text_to_video") return "文生视频";
  if (mode === "first_frame") return "首帧图";
  if (mode === "multimodal") return "多模态参考";
  return "首尾帧";
}

export function getVideoTemplateReferenceRule(mode: VideoTemplateResolvedMode) {
  if (mode === "text_to_video") {
    return {
      requiresReference: false,
      requiredCountText: "无需上传参考素材",
      acceptedTypesText: "无需参考图/视频/音频"
    };
  }
  if (mode === "first_frame") {
    return {
      requiresReference: true,
      requiredCountText: "需要 1 张首帧图片",
      acceptedTypesText: "仅图片"
    };
  }
  if (mode === "multimodal") {
    return {
      requiresReference: true,
      requiredCountText: "至少需要 1 个参考素材",
      acceptedTypesText: "图片、视频、音频"
    };
  }
  return {
    requiresReference: true,
    requiredCountText: "需要首帧和尾帧 2 张图片",
    acceptedTypesText: "仅图片"
  };
}

export function getVideoTemplateMediaPaths(item: TemplateSource) {
  const params = getTemplateParams(item);
  const paths = getOrdinaryVideoTemplatePaths(item, params);
  if (paths.length) return paths;

  const previewUrl = normalizeMediaUrl(item.url || item.localPath || "");
  return previewUrl && !isRemovedVideoReference({ url: previewUrl }) && !isVideoMediaUrl(previewUrl) ? [previewUrl] : [];
}

export function buildVideoTemplatePayload(item: TemplateSource) {
  const p = getTemplateParams(item);
  const inputMode = resolveVideoTemplateInputMode(item);
  const model = String(p.model || item.model || "doubao-seedance-2-0-260128");
  const imagePaths = getVideoTemplateMediaPaths(item);
  const inputMedia = [
    ...getTemplateReferenceAssets(p),
    ...(Array.isArray(p.inputMedia) ? p.inputMedia : []),
  ];
  const isSeedance25 = isSeedance25VideoModel(model);
  const omniReferenceTaskType = ["auto", "edit", "extend"].includes(String(p.omniReferenceTaskType || ""))
    ? p.omniReferenceTaskType as "auto" | "edit" | "extend"
    : "auto";
  return {
    prompt: sanitizeVideoTemplatePrompt(item.prompt || p.prompt),
    model,
    inputMode,
    resolution: String(p.resolution || "720p"),
    ratio: String(p.ratio || p.aspectRatio || "9:16"),
    duration: String(p.duration || "15"),
    seed: String(p.seed ?? "-1"),
    returnLastFrame: Boolean(p.returnLastFrame ?? false),
    generateAudio: Boolean(p.generateAudio ?? false),
    cameraFixed: Boolean(p.cameraFixed ?? false),
    watermark: Boolean(p.watermark ?? false),
    webSearch: Boolean(p.webSearch ?? false),
    ...(isSeedance25 ? {
      omniReferenceTaskType,
      outputFormat: p.outputFormat === "mov" ? "mov" as const : "mp4" as const,
    } : {}),
    referenceAssets: buildReferenceAssets(imagePaths, inputMedia),
    imagePaths
  };
}

export function getVideoTemplateApplyNotice(mode: VideoTemplateResolvedMode, expectedImageCount: number, resolvedImageCount: number) {
  const rule = getVideoTemplateReferenceRule(mode);
  if (!rule.requiresReference) return "";
  if (expectedImageCount === 0 && resolvedImageCount === 0) {
    return "这条历史资产缺少原始参考图映射，当前只能带回提示词和可识别参数，请重新上传参考图后再生成。后续新资产已修复为会自动保存同款所需素材。";
  }
  return "";
}

function mergeApplyNotice(...parts: Array<string | null | undefined>) {
  return parts
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n");
}

function getReadyImagePaths(paths: string[]) {
  return paths
    .map((entry) => normalizeMediaUrl(entry))
    .filter((entry): entry is string => Boolean(entry))
    .filter((entry) => entry.startsWith("/uploads/") && !isRemovedVideoReference({ url: entry }));
}

function payloadWithImagePaths(payload: VideoTemplatePayload, imagePaths: string[]): VideoTemplatePayload {
  const normalized = Array.from(new Set(imagePaths.map((entry) => normalizeMediaUrl(entry)).filter(Boolean)));
  return {
    ...payload,
    imagePaths: normalized,
    referenceAssets: buildReferenceAssets(normalized, payload.referenceAssets),
  };
}

async function persistVideoTemplateSnapshot(item: TemplateSource, payload: VideoTemplatePayload) {
  const rawId = Number(item.id);
  if (!Number.isFinite(rawId) || rawId <= 0) return;
  try {
    await fetch(`/api/generations/${rawId}/template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateData: {
          taskType: "video_gen",
          ...payload
        }
      })
    });
  } catch {
    // 持久化失败时不阻断用户继续套用同款
  }
}

export async function prepareVideoTemplateForStudio(
  userId: string,
  item: TemplateSource,
  options?: PrepareVideoTemplateOptions
): Promise<PrepareVideoTemplateResult> {
  const timeoutMs = Math.max(0, Number(options?.timeoutMs ?? 0) || 0);
  const payload = buildVideoTemplatePayload(item);
  const mode = resolveVideoTemplateInputMode(item);
  const expectedImageCount = getVideoTemplateMediaPaths(item).length;
  const immediatePayload = payloadWithImagePaths(payload, getReadyImagePaths(payload.imagePaths));

  const finalize = async (): Promise<PrepareVideoTemplateFinalized> => {
    const finalizedPayload = payloadWithImagePaths(payload, await ensureLocalVideoTemplateImagePaths(userId, item));
    await persistVideoTemplateSnapshot(item, finalizedPayload);
    return {
      payload: finalizedPayload,
      notice: getVideoTemplateApplyNotice(mode, expectedImageCount, finalizedPayload.imagePaths.length)
    };
  };

  const finalizePromise = finalize();
  if (timeoutMs <= 0) {
    const done = await finalizePromise;
    return {
      ...done,
      degraded: false
    };
  }

  const timeoutPromise = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const raced = await Promise.race<PrepareVideoTemplateFinalized | "timeout">([finalizePromise, timeoutPromise]);
  if (raced !== "timeout") {
    return {
      ...raced,
      degraded: false
    };
  }

  const immediateNotice = mergeApplyNotice(
    expectedImageCount > immediatePayload.imagePaths.length
      ? "参考素材正在同步到工作台，已先带你进入生成页；素材导入完成后会自动补齐。"
      : ""
  );

  return {
    payload: immediatePayload,
    notice: immediateNotice,
    degraded: true,
    deferred: finalizePromise
  };
}

export function commitVideoTemplateToStudio(userId: string, payload: VideoTemplatePayload) {
  writeEphemeralToolTemplate("video", userId, payload);
  localStorage.setItem("studio_last_tool_v1", "video");
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("studio:open-tool", { detail: { tool: "video" } }));
  window.dispatchEvent(new CustomEvent("studio:apply-video-template", { detail: { userId, at: Date.now() } }));
}

export async function ensureLocalVideoTemplateImagePaths(userId: string, item: TemplateSource) {
  const mode = resolveVideoTemplateInputMode(item);
  const rule = getVideoTemplateReferenceRule(mode);
  const paths = getVideoTemplateMediaPaths(item);
  if (paths.length) {
    const next = await Promise.all(
      paths.map(async (src) => {
        const normalized = normalizeMediaUrl(src);
        if (!normalized) return "";
        if (normalized.startsWith("/uploads/")) return normalized;
        const fd = new FormData();
        fd.set("userId", userId);
        fd.set("sourceUrl", normalized);
        const res = await fetch("/api/assets/import", { method: "POST", body: fd });
        const json = (await res.json().catch(() => null)) as any;
        if (!res.ok) throw new Error(String(json?.error || "导入参考图失败"));
        return String(json?.data?.localPath || "");
      })
    );
    return next.filter(Boolean);
  }

  if (!rule.requiresReference) return [];

  return [];
}
