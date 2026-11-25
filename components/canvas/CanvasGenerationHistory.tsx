"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";

import { Seedream55Result } from "@/components/image/seedream-55-result";

import { GoogleGroundingSources } from "@/components/image/google-grounding-sources";
import { useCanvasReadOnly, useCanvasObserver } from "./CanvasReadOnlyContext";
import * as React from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownWideNarrow, ArrowUpWideNarrow, Check, Copy, Download, Grid2X2, Grid3X3, History, ImageIcon, ListChecks, Loader2, Music2, Play, Plus, RefreshCw, Trash2, Video, X } from "lucide-react";
import { MediaImage } from "@/components/ui/media-image";
import { DateGroupCheckbox } from "@/components/ui/date-group-checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { warmResilientImageCandidatesBatch } from "@/components/ui/resilient-image";
import { buildMediaPreviewCandidates, isVideoMediaUrl } from "@/lib/media-url";
import { getCanvasMediaDownloadName } from "@/lib/canvas/material-name";
import { type CanvasHistoryAsset, type CanvasHistoryDetail, type CanvasHistoryKind, type CanvasHistoryReference } from "@/lib/assets/canvas-history";
import { publishGenerationDeleted, subscribeGenerationDeleted } from "@/lib/generation-deletion-events";
import { prefetchCanvasHistoryDetail, useCanvasGenerationHistory, useCanvasHistoryDetail } from "./use-canvas-generation-history";
import { CanvasHistoryGrid, type HistoryGridHandle, type HistoryScrollPosition } from "./CanvasHistoryGrid";
import CanvasHistoryMediaPreview, { type HistoryPreviewMedia } from "./CanvasHistoryMediaPreview";
import "./canvas-generation-history.css";
import { useModelDisplayNames } from "@/hooks/use-model-display-names";
import { resolveModelDisplayName } from "@/lib/model-display-name";
import { getImageModelParams } from "@/lib/generation/image-model-params";
import { GPT_IMAGE_25_QUALITY_OPTIONS } from "@/lib/gpt-image-25-models";
import { isQwenImage3Model } from "@/lib/qwen-image-3-models";

const labels = { image: "图片", video: "视频", audio: "音频" };
const icons = { image: ImageIcon, video: Video, audio: Music2 };
const previewSize = { width: 320, height: 320 };
const parameterLabels: Record<string, string> = { version: "版本", custom: "自定义", instrumental: "纯音乐", style: "音乐风格", title: "歌曲标题", negative_tags: "排除风格", auto_lyrics: "歌词二次创作", max_mode: "Max 模式", vocal_gender: "人声", style_weight: "风格影响", weirdness_constraint: "创意度", variety: "风格变化", audio_format: "输出格式", aspectRatio: "比例", ratio: "比例", resolution: "分辨率", customSize: "尺寸", quality: "画质", duration: "时长", durationSeconds: "时长（秒）", seed: "种子", generateAudio: "生成声音", voiceId: "音色", speed: "语速", pitch: "音调", volume: "音量", audioFormat: "格式", sampleRate: "采样率" };

function historyParameter(detail: CanvasHistoryDetail, key: string, value: string | number | boolean) {
  let label = parameterLabels[key] || key;
  let displayValue = typeof value === "boolean" ? value ? "开启" : "关闭" : String(value);
  if (detail.displayKind === "image") {
    const model = detail.model || "";
    const params = getImageModelParams(model, String(detail.params.resolution || ""), String(detail.params.aspectRatio || detail.params.ratio || ""));
    const options = key === "quality" ? params.qualities : key === "resolution" ? params.resolutions : key === "aspectRatio" || key === "ratio" ? params.aspectRatios : [];
    // Resolve the recorded value against the same options as the parameter panel;
    // never replace a historical value with the model's current default.
    displayValue = options.find(option => option.value === String(value))?.label || displayValue;
    if (isQwenImage3Model(model)) {
      if (key === "quality") label = "图片质量";
      if (key === "resolution") label = "清晰度";
    }
  }
  if (key === "aspectRatio" || key === "ratio") {
    if (displayValue === "auto") displayValue = "自适应";
    if (displayValue === "custom") displayValue = "自定义";
  }
  return { label, displayValue };
}
type AddMedia = CanvasHistoryReference & { prompt?: string; model?: string | null; posterUrl?: string | null };
type Props = { selectionKind?: CanvasHistoryKind; open: boolean; owner: number | "guest"; canvasId: number; onClose: () => void; onAdd: (items: AddMedia[]) => void | Promise<void> };

function thumbnail(asset: CanvasHistoryAsset) {
  if (asset.displayKind === "audio") return "";
  const url = asset.thumbUrl || asset.posterUrl || asset.previewUrl || asset.localPath;
  return isVideoMediaUrl(url) ? "" : url;
}

const Thumbnail = React.memo(function Thumbnail({ item }: { item: CanvasHistoryAsset }) {
  const Icon = icons[item.displayKind];
  return <><Icon className="history-media-placeholder" aria-hidden="true" />{thumbnail(item) && <MediaImage src={thumbnail(item)} alt="" previewSize={previewSize} className="history-thumbnail" />}{item.displayKind !== "image" && <span className="history-kind-badge"><Icon size={13} /></span>}</>;
});

function Preview({ media, poster, onPlay }: { media: CanvasHistoryReference; poster?: string | null; onPlay: () => void }) {
  if (media.kind === "audio") return <UiProps ids={{"aria-label":["canvas.m3cc14feed625"]}}><button type="button" className="history-audio-preview history-preview-trigger" aria-label="canvas.m3cc14feed625" onClick={onPlay}><Music2 size={48} /><span className="inline-flex items-center gap-2 text-sm"><Play size={18} /><UiText id="canvas.m3cc14feed625" /></span></button></UiProps>;
  if (media.kind === "video") return <UiProps ids={{"aria-label":["canvas.m327c57c8b406"]}}><button type="button" className="history-video-cover" aria-label="canvas.m327c57c8b406" onClick={onPlay}>
      {poster ? <UiProps ids={{"alt":["canvas.mcd088db2247a"]}}><MediaImage src={poster} alt={media.name || "canvas.mcd088db2247a"} previewSize={{ width: 800, height: 1000, mode: "contain" }} className="history-preview-media" /></UiProps> : <Video className="history-video-placeholder" size={48} />}
      <span className="history-video-play"><Play size={24} fill="currentColor" /></span>
    </button></UiProps>;
  return <UiProps ids={{"aria-label":["canvas.maf34e80f774e"]}}><button type="button" className="history-preview-trigger" aria-label="canvas.maf34e80f774e" onClick={onPlay}><UiProps ids={{"alt":["canvas.m41f5a2620e4b"]}}><MediaImage src={media.url} alt={media.name || "canvas.m41f5a2620e4b"} previewSize={{ width: 800, height: 1000, mode: "contain" }} className="history-preview-media" /></UiProps></button></UiProps>;
}

function HistoryPrompt({ text }: { text: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const [overflowing, setOverflowing] = React.useState(false);
  const textRef = React.useRef<HTMLParagraphElement>(null);
  const textId = React.useId();

  React.useLayoutEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 20.4;
      setOverflowing(element.scrollHeight > lineHeight * 3 + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    return () => observer.disconnect();
  }, [text]);

  return <div className="history-prompt-container">
    <p ref={textRef} id={textId} className={`history-prompt${expanded ? "" : " is-collapsed"}`}>{text || <UiText id="canvas.m827d156d9b4f" />}</p>
    {overflowing && <UiProps ids={{"aria-label":["canvas.m744ca4083996","canvas.m86f09e51e5a4"]}}><button className={expanded ? "history-prompt-collapse" : "history-prompt-expand"} aria-label={expanded ? "canvas.m744ca4083996" : "canvas.m86f09e51e5a4"} aria-expanded={expanded} aria-controls={textId} onClick={() => setExpanded(value => !value)}>{expanded ? <UiText id="canvas.mafd4b783536b" /> : "..."}</button></UiProps>}
  </div>;
}

export default function CanvasGenerationHistory({ open, owner, canvasId, onClose, onAdd, selectionKind }: Props) {
  const { text, locale, label } = useUiLocale();
  const readOnly = useCanvasReadOnly();
  const adminKey = useCanvasObserver();
  const modelNames = useModelDisplayNames(open);
  const queryClient = useQueryClient();
  const [scope, setScope] = React.useState<"all" | "current">("all");
  const [kind, setKind] = React.useState<CanvasHistoryKind>(selectionKind || "image");
  const [order, setOrder] = React.useState<"asc" | "desc">("desc");
  const [tileSize, setTileSize] = React.useState(() => {
    try { return Math.max(96, Math.min(224, Number(localStorage.getItem(`canvas-history-size:${owner}`)) || 128)); } catch { return 128; }
  });
  const [active, setActive] = React.useState<CanvasHistoryAsset | null>(null);
  const [reference, setReference] = React.useState<CanvasHistoryReference | null>(null);
  const [batch, setBatch] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [deleteTargets, setDeleteTargets] = React.useState<CanvasHistoryAsset[]>([]);
  const [notice, setNotice] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [mediaPreview, setMediaPreview] = React.useState<{ items: HistoryPreviewMedia[]; index: number } | null>(null);
  React.useEffect(() => { if (!open) setMediaPreview(null); }, [open]);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HistoryGridHandle>(null);
  const scrollPositions = React.useRef(new Map<string, HistoryScrollPosition>());
  const feed = useCanvasGenerationHistory({ adminKey, owner, canvasId: scope === "current" ? canvasId : null, kind, order }, open, canvasId);
  const detail = useCanvasHistoryDetail(owner, active?.id || null, open, adminKey);

  React.useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    rootRef.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }); };
  }, [open]);

  React.useEffect(() => {
    const remove = (ids: number[]) => {
      const hidden = new Set(ids);
      setActive(item => item && hidden.has(item.id) ? null : item);
      setSelected(current => new Set([...current].filter(id => !hidden.has(id))));
    };
    return subscribeGenerationDeleted(remove);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const urls = feed.items.slice(0, 16).map(thumbnail).filter(Boolean);
    return warmResilientImageCandidatesBatch(urls.map(url => buildMediaPreviewCandidates(url, previewSize)), { limit: 16, batchSize: 4 });
  }, [open, feed.items]);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const close = () => { if (busy) return; onClose(); };
  const changeFilter = (action: () => void) => { action(); setSelected(new Set()); setActive(null); setReference(null); };
  const sendToCanvas = async (items: AddMedia[], successMessage: string) => {
    if (readOnly) return;
    if (busy) return;
    setBusy(true); setNotice(text("workspaceFollowup.mc13059f6dc42"));
    try { await onAdd(items); setNotice(successMessage); }
    catch (error) { setNotice(error instanceof Error ? error.message : text("workspaceFollowup.m2096e97a237f")); }
    finally { setBusy(false); }
  };
  const add = (items: CanvasHistoryAsset[]) => {
    if (selectionKind && (items.length !== 1 || items[0].displayKind !== selectionKind)) return;
    if (items.length > 50) { setNotice(text("workspaceFollowup.m9f76341dcf23")); return; }
    void sendToCanvas(items.map(item => ({ url: item.localPath, kind: item.displayKind, name: `${labels[item.displayKind]} ${item.id}`, posterUrl: item.posterUrl, ...(detail.data?.id === item.id ? { prompt: detail.data.prompt, model: detail.data.model } : {}) })), `已添加 ${items.length} 个素材到画布`);
  };
  const download = async (items: CanvasHistoryReference[]) => {
    if (busy) return;
    setBusy(true);
    try {
      // Sequential downloads bound memory even when selecting large videos.
      for (const item of items) {
        const anchor = document.createElement("a");
        anchor.download = getCanvasMediaDownloadName(item);
        if (item.url.startsWith("/")) { anchor.href = item.url; anchor.click(); }
        else {
          const response = await fetch(item.url);
          if (!response.ok) throw new Error("下载失败，请重试");
          const url = URL.createObjectURL(await response.blob());
          anchor.href = url; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        }
      }
      setNotice(text("workspaceFollowup.m3ef9b9f84210"));
    } catch (error) { setNotice(error instanceof Error ? error.message : text("workspaceFollowup.m8a03e35ad323")); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (readOnly) return;
    setBusy(true);
    const failed: CanvasHistoryAsset[] = [];
    const ids: number[] = [];
    // Small batches avoid flooding the shared asset API.
    for (let index = 0; index < deleteTargets.length; index += 4) {
      await Promise.all(deleteTargets.slice(index, index + 4).map(async item => {
        try {
          const response = await fetch(`/api/assets/${item.id}?view=canvas-history`, { method: "DELETE" });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error);
          ids.push(...(payload.ids || [item.id]));
        } catch { failed.push(item); }
      }));
    }
    if (ids.length) publishGenerationDeleted(ids);
    setDeleteTargets(failed); setBusy(false);
    setNotice(failed.length ? text("workspaceFollowup.m61ae0533ebe5", { v0: ids.length, v1: failed.length }) : text("workspaceFollowup.mac3dc2eeac10", { v0: ids.length }));
    return failed.length === 0;
  };

  if (!open) return null;
  const selectedItems = feed.items.filter(item => selected.has(item.id));
  const preview = reference || (active ? { url: active.localPath, kind: active.displayKind, name: `${labels[active.displayKind]} ${active.id}` } : null);
  return createPortal(<>
    <div className="canvas-history-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div ref={rootRef} role="dialog" aria-modal="true" aria-labelledby="canvas-history-title" tabIndex={-1} className="canvas-history-dialog" data-canvas-generation-history onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => {
        event.stopPropagation();
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (event.key === "Tab") {
          const nodes = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, audio, video, [href]')].filter(node => node.getClientRects().length);
          const first = nodes[0], last = nodes.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === rootRef.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <header className="history-header"><h2 id="canvas-history-title"><UiText id="canvas.m4a8255fdfa4d" /></h2><UiProps ids={{"aria-label":["canvas.mb5b3e7da6ec0"]}}><button className="history-icon-button" onClick={close} aria-label="canvas.mb5b3e7da6ec0" disabled={busy}><X size={20} /></button></UiProps></header>
        <div className="history-body">
          <main className="history-main">
            <div className="history-toolbar">
              <UiProps ids={{"aria-label":["canvas.m855fc569b267"]}}><div className="history-scope" aria-label="canvas.m855fc569b267">{(["all", "current"] as const).map(value => <button key={value} aria-pressed={scope === value} onClick={() => changeFilter(() => setScope(value))}>{value === "all" ? <UiText id="canvas.mfde24b48fcd4" /> : <UiText id="canvas.me4f08860a129" />}</button>)}</div></UiProps>
              <span className="history-divider" />
              <UiProps ids={{"aria-label":["canvas.mc7da197eeb31"]}}><div className="history-tabs" aria-label="canvas.mc7da197eeb31">{(selectionKind ? [selectionKind] : ["image", "video", "audio"] as const).map(value => <button key={value} aria-pressed={kind === value} onClick={() => changeFilter(() => setKind(value))}>{label(labels[value])}<span>{feed.counts.data?.[value]?.toLocaleString(locale === "en" ? "en-US" : "zh-CN", { useGrouping: locale === "en" }) ?? "—"}</span></button>)}</div></UiProps>
              <div className="history-toolbar-actions"><UiProps ids={{"aria-label":["canvas.ma8be9a941f62"]}}><button className="history-icon-button" aria-label="canvas.ma8be9a941f62" disabled={feed.refreshing || feed.isFetching} onClick={() => void feed.refresh()}><RefreshCw size={15} className={feed.refreshing ? "animate-spin" : ""} /></button></UiProps><button onClick={() => changeFilter(() => setOrder(order === "desc" ? "asc" : "desc"))}>{order === "desc" ? <ArrowDownWideNarrow size={16} /> : <ArrowUpWideNarrow size={16} />}{order === "desc" ? <UiText id="canvas.m21039f948d40" /> : <UiText id="canvas.maef8a3f8db51" />}</button><span className="history-divider" /><div className="history-density"><Grid3X3 size={15} /><UiProps ids={{"aria-label":["canvas.mc1b8e8fa780b"]}}><input aria-label="canvas.mc1b8e8fa780b" type="range" min={96} max={224} step={16} value={tileSize} onChange={event => { const value = Number(event.target.value); setTileSize(value); try { localStorage.setItem(`canvas-history-size:${owner}`, String(value)); } catch {} }} /></UiProps><Grid2X2 size={15} /></div><span className="history-divider" /><button hidden={Boolean(selectionKind)} aria-pressed={batch} onClick={() => { setBatch(!batch); setSelected(new Set()); }}><ListChecks size={16} />{batch ? <UiText id="canvas.m571e8b9e66f2" /> : <UiText id="canvas.m10c9416459ad" />}</button></div>
            </div>
            {batch && <div className="history-batch"><span><UiText id="canvas.m52c963128eab" />{selectedItems.length}</span><button disabled={readOnly || !selectedItems.length || busy || feed.isPlaceholderData} onClick={() => add(selectedItems)}><Plus size={14} /><UiText id="canvas.m675d68135324" /></button><button disabled={!selectedItems.length || busy || feed.isPlaceholderData} onClick={() => void download(selectedItems.map(item => ({ url: item.localPath, kind: item.displayKind, name: `${labels[item.displayKind]} ${item.id}` })))}><Download size={14} /><UiText id="canvas.m4673a2306165" /></button><button disabled={readOnly || !selectedItems.length || busy || feed.isPlaceholderData} onClick={() => setDeleteTargets(selectedItems)}><Trash2 size={14} /><UiText id="canvas.m2f9daa828907" /></button></div>}
            {feed.refreshError && <button className="history-error" onClick={() => void feed.refresh()}>{feed.refreshError}<UiText id="canvas.md3f580d012e6" /></button>}
            {feed.hasUpdates && <button className="history-update-notice" onClick={() => { feed.applyUpdates(); listRef.current?.scrollToTop(); }}><UiText id="canvas.m9d3444600ae3" /></button>}
            <div className="history-grid" aria-busy={feed.isLoading || feed.isPlaceholderData}>
              {feed.isPlaceholderData && <div role="status" className="history-switch-loading"><Loader2 size={14} className="animate-spin" /><UiText id="canvas.m83a272dbc392" /></div>}
              {feed.isLoading && <div className="history-skeletons" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))` }}>{Array.from({ length: 18 }, (_, index) => <div key={index} />)}</div>}
              {!feed.isLoading && !feed.items.length && <div className="history-empty">{feed.isError ? <><History size={34} /><p><UiText id="canvas.md9a0d7acce25" /></p><button onClick={() => void feed.refetch()}><UiText id="canvas.m7bdd5ce1e298" /></button></> : <><History size={34} /><p>{scope === "current" ? <UiText id="canvas.me4f08860a129" /> : <UiText id="canvas.mfde24b48fcd4" />}<UiText id="canvas.mb336a174cd1f" />{label(labels[kind])}<UiText id="canvas.m07fe044641d0" /></p><span><UiText id="canvas.m5cf8e43a6c9c" />{label(labels[kind])}<UiText id="canvas.mf405e0f06948" /></span></>}</div>}
              {!!feed.items.length && <CanvasHistoryGrid ref={listRef} items={feed.items} tileSize={tileSize} viewKey={feed.displayKey} positions={scrollPositions.current}
                renderDate={(date, ids) => <>{batch && <DateGroupCheckbox date={date} ids={ids} selected={selected} onChange={setSelected} disabled={busy || feed.isPlaceholderData} />}{date}</>}
                onLoadMore={feed.hasNextPage && !feed.isFetching && !feed.isFetchNextPageError && !feed.isPlaceholderData ? () => { void feed.fetchNextPage(); } : undefined}
                footer={<div className="history-footer">{feed.isFetchingNextPage ? <><Loader2 size={15} className="animate-spin" /><UiText id="canvas.mb3cb3861e481" /></> : feed.isFetchNextPageError ? <button onClick={() => void feed.fetchNextPage()}><UiText id="canvas.m4421bcd0ad93" /></button> : feed.hasNextPage ? <button disabled={feed.isPlaceholderData} onClick={() => void feed.fetchNextPage()}><UiText id="canvas.maf90a08fec8e" /></button> : null}</div>}
              >{item => <button className={`history-tile${active?.id === item.id || selected.has(item.id) ? " is-selected" : ""}`} aria-label={`${label(labels[item.displayKind])} ${item.id}`} aria-disabled={feed.isPlaceholderData} aria-pressed={batch ? selected.has(item.id) : active?.id === item.id}
                onMouseEnter={() => { if (!batch && !feed.isPlaceholderData) prefetchCanvasHistoryDetail(queryClient, owner, item.id, adminKey); }}
                onFocus={() => { if (!batch && !feed.isPlaceholderData) prefetchCanvasHistoryDetail(queryClient, owner, item.id, adminKey); }}
                onClick={() => {
                if (feed.isPlaceholderData) return;
                if (batch) setSelected(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; });
                else { setActive(item); setReference(null); }
              }}><Thumbnail item={item} />{batch && <span className="history-checkbox">{selected.has(item.id) && <Check size={14} />}</span>}</button>}</CanvasHistoryGrid>}
            </div>
          </main>
          {!selectionKind && active && preview && <UiProps ids={{"aria-label":["canvas.m9713e97b9941"]}}><aside className="history-detail" aria-label="canvas.m9713e97b9941">
            <div className="history-detail-heading"><h3>{label(labels[active.displayKind])}</h3><UiProps ids={{"aria-label":["canvas.m543aa424a7c1"]}}><button className="history-icon-button" aria-label="canvas.m543aa424a7c1" onClick={() => { setActive(null); setReference(null); }}><X size={17} /></button></UiProps></div>
            <div className="history-detail-scroll"><div className="history-preview"><Preview key={preview.url} media={preview} poster={reference ? null : active.posterUrl || thumbnail(active)} onPlay={() => {
              const items: HistoryPreviewMedia[] = reference ? detail.data?.references || [reference] : feed.items.filter(item => item.displayKind === preview.kind).map(item => ({ url: item.localPath, kind: item.displayKind, name: `${labels[item.displayKind]} ${item.id}`, posterUrl: item.posterUrl || thumbnail(item) }));
              setMediaPreview({ items, index: Math.max(0, items.findIndex(item => item.url === preview.url)) });
            }} /></div>{reference && <button className="history-back-to-output" onClick={() => setReference(null)}><UiText id="canvas.m4cf789f83496" /></button>}
              <dl className="history-metadata">{detail.data?.creator && <><dt><UiText id="canvas.m86098c238072" /></dt><dd>{detail.data.creator}</dd></>}<dt><UiText id="canvas.m07ec86e0f1d4" /></dt><dd>{new Date(active.createdAt).toLocaleString(locale === "en" ? "en-US" : "zh-CN", locale === "en" ? { dateStyle: "medium", timeStyle: "short" } : { hour12: false })}</dd></dl>
              {detail.isError ? <button className="history-error" onClick={() => void detail.refetch()}><UiText id="canvas.m6d9d6c41e4ac" /></button> : detail.data && <>
                <div className="history-section-label"><h4><UiText id="canvas.m4b47dbae97ba" /></h4><UiProps ids={{"aria-label":["canvas.m3ed2c259da32"]}}><button className="history-icon-button" aria-label="canvas.m3ed2c259da32" onClick={() => void navigator.clipboard.writeText(detail.data!.prompt || "").then(() => setNotice("已复制提示词")).catch(() => setNotice("复制失败，请重试"))}><Copy size={14} /></button></UiProps></div>
                <HistoryPrompt key={active.id} text={detail.data.prompt} /><div className="history-parameters">{detail.data.model && <span>{resolveModelDisplayName(detail.data.model, modelNames, { gptImage25Mode: detail.data.gptImage25Mode })}</span>}{Object.entries(detail.data.params).filter(([key]) => key !== "customSize").map(([key, value]) => {
                  const parameter = historyParameter(detail.data, key, value);
                  return <span key={key} title={label(parameter.label)}>{label(parameter.label)} {typeof value === "number" && locale === "en" && parameter.displayValue === String(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 20 }) : ["quality", "resolution", "aspectRatio", "ratio", "generateAudio", "custom", "instrumental", "max_mode", "auto_lyrics"].includes(key) ? label(parameter.displayValue) : parameter.displayValue}</span>;
                })}</div>
                <Seedream55Result output={detail.data.seedream55Output} />
                <GoogleGroundingSources key={active.id} grounding={detail.data.googleGrounding} />
                <h4 className="history-reference-heading"><UiText id="canvas.m4cc7d781d57a" /><span>{detail.data.references.length}</span></h4>{detail.data.references.length ? <div className="history-references">{detail.data.references.map((item, index) => { const Icon = icons[item.kind]; return <button key={item.url} aria-label={text("workspaceFollowup.m9e70ce0a7a24", { v0: label(labels[item.kind]), v1: index + 1 })} title={text("workspaceFollowup.m727c6ff286ef", { v0: label(labels[item.kind]), v1: index + 1 })} onClick={() => {
                  setReference(item);
                  setMediaPreview({ items: detail.data.references, index });
                }}><Icon size={22} />{item.kind === "image" && <MediaImage src={item.url} alt={text("workspaceFollowup.m4be0aaeac052", { v0: index + 1 })} previewSize={{ width: 160, height: 160 }} className="history-thumbnail" />}<span>{index + 1}</span></button>; })}</div> : <p className="history-no-references"><UiText id="canvas.m002528f12953" /></p>}
              </>}
            </div>
            <div className="history-detail-actions"><button className="history-add" disabled={readOnly || busy} onClick={() => { if (reference) { void sendToCanvas([reference], "已添加参考素材到画布"); } else add([active]); }}><Plus size={16} /><UiText id="canvas.m675d68135324" /></button><div><button className="history-delete" disabled={readOnly || busy} onClick={() => setDeleteTargets([active])}><Trash2 size={15} /><UiText id="canvas.m2f9daa828907" /></button><button disabled={busy} onClick={() => void download([preview])}><Download size={15} /><UiText id="canvas.m4673a2306165" /></button></div></div>
          </aside></UiProps>}
        </div>
        {selectionKind && <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] p-4">
          <button className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm" onClick={onClose}><UiText id="canvas.m2cd0f3be8738" /></button>
          <button className="rounded-lg bg-[var(--primary-bg)] px-4 py-2 text-sm text-[var(--primary-fg)] disabled:opacity-40" disabled={!active || active.displayKind !== selectionKind || feed.isPlaceholderData} onClick={() => active && add([active])}><UiText id="canvas.mac975a30a87f" /></button>
        </div>}
        {notice && <div className="history-notice" role="status">{label(notice)}</div>}
      </div>
    </div>
    <UiProps ids={{"title":["canvas.m50aa9f483d1e"],"description":["canvas.m9d75573aee92"],"confirmText":["canvas.m2f9daa828907"]}}><ConfirmDialog zIndex={210} open={deleteTargets.length > 0} title={deleteTargets.length > 1 ? text("workspaceFollowup.me9b840c37261", { v0: deleteTargets.length }) : "canvas.m50aa9f483d1e"} description="canvas.m9d75573aee92" confirmText="canvas.m2f9daa828907" danger onConfirm={remove} onClose={() => setDeleteTargets([])} /></UiProps>
    {mediaPreview && <CanvasHistoryMediaPreview items={mediaPreview.items} initialIndex={mediaPreview.index} onClose={() => setMediaPreview(null)} onDownload={item => void download([item])} />}
  </>, document.body);
}
