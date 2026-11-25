"use client";
import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { GoogleGroundingSources } from "@/components/image/google-grounding-sources";
import { Download, FileText, Loader2, MoreHorizontal, Music2, Play, Sparkles, Trash2, X, ZoomIn } from "lucide-react";
import { MediaImage } from "@/components/ui/media-image";
import { MediaLightbox } from "@/components/ui/media-lightbox";
import { FriendlyErrorBlock } from "@/components/ui/friendly-error-block";
import { inferMediaUrlKind, normalizeMediaUrl } from "@/lib/media-url";
import { getAssetSourceLabel } from "@/lib/assets/source-filter";
import { getGenerationSkillDetailEntry } from "@/lib/generation/skill-metadata";
import { useModelDisplayNames } from "@/hooks/use-model-display-names";
import { resolveModelDisplayName } from "@/lib/model-display-name";

export type WorkDetailItem = {
  id: number;
  type: string;
  source?: string | null;
  status: string;
  prompt: string | null;
  localPath: string | null;
  createdAt: string;
  finishedAt?: string | null;
  model?: string | null;
  externalTaskId?: string | null;
  errorMsg?: string | null;
  params?: Record<string, any> | null;
  inputImages?: string[];
  outputPaths?: string[];
  inspirationTemplateId?: number | null;
};

type WorkDetailModalProps = {
  open: boolean;
  item: WorkDetailItem | null;
  onClose: () => void;
  onDownloadInput?: (item: WorkDetailItem) => void;
  onDownloadOutput?: (item: WorkDetailItem) => void;
  onApplyTemplate?: (item: WorkDetailItem) => void;
  onUploadInspiration?: (item: WorkDetailItem) => void;
  onDeleteInspiration?: (item: WorkDetailItem) => void;
  onDelete?: (item: WorkDetailItem) => void;
  applying?: boolean;
  applied?: boolean;
  uploadingInspiration?: boolean;
  inspirationUploaded?: boolean;
  applyLabel?: string;
  applyingLabel?: string;
  appliedLabel?: string;
  deleteLabel?: string;
  inlineActions?: boolean;
  parameterView?: "full" | "asset";
  detailsLoading?: boolean;
  detailsError?: string | null;
  onRetryDetails?: () => void;
};

type WorkMediaKind = "image" | "video" | "audio" | "file";

type WorkPreviewEntry = {
  src: string;
  kind: "image" | "video";
  sourceIndex: number;
};

type WorkMediaPreview = {
  title: string;
  entries: WorkPreviewEntry[];
  index: number;
};

function inferKind(localPath: string | null | undefined): WorkMediaKind {
  return inferMediaUrlKind(localPath);
}

function typeLabel(t: string) {
  if (t === "face_swap") return "人脸";
  if (t === "image_edit") return "图片";
  if (t === "video_gen" || t === "video_generate") return "视频";
  if (t === "audio_gen") return "音频";
  return t || "未知";
}

function sanitizePrompt(prompt: string | null) {
  return String(prompt || "").trim();
}

function getAssetPreviewGridClass(count: number) {
  if (count <= 1) return "flex justify-center";
  if (count === 2) return "grid grid-cols-2 gap-3";
  if (count === 3) return "grid grid-cols-3 gap-2";
  if (count === 4) return "grid grid-cols-2 gap-2";
  return "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2";
}

function getAssetPreviewCardClass(count: number, kind: WorkMediaKind) {
  if (count <= 1) {
    return kind === "video"
      ? "block w-full max-w-[420px] rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--panel-bg)]"
      : "block w-full max-w-[360px] rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--panel-bg)]";
  }
  if (count === 2) return "block w-full rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--panel-bg)]";
  return "block rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--panel-bg)]";
}

function getAssetPreviewMediaClass(count: number, kind: WorkMediaKind) {
  if (count <= 1) return kind === "video" ? "w-full h-[360px] object-contain bg-[var(--panel-bg)]" : "w-full h-[320px] object-contain";
  if (count === 2) return kind === "video" ? "w-full h-[260px] object-contain bg-[var(--panel-bg)]" : "w-full h-[240px] object-contain";
  return kind === "video" ? "w-full aspect-video object-contain bg-[var(--panel-bg)]" : "w-full aspect-square object-cover";
}

function mediaCountText(count: number, locale: string, text: ReturnType<typeof useUiLocale>["text"]) {
  return text("workspaceFollowup.m14b0fb6912fd", { v0: locale === "en" ? count.toLocaleString("en-US") : count });
}

function AudioPreviewButton({ src, count, label }: { src: string; count: number; label: string }) {
  const { text } = useUiLocale();
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = React.useState(false);

  const toggle = React.useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }, []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`${playing ? text("workspaceFollowup.m8d12fc0d4eb2") : text("workspaceFollowup.mc3396195e91c")}${label}`}
      className={[
        getAssetPreviewMediaClass(count, "image"),
        "flex items-center justify-center bg-[var(--panel-2)] text-[var(--app-muted)] transition hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]",
      ].join(" ")}
    >
      <span className={["flex h-11 w-11 items-center justify-center rounded-full", playing ? "bg-indigo-500 text-white" : "bg-black/10 dark:bg-white/10"].join(" ")}>
        <Music2 className="h-5 w-5" />
      </span>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
    </button>
  );
}

function renderMediaPreview(src: string, count: number, label: string) {
  const kind = inferKind(src);
  if (kind === "video") {
    return (
      <div className="relative">
        <video
          src={src}
          className={getAssetPreviewMediaClass(count, "video")}
          muted
          playsInline
          preload="metadata"
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/45 text-white">
            <Play className="h-5 w-5 translate-x-[1px]" fill="currentColor" />
          </span>
        </span>
      </div>
    );
  }
  if (kind === "audio") {
    return <AudioPreviewButton src={src} count={count} label={label} />;
  }
  if (kind === "file") {
    return (
      <div className="flex h-full min-h-[132px] w-full flex-col items-center justify-center gap-2 bg-[var(--panel-2)] p-3 text-center text-[var(--app-muted)]">
        <FileText className="h-7 w-7" />
        <div className="text-xs"><UiText id="works.mb7b8f41bbd48" /></div>
        <div className="max-w-full truncate text-[11px]">{label}</div>
      </div>
    );
  }
  return <MediaImage src={src} alt="" className={getAssetPreviewMediaClass(count, "image")} original cacheInMemory={false} />;
}

function getWorkModeInfo(item: WorkDetailItem) {
  const p = item.params || {};
  if (item.type === "audio_gen") {
    return { modeLabel: "语音合成", requirement: "无需上传参考素材", acceptedTypes: "文字",
      uploadTitle: "输入素材", emptyText: "该任务通过文字生成音频，无需上传参考素材" };
  }
  if (item.type === "video_gen" || item.type === "video_generate") {
    return {
      modeLabel: "视频生成",
      requirement: "按模型模式决定素材数量",
      acceptedTypes: "图片/视频/音频",
      uploadTitle: "参考素材",
      emptyText: "该模式可能无需上传参考素材，或当前没有保留可直接展示的素材记录"
    };
  }
  if (item.type === "face_swap") {
    const mode = String(p.mode || "swap").trim();
    if (mode === "defect" || mode === "swap_defect") {
      return {
        modeLabel: mode === "defect" ? "添加瑕疵" : "换脸并添加瑕疵",
        requirement: "至少需要 1 张图片",
        acceptedTypes: "仅图片",
        uploadTitle: "输入素材",
        emptyText: "该模式需要上传图片素材，但当前没有保留可直接展示的素材记录"
      };
    }
    return {
      modeLabel: "人脸替换",
      requirement: "需要参考脸和目标底图各 1 张",
      acceptedTypes: "仅图片",
      uploadTitle: "输入素材",
      emptyText: "该模式需要上传图片素材，但当前没有保留可直接展示的素材记录"
    };
  }
  if (item.type === "image_edit") {
    const imageCount = Array.isArray(item.inputImages) ? item.inputImages.length : 0;
    return {
      modeLabel: imageCount > 0 ? "图生图/图片编辑" : "文生图",
      requirement: imageCount > 0 ? `需要 ${imageCount} 张参考图片` : "无需上传参考图片",
      acceptedTypes: imageCount > 0 ? "仅图片" : "无需参考图片",
      uploadTitle: "输入素材",
      emptyText: imageCount > 0 ? "该模式需要上传图片素材，但当前没有保留可直接展示的素材记录" : "该模式为文生图，无需上传参考图片"
    };
  }
  return { modeLabel: "-", requirement: "-", acceptedTypes: "-", uploadTitle: "输入素材", emptyText: "无上传素材记录" };
}

function isJsonEmpty(v: any): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) return true;
  return false;
}

function pruneEmptyDeep(value: any): any {
  if (Array.isArray(value)) {
    const out = value.map(pruneEmptyDeep).filter((v) => !isJsonEmpty(v));
    return out;
  }
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      const pruned = pruneEmptyDeep(v);
      if (!isJsonEmpty(pruned)) out[k] = pruned;
    }
    return out;
  }
  return value;
}

function buildParamsJson(item: WorkDetailItem) {
  // 顶层字段名集合 —— 若 params 里出现同名字段，从 params 中剔除以避免冗余
  const topLevelKeys = new Set([
    "id",
    "type",
    "createdAt",
    "finishedAt",
    "model",
    "externalTaskId",
    "prompt",
    "inputImages",
    "outputPaths"
  ]);

  // 从 params 里剔除与顶层重复且顶层非空的字段
  const rawParams: Record<string, any> = item.params && typeof item.params === "object" ? { ...item.params } : {};
  const topLevelValues: Record<string, any> = {
    id: item.id,
    type: item.type,
    createdAt: item.createdAt,
    finishedAt: item.finishedAt,
    model: item.model,
    externalTaskId: item.externalTaskId,
    prompt: sanitizePrompt(item.prompt),
    inputImages: Array.isArray(item.inputImages) ? item.inputImages : [],
    outputPaths: Array.isArray(item.outputPaths) ? item.outputPaths : []
  };
  for (const key of topLevelKeys) {
    if (!isJsonEmpty(topLevelValues[key]) && key in rawParams) {
      delete rawParams[key];
    }
  }

  const combined: Record<string, any> = {
    ...topLevelValues,
    params: rawParams
  };

  return JSON.stringify(pruneEmptyDeep(combined), null, 2);
}

const LOCALIZED_PARAM_VALUE_FIELDS = new Set(["类型", "来源", "情绪", "音效", "人脸模式", "顺序生成", "联网搜索"]);

type ParamEntry = { label: string; value: string; numericValue?: number; layout?: "wide-scroll" };
type ParamGroup = { title: string; entries: ParamEntry[] };

function buildParamGroups(item: WorkDetailItem): ParamGroup[] {
  const p = item.params || {};
  const groups: ParamGroup[] = [];
  const makePush = (entries: ParamEntry[]) => {
    const seen = new Set<string>();
    return (label: string, value: any, layout?: ParamEntry["layout"]) => {
      if (value === null || value === undefined) return;
      const s = String(value).trim();
      if (!s || s === "null" || s === "undefined") return;
      if (seen.has(label)) return;
      seen.add(label);
      entries.push({ label, value: s, numericValue: typeof value === "number" ? value : undefined, layout });
    };
  };

  // —— 基本信息 ——
  const basic: ParamEntry[] = [];
  const bp = makePush(basic);
  bp("类型", typeLabel(item.type));
  bp("模型", item.model || p.model);
  if (p.providerModel || p.provider) {
    const provider = String(p.providerModel || p.provider || "").trim();
    if (provider && provider !== String(item.model || p.model || "").trim()) {
      bp("底层模型", provider);
    }
  }
  bp("来源", getAssetSourceLabel(item.source || p.source, p));
  const skillDetail = getGenerationSkillDetailEntry(p);
  if (skillDetail) bp(skillDetail.label, skillDetail.value);
  if (basic.length) groups.push({ title: "基本信息", entries: basic });

  // —— 生成参数（按字段是否存在动态显示）——
  const gen: ParamEntry[] = [];
  const gp = makePush(gen);
  gp("用户提示词", p.userPrompt, "wide-scroll");
  gp("宽高比", p.aspectRatio);
  gp("分辨率", p.resolution);
  gp("输出尺寸", p.outputSize);
  gp("相似度", p.similarity);
  gp("强度", p.intensity);
  gp("时长", p.duration);
  if (item.type === "audio_gen") {
    gp("音色", p.voiceId);
    gp("语速", p.speed);
    gp("声调", p.pitch);
    gp("音量", p.volume);
    gp("情绪", p.emotion || "自动");
    gp("音高", p.modifyPitch);
    gp("强度", p.modifyIntensity);
    gp("音色调节", p.modifyTimbre);
    const soundEffects: Record<string, string> = { spacious_echo: "空旷回音", auditorium_echo: "礼堂广播", lofi_telephone: "电话失真", robotic: "电音" };
    gp("音效", soundEffects[p.soundEffect] || p.soundEffect || "无");
    gp("音频时长", p.durationSeconds == null ? null : `${p.durationSeconds}s`);
  }
  gp("帧数", p.nFrames);
  const inputCount = p.imageCount ?? (Array.isArray(item.inputImages) ? item.inputImages.length : undefined);
  gp("输入数量", inputCount);
  if (gen.length) groups.push({ title: "生成参数", entries: gen });

  // —— 模型特有参数 ——
  const specific: ParamEntry[] = [];
  const sp = makePush(specific);
  if (item.type === "face_swap") {
    const mode = String(p.mode || "").trim();
    const modeLabelMap: Record<string, string> = { swap: "换脸", defect: "添加瑕疵", swap_defect: "换脸+瑕疵" };
    if (mode) sp("人脸模式", modeLabelMap[mode] || mode);
  }
  if (p.seedream && typeof p.seedream === "object") {
    const sd = p.seedream as Record<string, any>;
    sp("出图模式", sd.outputMode);
    sp("系列图张数", sd.outputCount);
    if (sd.sequential !== undefined) sp("顺序生成", sd.sequential ? "是" : "否");
    if (sd.webSearch !== undefined) sp("联网搜索", sd.webSearch ? "是" : "否");
  }
  if (specific.length) groups.push({ title: "模型特有", entries: specific });

  // —— 任务元数据 ——
  const meta: ParamEntry[] = [];
  const mp = makePush(meta);
  mp("任务ID", item.externalTaskId);
  // 优先用 params.elapsedMs；否则按 finishedAt - createdAt 估算
  let elapsedMs: number | null = null;
  if (typeof p.elapsedMs === "number" && p.elapsedMs > 0) elapsedMs = Math.floor(p.elapsedMs);
  else if (item.finishedAt && item.createdAt) {
    const diff = new Date(item.finishedAt).getTime() - new Date(item.createdAt).getTime();
    if (diff > 0 && diff < 24 * 60 * 60 * 1000) elapsedMs = diff;
  }
  if (elapsedMs !== null) mp("耗时", `${(elapsedMs / 1000).toFixed(1)}s`);
  if (meta.length) groups.push({ title: "任务元数据", entries: meta });

  return groups;
}

async function copyText(text: string) {
  const value = String(text || "");
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}

export function WorkDetailModal({
  open,
  item,
  onClose,
  onDownloadInput,
  onDownloadOutput,
  onApplyTemplate: applyTemplateAction,
  onUploadInspiration: uploadInspirationAction,
  onDeleteInspiration,
  onDelete,
  applying = false,
  applied = false,
  uploadingInspiration = false,
  inspirationUploaded = false,
  applyLabel = "一键同款",
  applyingLabel = "套用中...",
  appliedLabel = "已套用",
  deleteLabel = "删除",
  inlineActions = false,
  parameterView = "full",
  detailsLoading = false,
  detailsError = null,
  onRetryDetails,
}: WorkDetailModalProps) {
  const { text, locale, label: uiLabel, error: uiError } = useUiLocale();
  const modelNames = useModelDisplayNames(open && parameterView === "asset");
  const [zoomPreview, setZoomPreview] = React.useState<WorkMediaPreview | null>(null);
  const [actionsOpen, setActionsOpen] = React.useState(false);
  const [copiedTarget, setCopiedTarget] = React.useState<"prompt" | "userPrompt" | "params" | null>(null);
  const actionsRef = React.useRef<HTMLDivElement | null>(null);
  const backdropPointerDown = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || zoomPreview) return;
      if (actionsOpen) setActionsOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("popstate", onClose);
    window.addEventListener("hashchange", onClose);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("popstate", onClose);
      window.removeEventListener("hashchange", onClose);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, actionsOpen, zoomPreview]);

  React.useEffect(() => {
    setActionsOpen(false);
    setCopiedTarget(null);
    setZoomPreview(null);
  }, [open, item?.id]);

  React.useEffect(() => {
    if (!copiedTarget) return;
    const timer = window.setTimeout(() => setCopiedTarget(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copiedTarget]);

  React.useEffect(() => {
    if (!actionsOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) {
        setActionsOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [actionsOpen]);

  const openZoom = React.useCallback((sources: string[], sourceIndex: number, title: string) => {
    const entries: WorkPreviewEntry[] = [];
    sources.forEach((src, index) => {
      const url = normalizeMediaUrl(src);
      if (!url) return;
      const kind = inferKind(url);
      if (kind !== "image" && kind !== "video") return;
      entries.push({ src: url, kind, sourceIndex: index });
    });
    const index = entries.findIndex((entry) => entry.sourceIndex === sourceIndex);
    if (index < 0) return;
    setZoomPreview({ title, entries, index });
  }, []);

  const handleCopy = React.useCallback(async (target: "prompt" | "userPrompt" | "params", text: string) => {
    const ok = await copyText(text);
    if (ok) setCopiedTarget(target);
  }, []);

  if (!open || !item) return null;

  const modeInfo = getWorkModeInfo(item);
  const inputImages = Array.isArray(item.inputImages) ? item.inputImages : [];
  const outputPaths = Array.isArray(item.outputPaths) ? item.outputPaths : [];
  const mediaKind = item.type === "audio_gen" ? "audio"
    : item.type === "video_gen" || item.type === "video_generate" ? "video"
    : inferKind(item.localPath || outputPaths[0]);
  const mediaTypeLabel = mediaKind === "audio" ? "音频" : mediaKind === "video" ? "视频" : "图片";
  const onApplyTemplate = mediaKind === "audio" || item?.type === "face_swap" ? undefined : applyTemplateAction;
  const onUploadInspiration = mediaKind === "audio" ? undefined : uploadInspirationAction;
  const prompt = sanitizePrompt(item.prompt);
  const allParamGroups = buildParamGroups(item);
  const assetParameterLabels = new Set(["类型", "来源", "模型", "宽高比", "分辨率"]);
  const paramGroups = parameterView === "asset"
    ? allParamGroups.map(group => ({ ...group, entries: group.entries.filter(entry => assetParameterLabels.has(entry.label)).map(entry => entry.label === "模型" ? { ...entry, value: resolveModelDisplayName(entry.value, modelNames, item.params) } : entry) })).filter(group => group.entries.length)
    : allParamGroups;
  const paramsJson = parameterView === "asset"
    ? JSON.stringify(Object.fromEntries(paramGroups.flatMap(group => group.entries.map(entry => [entry.label, entry.value]))), null, 2)
    : buildParamsJson(item);
  const sourceLabel = getAssetSourceLabel(item.source || item.params?.source, item.params);
  const zoomEntry = zoomPreview?.entries[zoomPreview.index] || null;

  return (
    <>
      <div className="fixed inset-0 z-[140]">
        <div className="absolute inset-0 bg-[var(--overlay)] pointer-events-none" />
        <div
          data-work-detail-backdrop
          className="absolute inset-0 p-4 flex items-center justify-center"
          onPointerDown={(event) => { backdropPointerDown.current = event.target === event.currentTarget; }}
          onPointerCancel={() => { backdropPointerDown.current = false; }}
          onClick={(event) => {
            if (event.target === event.currentTarget && backdropPointerDown.current) onClose();
            backdropPointerDown.current = false;
          }}
        >
          <UiProps ids={{"aria-label":["works.m2674c80642ac"]}}><div role="dialog" aria-modal="true" aria-label="works.m2674c80642ac" className="relative w-full max-w-[840px] max-h-[92dvh] rounded-[22px] border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)] overflow-hidden flex flex-col">
                <div data-work-detail-header className="relative z-20 flex shrink-0 items-center justify-between gap-2 bg-[var(--panel-bg)] px-5 pb-3 pt-5">
                  <div className="flex items-center gap-2">
                    <div className="text-xs font-semibold text-[var(--app-fg)]">{uiLabel(mediaTypeLabel)}</div>
                    <span className="rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-[10px] font-medium leading-none text-[var(--app-muted)]">
                      {uiLabel(sourceLabel)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                  {inlineActions && (onUploadInspiration || onApplyTemplate || onDelete) ? (
                    <div className="flex items-center gap-2">
                      {onUploadInspiration ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onUploadInspiration(item)}
                            disabled={uploadingInspiration || inspirationUploaded}
                            className={[
                              "h-8 px-3 rounded-xl border text-xs transition inline-flex items-center gap-1.5 disabled:opacity-70 disabled:pointer-events-none",
                              inspirationUploaded
                                ? "border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                                : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]",
                            ].join(" ")}
                          >
                            {uploadingInspiration ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /><UiText id="works.m593470c32d44" /></>
                            ) : inspirationUploaded ? (
                              <>
                                <Sparkles className="h-3.5 w-3.5" /><UiText id="works.m70f080cdfd5c" /></>
                            ) : (
                              <>
                                <Sparkles className="h-3.5 w-3.5" /><UiText id="works.m024e9ad72a65" /></>
                            )}
                          </button>
                          {inspirationUploaded && onDeleteInspiration ? (
                            <button
                              type="button"
                              onClick={() => onDeleteInspiration(item)}
                              disabled={uploadingInspiration}
                              className="h-8 px-3 rounded-xl border border-rose-500/25 bg-rose-500/10 text-xs text-rose-700 hover:bg-rose-500/15 disabled:opacity-60 disabled:pointer-events-none transition inline-flex items-center gap-1.5"
                            >
                              <Trash2 className="h-3.5 w-3.5" /><UiText id="works.m853be8cf8a92" /></button>
                          ) : null}
                        </>
                      ) : onApplyTemplate ? (
                        <button
                          type="button"
                          onClick={() => onApplyTemplate(item)}
                          disabled={applying}
                          className="h-8 px-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-xs text-[var(--app-muted)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)] disabled:opacity-60 disabled:pointer-events-none transition inline-flex items-center gap-1.5"
                        >
                          {applying ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              {applyingLabel}
                            </>
                          ) : applied ? appliedLabel : applyLabel}
                        </button>
                      ) : null}
                      {onDelete && !(onUploadInspiration && inspirationUploaded) ? (
                        <button
                          type="button"
                          onClick={() => onDelete(item)}
                          className="h-8 px-3 rounded-xl border border-rose-500/25 bg-rose-500/10 text-xs text-rose-700 hover:bg-rose-500/15 transition inline-flex items-center gap-1.5"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {deleteLabel}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {!inlineActions && (onUploadInspiration || onApplyTemplate) ? (
                    <div className="flex items-center gap-2">
                      {onUploadInspiration ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onUploadInspiration(item)}
                            disabled={uploadingInspiration || inspirationUploaded}
                            className={[
                              "h-8 px-3 rounded-xl border text-xs transition inline-flex items-center gap-1.5 disabled:opacity-70 disabled:pointer-events-none",
                              inspirationUploaded
                                ? "border-indigo-500/25 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
                                : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]",
                            ].join(" ")}
                          >
                            {uploadingInspiration ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /><UiText id="works.m593470c32d44" /></>
                            ) : inspirationUploaded ? (
                              <>
                                <Sparkles className="h-3.5 w-3.5" /><UiText id="works.m70f080cdfd5c" /></>
                            ) : (
                              <>
                                <Sparkles className="h-3.5 w-3.5" /><UiText id="works.m024e9ad72a65" /></>
                            )}
                          </button>
                          {inspirationUploaded && onDeleteInspiration ? (
                            <button
                              type="button"
                              onClick={() => onDeleteInspiration(item)}
                              disabled={uploadingInspiration}
                              className="h-8 px-3 rounded-xl border border-rose-500/25 bg-rose-500/10 text-xs text-rose-700 hover:bg-rose-500/15 disabled:opacity-60 disabled:pointer-events-none transition inline-flex items-center gap-1.5"
                            >
                              <Trash2 className="h-3.5 w-3.5" /><UiText id="works.m853be8cf8a92" /></button>
                          ) : null}
                        </>
                      ) : null}
                      {onApplyTemplate ? (
                        <button
                          type="button"
                          onClick={() => onApplyTemplate(item)}
                          disabled={applying}
                          className="h-8 px-3 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-xs text-[var(--app-muted)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)] disabled:opacity-60 disabled:pointer-events-none transition inline-flex items-center gap-1.5"
                        >
                          {applying ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /><UiText id="works.m66d5dd404721" /></>
                          ) : applied ? <UiText id="works.mc0edb04e0855" /> : <UiText id="works.mbffa36c49a3a" />}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {onDelete && !inlineActions ? (
                    <div ref={actionsRef} className="relative">
                      <UiProps ids={{"aria-label":["works.m9f07d2ce4115"]}}><button
                        type="button"
                        onClick={() => setActionsOpen((value) => !value)}
                        className="h-9 w-9 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)] transition flex items-center justify-center"
                        aria-label="works.m9f07d2ce4115"
                        aria-expanded={actionsOpen}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button></UiProps>
                      {actionsOpen ? (
                        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-32 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-1 shadow-[var(--shadow)]">
                          <button
                            type="button"
                            onClick={() => {
                              setActionsOpen(false);
                              onDelete(item);
                            }}
                            className="w-full h-9 px-3 rounded-lg text-left text-sm text-rose-600 hover:bg-rose-500/10 transition inline-flex items-center gap-2"
                          >
                            <Trash2 className="h-4 w-4" /><UiText id="works.m2f9daa828907" /></button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <UiProps ids={{"aria-label":["works.m3fd47edce45b"]}}><button
                    type="button"
                    onClick={onClose}
                    className="h-9 w-9 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-muted)] hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)] transition flex items-center justify-center"
                    aria-label="works.m3fd47edce45b"
                  >
                    <X className="h-4 w-4" />
                  </button></UiProps>
                  </div>
                </div>
            <div data-work-detail-scroll className="min-h-0 overflow-auto bg-[var(--panel-bg)] px-5 pb-5">
              {detailsLoading ? <div role="status" className="mb-3 text-xs text-[var(--app-muted)]"><UiText id="works.m8748cba9caa8" /></div> : null}
              {detailsError ? <button type="button" onClick={onRetryDetails} className="mb-3 text-xs text-rose-500">{uiError(detailsError)}<UiText id="works.mf9f5d490ab27" /></button> : null}
              <div className="space-y-6">
                <section className="space-y-3">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <article className="min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-2)]">
                    <div className="min-h-[64px] border-b border-[var(--border)] px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="text-xs font-semibold text-[var(--app-fg)]">{uiLabel(modeInfo.uploadTitle)}</div>
                            <div className="text-[11px] text-[var(--app-muted)]">{mediaCountText(inputImages.length, locale, text)}</div>
                          </div>
                          <div className="mt-1 truncate text-[11px] text-[var(--app-muted)]">
                            {uiLabel(modeInfo.modeLabel)} · {uiLabel(modeInfo.requirement)} · {uiLabel(modeInfo.acceptedTypes)}
                          </div>
                        </div>
                        {inputImages.length && onDownloadInput ? (
                          <button
                            type="button"
                            onClick={() => onDownloadInput(item)}
                            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 text-[11px] text-[var(--app-muted)] transition hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]"
                          >
                            <Download className="h-3.5 w-3.5" /><UiText id="works.m4673a2306165" /></button>
                        ) : null}
                      </div>
                    </div>
                    <div className="min-h-[344px] p-3">
                      {detailsLoading || detailsError ? <div className="py-12 text-center text-xs text-[var(--app-muted)]">{detailsError ? <UiText id="works.m26040899e555" /> : <UiText id="works.m10fca0952e79" />}</div> : inputImages.length ? (
                        <div className={getAssetPreviewGridClass(inputImages.length)}>
                          {inputImages.map((src, i) => {
                            const kind = inferKind(src);
                            const label = text("workspaceFollowup.m63ec26d101a0", { v0: uiLabel(modeInfo.uploadTitle), v1: i + 1 });
                            const className = getAssetPreviewCardClass(inputImages.length, kind);
                            if (kind === "audio" || kind === "file") {
                              return <div key={`${src}_${i}`} className={className}>{renderMediaPreview(src, inputImages.length, label)}</div>;
                            }
                            return (
                              <button
                                key={`${src}_${i}`}
                                type="button"
                                onClick={() => openZoom(inputImages, i, modeInfo.uploadTitle)}
                                className={`${className} group relative cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary-bg)]`}
                                aria-label={text("workspaceFollowup.m359b0c659952", { v0: label })}
                              >
                                {renderMediaPreview(src, inputImages.length, label)}
                                <span className="pointer-events-none absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] opacity-0 shadow-[var(--shadow-2)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                  <ZoomIn className="h-4 w-4" />
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex min-h-[320px] items-center justify-center px-6 text-center text-xs text-[var(--app-muted)]">{uiLabel(modeInfo.emptyText)}</div>
                      )}
                    </div>
                  </article>

                  <article className="min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-2)]">
                    <div className="min-h-[64px] border-b border-[var(--border)] px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="text-xs font-semibold text-[var(--app-fg)]"><UiText id="works.ma78c1924def7" /></div>
                            <div className="text-[11px] text-[var(--app-muted)]">{mediaCountText(outputPaths.length, locale, text)}</div>
                          </div>
                          <div className="mt-1 text-[11px] text-[var(--app-muted)]"><UiText id="works.m90370d404809" /></div>
                        </div>
                        {onDownloadOutput ? (
                          <button
                            type="button"
                            onClick={() => onDownloadOutput(item)}
                            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 text-[11px] text-[var(--app-muted)] transition hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]"
                          >
                            <Download className="h-3.5 w-3.5" /><UiText id="works.m4673a2306165" /></button>
                        ) : null}
                      </div>
                    </div>
                    <div className="min-h-[344px] p-3">
                      {outputPaths.length ? (
                        <div className={getAssetPreviewGridClass(outputPaths.length)}>
                          {outputPaths.map((src, i) => {
                            const kind = inferKind(src);
                            const label = text("workspaceFollowup.me81f4aedd6f8", { v0: i + 1 });
                            const className = getAssetPreviewCardClass(outputPaths.length, kind);
                            if (kind === "audio" || kind === "file") {
                              return <div key={`${src}_${i}`} className={className}>{renderMediaPreview(src, outputPaths.length, label)}</div>;
                            }
                            return (
                              <button
                                key={`${src}_${i}`}
                                type="button"
                                onClick={() => openZoom(outputPaths, i, "生成结果")}
                                className={`${className} group relative cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary-bg)]`}
                                aria-label={text("workspaceFollowup.m359b0c659952", { v0: label })}
                              >
                                {renderMediaPreview(src, outputPaths.length, label)}
                                <span className="pointer-events-none absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] text-[var(--app-fg)] opacity-0 shadow-[var(--shadow-2)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                  <ZoomIn className="h-4 w-4" />
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : item.status === "failed" ? (
                        <div className="flex min-h-[320px] items-center justify-center px-3">
                          <div className="w-full max-w-md">
                            <FriendlyErrorBlock error={item.errorMsg || "未记录失败原因"} defaultOpen />
                          </div>
                        </div>
                      ) : (
                        <div className="flex min-h-[320px] items-center justify-center text-center text-xs text-[var(--app-muted)]"><UiText id="works.ma7428c56eea4" /></div>
                      )}
                    </div>
                  </article>
                </div>
                </section>

                <section className="space-y-3">
                  <div className="flex min-h-8 items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-[var(--app-fg)]"><UiText id="works.m4b47dbae97ba" /></div>
                    <button
                      type="button"
                      onClick={() => void handleCopy("prompt", prompt)}
                      className="h-8 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-xs text-[var(--app-muted)] transition hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]"
                    >
                      {copiedTarget === "prompt" ? <UiText id="works.m8f6f8d979c98" /> : <UiText id="works.m3ed2c259da32" />}
                    </button>
                  </div>
                  <div className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-4 text-[12px] leading-5 text-[var(--app-fg)]">
                    {prompt || "--"}
                  </div>
                </section>

                <section className="space-y-3">
                  <div className="flex min-h-8 items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-[var(--app-fg)]"><UiText id="works.m9634fb0832be" /></div>
                    <button
                      type="button"
                      onClick={() => void handleCopy("params", paramsJson)}
                      disabled={detailsLoading || !!detailsError}
                      className="h-8 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-3 text-xs text-[var(--app-muted)] transition hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]"
                    >
                      {copiedTarget === "params" ? <UiText id="works.m8f6f8d979c98" /> : <UiText id="works.me7614ca7c735" />}
                    </button>
                  </div>

                  {detailsLoading || detailsError ? <div className="py-6 text-xs text-[var(--app-muted)]">{detailsError ? <UiText id="works.m17d3615cbbac" /> : <UiText id="works.m505495cc20a6" />}</div> : paramGroups.length ? (
                    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] divide-y divide-[var(--border)]">
                      {paramGroups.map((group) => (
                        <div key={group.title} className="p-4">
                          <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-[var(--app-muted)]">
                            {uiLabel(group.title)}
                          </div>
                          <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                            {group.entries.map((e) => (
                              <div
                                key={e.label}
                                className={e.layout === "wide-scroll" ? "min-w-0 sm:col-span-2" : "min-w-0"}
                              >
                                {e.layout === "wide-scroll" ? (
                                  <>
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="text-[11px] text-[var(--app-muted)]">{uiLabel(e.label)}</div>
                                      <button
                                        type="button"
                                        onClick={() => void handleCopy("userPrompt", e.value)}
                                        className="h-7 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 text-[11px] text-[var(--app-muted)] transition hover:bg-[var(--panel-3)] hover:text-[var(--app-fg)]"
                                      >
                                        {copiedTarget === "userPrompt" ? <UiText id="works.m8f6f8d979c98" /> : <UiText id="works.m3ed2c259da32" />}
                                      </button>
                                    </div>
                                    <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[12px] leading-5 text-[var(--app-fg)]">
                                      {e.value}
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="text-[11px] text-[var(--app-muted)]">{uiLabel(e.label)}</div>
                                    <div className="mt-0.5 break-words text-[12px] leading-5 text-[var(--app-fg)]">{locale === "en" && e.numericValue !== undefined ? e.numericValue.toLocaleString("en-US", { maximumFractionDigits: 20 }) : LOCALIZED_PARAM_VALUE_FIELDS.has(e.label) ? uiLabel(e.value) : e.value}</div>
                                  </>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] px-4 py-6 text-center text-xs text-[var(--app-muted)]"><UiText id="works.me258b16d3aee" /></div>
                  )}

                  {!detailsLoading && !detailsError && <GoogleGroundingSources key={item.id} grounding={item.params?.googleGrounding} />}

                  {parameterView === "full" && <details className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3">
                    <summary className="cursor-pointer select-none text-xs text-[var(--app-muted)]"><UiText id="works.mbfa8b7b57664" /></summary>
                    <div className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--app-fg)]">{paramsJson}</div>
                  </details>}
                </section>
              </div>
            </div>
          </div></UiProps>
        </div>
      </div>
      <MediaLightbox
        open={Boolean(zoomEntry)}
        src={zoomEntry?.src || null}
        kind={zoomEntry?.kind || "image"}
        title={zoomPreview?.title || ""}
        layout="floating"
        counter={zoomPreview ? `${zoomPreview.index + 1}/${zoomPreview.entries.length}` : undefined}
        counterAlwaysVisible
        dots={zoomPreview ? { count: zoomPreview.entries.length, activeIndex: zoomPreview.index } : undefined}
        hasPrev={Boolean(zoomPreview && zoomPreview.index > 0)}
        hasNext={Boolean(zoomPreview && zoomPreview.index < zoomPreview.entries.length - 1)}
        onPrev={() =>
          setZoomPreview((current) =>
            current ? { ...current, index: Math.max(0, current.index - 1) } : null,
          )
        }
        onNext={() =>
          setZoomPreview((current) =>
            current
              ? { ...current, index: Math.min(current.entries.length - 1, current.index + 1) }
              : null,
          )
        }
        onClose={() => setZoomPreview(null)}
      />
    </>
  );
}
