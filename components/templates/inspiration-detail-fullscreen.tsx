"use client";
import { UiText } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { AppVideoPlayer } from "@/components/ui/app-video-player";
import { MediaImage } from "@/components/ui/media-image";

type DetailPayload = {
  type: string;
  model: string | null;
  params: Record<string, any>;
  inputImages: string[];
  outputPaths: string[];
};

export type InspirationDetailViewItem = {
  id: number;
  title: string;
  prompt: string;
  description?: string | null;
  toolType?: string;
  mediaType?: string;
  tags?: string[];
  createdAt?: string;
  detail: DetailPayload;
};

type Props = {
  open: boolean;
  item: InspirationDetailViewItem | null;
  onClose: () => void;
  onApplyTemplate?: (item: InspirationDetailViewItem) => void;
  applying?: boolean;
  applied?: boolean;
};

type PreviewState = {
  kind: "output" | "input";
  index: number;
};

const PARAM_LABELS: Record<string, string> = {
  model: "模型",
  aspectRatio: "宽高比",
  resolution: "分辨率",
  duration: "时长",
  mode: "模式",
  strength: "强度",
  similarity: "相似度",
  intensity: "强度值",
  outputSize: "输出尺寸",
  seed: "随机种子",
  quality: "质量",
  imageCount: "生成数量"
};

const CORE_KEYS = new Set([
  "model",
  "aspectRatio",
  "resolution",
  "duration",
  "mode",
  "strength",
  "similarity",
  "intensity",
  "outputSize",
  "seed",
  "quality",
  "imageCount"
]);

const HIDDEN_KEYS = new Set([
  "prompt",
  "imagePaths",
  "inputPaths",
  "inputPublicUrls",
  "image_urls",
  "outputPaths",
  "facePath",
  "targetPath",
  "inputUrl",
  "inputMedia",
  "inputPreviewUrl"
]);

function toText(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    return text || "-";
  }
  if (Array.isArray(value)) return value.map((x) => String(x)).filter(Boolean).join(", ") || "-";
  try {
    return JSON.stringify(value);
  } catch {
    return "-";
  }
}

function formatDate(value?: string) {
  if (!value) return "-";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "-";
  return `${time.getFullYear()}-${String(time.getMonth() + 1).padStart(2, "0")}-${String(time.getDate()).padStart(2, "0")} ${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
}

function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm|m4v|avi)(\?.*)?$/i.test(url);
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function InspirationDetailFullscreen({
  open,
  item,
  onClose,
  onApplyTemplate,
  applying = false,
  applied = false
}: Props) {
  const [portalReady, setPortalReady] = React.useState(false);
  const [preview, setPreview] = React.useState<PreviewState>({ kind: "output", index: 0 });
  const [imageScale, setImageScale] = React.useState(1);
  const [tx, setTx] = React.useState(0);
  const [ty, setTy] = React.useState(0);
  const [panning, setPanning] = React.useState(false);
  const panRef = React.useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const imageWrapRef = React.useRef<HTMLDivElement | null>(null);
  const safeItem = item;

  React.useEffect(() => setPortalReady(true), []);

  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  React.useEffect(() => {
    if (!open) return;
    setPreview({ kind: "output", index: 0 });
  }, [open, safeItem?.id]);

  React.useEffect(() => {
    setImageScale(1);
    setTx(0);
    setTy(0);
    setPanning(false);
    panRef.current = null;
  }, [preview.kind, preview.index, safeItem?.id, open]);

  const outputs = safeItem?.detail?.outputPaths || [];
  const inputs = safeItem?.detail?.inputImages || [];
  const tags = Array.isArray(safeItem?.tags) ? safeItem.tags.filter(Boolean) : [];
  const activeOutput = preview.kind === "output" ? preview.index : -1;
  const activeInput = preview.kind === "input" ? preview.index : -1;
  const previewSrc = preview.kind === "input" ? (inputs[preview.index] || "") : (outputs[preview.index] || outputs[0] || "");
  const safeMediaType = safeItem?.mediaType || "image";
  const toolBadge = (safeItem?.toolType || safeItem?.detail?.type || "image").toUpperCase();
  const mediaBadge = (safeMediaType || "image").toUpperCase();
  const badgeList = mediaBadge === toolBadge ? [toolBadge] : [toolBadge, mediaBadge];
  const previewMediaType: "video" | "image" = preview.kind === "output"
    ? ((safeMediaType === "video" || isVideoUrl(previewSrc)) ? "video" : "image")
    : (isVideoUrl(previewSrc) ? "video" : "image");
  const params = safeItem?.detail?.params || {};
  const entries = Object.entries(params).filter(([key]) => !HIDDEN_KEYS.has(key));
  const coreParams = entries.filter(([key]) => CORE_KEYS.has(key));
  const handleImageWheel = React.useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const wrap = imageWrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const px = e.clientX - rect.left - rect.width / 2 - tx;
    const py = e.clientY - rect.top - rect.height / 2 - ty;
    const nextScale = clamp(imageScale * (e.deltaY > 0 ? 0.9 : 1.1), 0.2, 6);
    if (nextScale <= 1) {
      setImageScale(1);
      setTx(0);
      setTy(0);
      setPanning(false);
      panRef.current = null;
      return;
    }
    const ratio = nextScale / imageScale;
    setTx(tx - px * (ratio - 1));
    setTy(ty - py * (ratio - 1));
    setImageScale(Number(nextScale.toFixed(3)));
  }, [imageScale, tx, ty]);

  React.useEffect(() => {
    if (!open) return;
    const onMove = (e: MouseEvent) => {
      if (!panning || !panRef.current) return;
      const dx = e.clientX - panRef.current.x;
      const dy = e.clientY - panRef.current.y;
      setTx(panRef.current.tx + dx);
      setTy(panRef.current.ty + dy);
    };
    const onUp = () => {
      if (!panning) return;
      setPanning(false);
      panRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [open, panning]);

  const onImageMouseDown = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (imageScale <= 1) return;
    e.preventDefault();
    setPanning(true);
    panRef.current = { x: e.clientX, y: e.clientY, tx, ty };
  }, [imageScale, tx, ty]);

  if (!open || !safeItem || !portalReady) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/35 backdrop-blur-[1px] dark:bg-[#090a0f] dark:backdrop-blur-none">
      <div className="flex h-full w-full">
        <div className="relative flex min-w-0 flex-1 flex-col bg-[var(--panel-bg)] dark:bg-[#090a0f]">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)] hover:bg-[var(--panel-3)] dark:border-white/10 dark:bg-[#15161c] dark:hover:bg-[#1b1c24]"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            {previewSrc ? (
              previewMediaType === "video" ? (
                <AppVideoPlayer
                  src={previewSrc}
                  className="h-full w-full object-contain"
                  containerClassName="h-full w-full max-h-full max-w-full rounded-xl"
                />
              ) : (
                <div
                  ref={imageWrapRef}
                  onWheel={handleImageWheel}
                  onMouseDown={onImageMouseDown}
                  className={[
                    "flex h-full w-full items-center justify-center overflow-hidden select-none",
                    imageScale > 1 ? (panning ? "cursor-grabbing" : "cursor-grab") : "cursor-default"
                  ].join(" ")}
                >
                  <img
                    src={previewSrc}
                    alt={safeItem.title}
                    draggable={false}
                    className="pointer-events-none max-h-full max-w-full rounded-xl object-contain transition-transform duration-75"
                    style={{ transform: `translate3d(${tx}px, ${ty}px, 0) scale(${imageScale})` }}
                  />
                </div>
              )
            ) : (
              <div className="text-sm text-[var(--app-muted)]"><UiText id="common.m2b8f23d60fae" /></div>
            )}
          </div>
          <div className="border-t border-[var(--border)] px-6 pb-5 pt-4 dark:border-white/10 dark:bg-[#090a0f]">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3 dark:border-white/10 dark:bg-[#101116]">
                <div className="mb-2 text-xs font-medium text-[var(--app-fg)]"><UiText id="common.m96630ab9cf98" />{inputs.length})</div>
                <div className="flex gap-2 overflow-x-auto">
                  {inputs.length ? inputs.map((src, idx) => (
                    <button
                      key={`${src}-${idx}`}
                      type="button"
                      onClick={() => setPreview({ kind: "input", index: idx })}
                      className={[
                        "h-20 w-20 shrink-0 overflow-hidden rounded-lg border bg-[var(--panel-bg)] dark:bg-[#090a0f]",
                        idx === activeInput ? "border-[var(--primary-bg)]" : "border-[var(--border)]"
                      ].join(" ")}
                    >
                      {isVideoUrl(src) ? (
                        <video src={src} className="h-full w-full object-cover" muted />
                      ) : (
                        <MediaImage src={src} alt={`input-${idx + 1}`} className="h-full w-full object-cover" previewSize={{ width: 120, height: 120 }} />
                      )}
                    </button>
                  )) : <div className="text-xs text-[var(--app-muted)]"><UiText id="common.m96089d49193f" /></div>}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-3 dark:border-white/10 dark:bg-[#101116]">
                <div className="mb-2 text-xs font-medium text-[var(--app-fg)]"><UiText id="common.m029084ee1752" />{outputs.length})</div>
                <div className="flex gap-2 overflow-x-auto">
                  {outputs.length ? outputs.map((src, idx) => (
                    <button
                      key={`${src}-${idx}`}
                      type="button"
                      onClick={() => setPreview({ kind: "output", index: idx })}
                      className={[
                        "h-20 w-20 shrink-0 overflow-hidden rounded-lg border bg-[var(--panel-bg)] dark:bg-[#090a0f]",
                        idx === activeOutput ? "border-[var(--primary-bg)]" : "border-[var(--border)]"
                      ].join(" ")}
                    >
                      {safeMediaType === "video" ? (
                        <video src={src} className="h-full w-full object-cover" muted />
                      ) : (
                        <MediaImage src={src} alt={`output-${idx + 1}`} className="h-full w-full object-cover" previewSize={{ width: 120, height: 120 }} />
                      )}
                    </button>
                  )) : <div className="text-xs text-[var(--app-muted)]"><UiText id="common.mc45ea1690ba4" /></div>}
                </div>
              </div>
            </div>
          </div>
        </div>

        <aside className="flex h-full w-[420px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--panel-2)] text-[var(--app-fg)] dark:border-white/10 dark:bg-[#090a0f]">
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mb-4">
              <div className="flex flex-wrap gap-2">
                {badgeList.map((badge) => (
                  <span key={badge} className="rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-xs dark:border-white/10 dark:bg-[#101116]">{badge}</span>
                ))}
                <span className="rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-xs dark:border-white/10 dark:bg-[#101116]">{formatDate(safeItem.createdAt)}</span>
              </div>
            </div>

            {tags.length ? (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 dark:border-white/10 dark:bg-[#101116]">
                <div className="mb-2 text-xs text-[var(--app-muted)]"><UiText id="common.m487c9516c44a" /></div>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-[var(--border)] px-2 py-1 text-xs text-[var(--app-fg)] dark:border-white/10 dark:bg-[#090a0f]">{tag}</span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 dark:border-white/10 dark:bg-[#101116]">
              <div className="mb-2 text-xs text-[var(--app-muted)]"><UiText id="common.m4b47dbae97ba" /></div>
              <div className="text-sm leading-6 text-[var(--app-fg)] whitespace-pre-wrap">{safeItem.prompt || "-"}</div>
              {safeItem.description ? <div className="mt-2 text-xs text-[var(--app-muted)]">{safeItem.description}</div> : null}
            </div>

            <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel-bg)] p-3 dark:border-white/10 dark:bg-[#101116]">
              <div className="mb-2 text-xs text-[var(--app-muted)]"><UiText id="common.mce36f684c9d8" /></div>
              {coreParams.length ? (
                <div className="grid grid-cols-2 gap-2">
                  {coreParams.map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2 dark:border-white/10 dark:bg-[#15161c]">
                      <div className="text-[11px] text-[var(--app-muted)]">{PARAM_LABELS[key] || key}</div>
                      <div className="mt-1 text-xs text-[var(--app-fg)] break-all">{toText(value)}</div>
                    </div>
                  ))}
                </div>
              ) : <div className="text-xs text-[var(--app-muted)]"><UiText id="common.mb336a174cd1f" /></div>}
            </div>

          </div>

          {onApplyTemplate ? (
            <div className="border-t border-[var(--border)] p-4 dark:border-white/10 dark:bg-[#090a0f]">
              <button
                type="button"
                onClick={() => onApplyTemplate(safeItem)}
                disabled={applying}
                className="h-11 w-full rounded-xl bg-[var(--primary-bg)] text-sm font-semibold text-[var(--primary-fg)] transition hover:opacity-90 disabled:opacity-60"
              >
                {applying ? <UiText id="common.m6703817002c9" /> : applied ? <UiText id="common.mf58574346081" /> : <UiText id="common.mbffa36c49a3a" />}
              </button>
            </div>
          ) : null}
        </aside>
      </div>
    </div>,
    document.body,
  );
}
