"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { createPortal } from "react-dom";
import { Handle, Position, useStore } from "@xyflow/react";
import { AlertTriangle, Check, Clapperboard, Copy, Download, FileText, Film, ImagePlus, LayoutGrid, Loader2, LocateFixed, Maximize2, Music, RotateCcw, Square, Video, X } from "lucide-react";
import type { CanvasBreakdownData } from "@/lib/canvas/document";
import { BREAKDOWN_STAGE_LABELS, BREAKDOWN_STAGES, type BreakdownShot, type BreakdownStage } from "@/lib/canvas/shot-breakdown/types";
import { formatBreakdownTime } from "@/lib/canvas/shot-breakdown/scenes";
import { BREAKDOWN_SHOT_COLUMNS, breakdownShotCell, breakdownShotPrompt, buildBreakdownCsv, buildBreakdownMarkdown } from "@/lib/canvas/shot-breakdown/export";
import { CANVAS_RIGHT_OUTPUT_HANDLE_ID } from "@/lib/canvas/connection-rules";
import { renameCanvasNodeData } from "@/lib/canvas/material-name";
import { isDeliberateDoubleClick } from "@/lib/canvas/double-click-gate";
import { CanvasNodeEditorContext, type CanvasBreakdownModel } from "./CanvasNodeCard";
import { CanvasEditableNodeName } from "./CanvasEditableNodeName";
import { CanvasNodeHeading } from "./CanvasNodeHeading";
import { CanvasMediaImage } from "./CanvasMediaImage";
import { useCanvasReadOnly } from "./CanvasReadOnlyContext";

type Tab = "shots" | "overview" | "segments";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "shots", label: "分镜表" },
  { id: "overview", label: "全片拆解" },
  { id: "segments", label: "复刻片段" },
];
const PROGRESS_STAGES: readonly BreakdownStage[] = BREAKDOWN_STAGES.filter(stage => stage !== "queued" && stage !== "done");
/** Below this zoom the table is unreadable: show a still wall instead of hundreds of DOM rows. */
const BREAKDOWN_DETAIL_ZOOM = 0.35;

function useCopy() {
  const [copied, setCopied] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = React.useCallback((key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(key), () => setCopied(null));
  }, []);
  return { copied, copy };
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileBase(data: CanvasBreakdownData) {
  return (data.title || "拉片").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80);
}

function Chip({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <span className="canvas-breakdown-chip">{children}</span>;
}

function Thumb({ shot, className = "" }: { shot: BreakdownShot; className?: string }) {
  const { text } = useUiLocale();
  return <div className={`canvas-breakdown-thumb ${className}`}>
    {shot.frameUrl ? <CanvasMediaImage src={shot.frameUrl} alt={text("workspaceFollowup.m763b3cf65809", { v0: shot.index })} previewSize={{ width: 400, height: 400, mode: "cover" }} className="h-full w-full object-cover" /> : <Film className="h-5 w-5 opacity-40" />}
    <span className="canvas-breakdown-thumb-index">{shot.index}</span>
  </div>;
}

function OverviewPanel({ data }: { data: CanvasBreakdownData }) {
  const overview = data.overview;
  if (!overview) return <p className="canvas-breakdown-empty">{data.status === "running" ? <UiText id="canvas.m45c5c2cdd81e" /> : <UiText id="canvas.m627c2976fc39" />}</p>;
  return <div className="canvas-breakdown-doc">
    {overview.logline && <section><h4><UiText id="canvas.mb762ecc38c30" /></h4><p className="canvas-breakdown-logline">{overview.logline}</p>{overview.format && <p className="canvas-breakdown-subtext">{overview.format}</p>}</section>}
    {overview.visualDna.length > 0 && <section><h4><UiText id="canvas.m40f8da2a62a8" /></h4><div className="canvas-breakdown-dna">{overview.visualDna.map(row => <div key={row.dimension}><b>{row.dimension}</b><p>{row.value}</p></div>)}</div></section>}
    {overview.keepPoints.length > 0 && <section><h4><UiText id="canvas.m6731f66cdf55" /></h4><ul>{overview.keepPoints.map(item => <li key={item}>{item}</li>)}</ul></section>}
    {overview.recurringElements.length > 0 && <section><h4><UiText id="canvas.m9785f0864dfd" /></h4><div className="flex flex-wrap gap-1.5">{overview.recurringElements.map(item => <Chip key={item}>{item}</Chip>)}</div></section>}
    {overview.skeleton.length > 0 && <section><h4><UiText id="canvas.m9d2e641533b7" /></h4><table className="canvas-breakdown-table"><thead><tr><th><UiText id="canvas.m4fa164bacd53" /></th><th><UiText id="canvas.m5729436e80ca" /></th><th><UiText id="canvas.m0581896f013c" /></th></tr></thead><tbody>{overview.skeleton.map(row => <tr key={row.dimension}><td>{row.dimension}</td><td>{row.construct}</td><td>{row.rule}</td></tr>)}</tbody></table></section>}
    {overview.techniques.length > 0 && <section><h4><UiText id="canvas.m94e8c97080d1" /></h4>{overview.techniques.map(item => <p key={item.name}><b>{item.name}</b>　{item.effect}</p>)}</section>}
    {overview.characters.length > 0 && <section><h4><UiText id="canvas.mbd0ac319113c" /></h4>{overview.characters.map(item => <p key={item.name}><b>{item.name}</b>{item.role && <span className="text-[var(--app-muted)]">（{item.role}）</span>}　{item.appearance}</p>)}</section>}
    {(overview.music || overview.rhythm) && <section><h4><UiText id="canvas.mee73e6593b8a" /></h4>{overview.music && <p><b><UiText id="canvas.mdb9514212493" /></b>　{overview.music}</p>}{overview.rhythm && <p><b><UiText id="canvas.m19f48756db89" /></b>　{overview.rhythm}</p>}</section>}
  </div>;
}

function SegmentsPanel({ id, data, selected }: { id: string; data: CanvasBreakdownData; selected: boolean }) {
  const editor = React.useContext(CanvasNodeEditorContext);
  const readOnly = useCanvasReadOnly();
  const { copied, copy } = useCopy();
  const shots = new Map(data.shots.map(shot => [shot.index, shot]));
  if (!data.segments.length) return <p className="canvas-breakdown-empty">{data.status === "running" ? <UiText id="canvas.m59857cf7b3c0" /> : <UiText id="canvas.m970dd0baa0b8" />}</p>;
  return <div className="canvas-breakdown-segments">
    {data.segments.map(segment => <div key={segment.index} className="canvas-breakdown-segment" data-canvas-breakdown-segment={segment.index}>
      <div className="flex items-center gap-2">
        <b className="text-[13px]"><UiText id="canvas.m908e56fe5ed8" />{segment.index} {segment.title}</b>
        <span className="canvas-breakdown-time">{formatBreakdownTime(segment.start)}–{formatBreakdownTime(segment.end)}</span>
        <span className="text-[11px] text-[var(--app-muted)]">{(segment.end - segment.start).toFixed(1)}s · {segment.shots.length}<UiText id="canvas.mc08b603bdd44" /></span>
        {selected && <div className="canvas-breakdown-row-actions nodrag nopan ml-auto">
          {!readOnly && editor?.breakdownToVideoTask && <UiProps ids={{"title":["canvas.mc3f379763d29"]}}><button type="button" title="canvas.mc3f379763d29" onClick={() => editor.breakdownToVideoTask!(id, segment.index)}><Video className="h-3.5 w-3.5" /><UiText id="canvas.m56e56614fed0" /></button></UiProps>}
          {segment.videoPrompt && <button type="button" onClick={() => copy(`segment-${segment.index}`, segment.videoPrompt)}>{copied === `segment-${segment.index}` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}<UiText id="canvas.m3ed2c259da32" /></button>}
        </div>}
      </div>
      <div className="canvas-breakdown-strip">{segment.shots.map(index => shots.get(index)).filter((shot): shot is BreakdownShot => Boolean(shot)).map(shot => <Thumb key={shot.index} shot={shot} className="canvas-breakdown-strip-thumb" />)}</div>
      {segment.story && <p className="canvas-breakdown-subtext">{segment.story}</p>}
      {segment.videoPrompt
        ? <pre className="canvas-breakdown-prompt">{segment.videoPrompt}</pre>
        : data.status === "running" ? <div className="canvas-breakdown-skeleton"><span /><span /></div> : null}
    </div>)}
  </div>;
}

function Expanded({ id, data, onClose }: { id: string; data: CanvasBreakdownData; onClose: () => void }) {
  const editor = React.useContext(CanvasNodeEditorContext);
  const readOnly = useCanvasReadOnly();
  const [tab, setTab] = React.useState<Tab>("shots");
  const { copied, copy } = useCopy();
  React.useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);
  return createPortal(<UiProps ids={{"aria-label":["canvas.m4af478d71ee4"]}}><div className="canvas-breakdown-modal" role="dialog" aria-label={data.title || "canvas.m4af478d71ee4"} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <header className="canvas-breakdown-modal-header">
      <Clapperboard className="h-4 w-4" />
      <b className="truncate">{data.title || <UiText id="canvas.m4af478d71ee4" />}</b>
      <div className="canvas-breakdown-tabs">{TABS.map(item => <button key={item.id} type="button" data-active={tab === item.id || undefined} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
      <div className="ml-auto flex items-center gap-1.5">
        <button type="button" className="canvas-breakdown-button" onClick={() => copy("markdown", buildBreakdownMarkdown(data))}>{copied === "markdown" ? <Check className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}<UiText id="canvas.mf9c71ee4c435" /></button>
        <button type="button" className="canvas-breakdown-button" onClick={() => download(`${fileBase(data)}.md`, buildBreakdownMarkdown(data), "text/markdown;charset=utf-8")}><Download className="h-3.5 w-3.5" /><UiText id="canvas.m6aa9c09687c9" /></button>
        <button type="button" className="canvas-breakdown-button" onClick={() => download(`${fileBase(data)}.csv`, buildBreakdownCsv(data), "text/csv;charset=utf-8")}><Download className="h-3.5 w-3.5" /><UiText id="canvas.m7a70ccd15bf4" /></button>
        <UiProps ids={{"aria-label":["canvas.m3fd47edce45b"]}}><button type="button" className="canvas-breakdown-icon-button" aria-label="canvas.m3fd47edce45b" onClick={onClose}><X className="h-4 w-4" /></button></UiProps>
      </div>
    </header>
    <div className="canvas-breakdown-modal-body">
      {tab === "shots" && <div className="canvas-breakdown-full-table-wrap">
        <table className="canvas-breakdown-full-table">
          <thead><tr><th className="sticky-col"><UiText id="canvas.m178fd037ae24" /></th>{BREAKDOWN_SHOT_COLUMNS.map(column => <th key={column.key} data-column={column.key}>{column.label}</th>)}<th><UiText id="canvas.med31fbb483ee" /></th></tr></thead>
          <tbody>{data.shots.map(shot => <tr key={shot.index}>
            <td className="sticky-col"><Thumb shot={shot} className="canvas-breakdown-modal-thumb" /></td>
            {BREAKDOWN_SHOT_COLUMNS.map(column => <td key={column.key} data-column={column.key}>{breakdownShotCell(shot, column.key)}</td>)}
            <td><div className="canvas-breakdown-row-actions">
              {!readOnly && editor?.breakdownToImageTask && shot.description && <UiProps ids={{"title":["canvas.me0072d81e26c"]}}><button type="button" title="canvas.me0072d81e26c" onClick={() => { editor.breakdownToImageTask!(id, shot.index); onClose(); }}><ImagePlus className="h-3.5 w-3.5" /><UiText id="canvas.m16021941aaa8" /></button></UiProps>}
              {shot.description && <button type="button" onClick={() => copy(`shot-${shot.index}`, breakdownShotPrompt(shot))}>{copied === `shot-${shot.index}` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}<UiText id="canvas.m3ed2c259da32" /></button>}
            </div></td>
          </tr>)}</tbody>
        </table>
      </div>}
      {tab === "overview" && <div className="mx-auto max-w-5xl"><OverviewPanel data={data} /></div>}
      {tab === "segments" && <div className="mx-auto max-w-5xl" onClickCapture={event => { if ((event.target as HTMLElement).closest("button")?.textContent?.includes("生成视频")) window.setTimeout(onClose, 0); }}><SegmentsPanel id={id} data={data} selected /></div>}
    </div>
  </div></UiProps>, document.body);
}

function ModelPicker({ data, models, disabled, onChange }: { data: CanvasBreakdownData; models: readonly CanvasBreakdownModel[]; disabled: boolean; onChange: (model: CanvasBreakdownModel) => void }) {
  const value = `${data.providerId ?? ""}:${data.model ?? ""}`;
  const known = models.some(model => `${model.providerId}:${model.modelId}` === value);
  return <UiProps ids={{"aria-label":["canvas.m660de62f78a5"]}}><select className="canvas-breakdown-select nodrag nopan" aria-label="canvas.m660de62f78a5" value={value} disabled={disabled}
    onChange={event => { const model = models.find(item => `${item.providerId}:${item.modelId}` === event.target.value); if (model) onChange(model); }}>
    {!known && <option value={value}>{data.model || <UiText id="canvas.m9bb63745df8f" />}</option>}
    {models.map(model => <option key={`${model.providerId}:${model.modelId}`} value={`${model.providerId}:${model.modelId}`}>{model.label}</option>)}
  </select></UiProps>;
}

const STEP_LABELS: Partial<Record<BreakdownStage, string>> = {
  probe: "读取视频", scenes: "检测镜头切点", frames: "提取关键帧", overview: "通看全片", shots: "逐镜拆解", segments: "生成复刻提示词",
};

function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} 分 ${String(seconds % 60).padStart(2, "0")} 秒` : `${seconds} 秒`;
}

function useElapsed(data: CanvasBreakdownData) {
  const running = data.status === "running";
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!data.startedAt) return "";
  return formatElapsed((running ? now : data.finishedAt ?? now) - data.startedAt);
}

/** Detail shown beside each finished or active step, so progress reads as facts, not a spinner. */
function stepDetail(data: CanvasBreakdownData, stage: BreakdownStage, state: string) {
  const described = data.shots.filter(shot => shot.description).length;
  const prompted = data.segments.filter(segment => segment.videoPrompt).length;
  switch (stage) {
    case "probe": return data.video ? `${data.video.duration.toFixed(1)} 秒${data.video.width ? ` · ${data.video.width}×${data.video.height}` : ""}` : "";
    case "scenes": return data.shots.length ? `${data.shots.length} 个镜头` : "";
    case "frames": return state === "done" ? `${data.shots.filter(shot => shot.frameUrl).length} 张` : "";
    case "overview": return data.overview ? "已完成" : state === "active" ? "深度思考中，与逐镜拆解同时进行" : "";
    case "shots": return data.shots.length && state !== "todo" ? `${described}/${data.shots.length}` : "";
    case "segments": return data.segments.length && state !== "todo" ? `${prompted}/${data.segments.length}` : "";
    default: return "";
  }
}

function Steps({ data }: { data: CanvasBreakdownData }) {
  const { label: uiLabel } = useUiLocale();
  const current = PROGRESS_STAGES.indexOf((data.stage ?? "queued") as BreakdownStage);
  return <ol className="canvas-breakdown-checklist">
    {PROGRESS_STAGES.map((stage, index) => {
      let state = data.status === "success" || index < current ? "done" : index === current ? (data.status === "failed" ? "failed" : "active") : "todo";
      // The overview runs beside the shot analysis: it is done only once it has arrived.
      if (stage === "overview" && data.status === "running" && index <= current) state = data.overview ? "done" : "active";
      return <li key={stage} data-state={state}>
        <span className="canvas-breakdown-check">{state === "done" ? <Check className="h-3 w-3" /> : state === "active" ? <Loader2 className="h-3 w-3 animate-spin" /> : state === "failed" ? <X className="h-3 w-3" /> : null}</span>
        <span>{uiLabel(STEP_LABELS[stage] ?? BREAKDOWN_STAGE_LABELS[stage])}</span>
        <span className="ml-auto tabular-nums">{uiLabel(stepDetail(data, stage, state))}</span>
      </li>;
    })}
  </ol>;
}

function StatusPill({ data }: { data: CanvasBreakdownData }) {
  if (data.status === "running") return <span className="canvas-breakdown-pill" data-status="running"><Loader2 className="h-3 w-3 animate-spin" /><UiText id="canvas.ma0bd2116be0c" /></span>;
  if (data.status === "success") return <span className="canvas-breakdown-pill" data-status="success"><Check className="h-3 w-3" /><UiText id="canvas.mf28461bb49c8" /></span>;
  return <span className="canvas-breakdown-pill" data-status="failed"><AlertTriangle className="h-3 w-3" />{data.error === "已取消拉片" ? <UiText id="canvas.mf006455e3baf" /> : <UiText id="canvas.m28384d7afd2e" />}</span>;
}

function Outputs({ data }: { data: CanvasBreakdownData }) {
  const { text } = useUiLocale();
  const editor = React.useContext(CanvasNodeEditorContext);
  const outputs = data.outputs;
  const segments = outputs?.segments ?? [];
  const items = [
    outputs?.overview && { key: "overview", icon: <FileText className="h-3.5 w-3.5" />, label: text("workspaceFollowup.m2f4faae91799"), hint: text("workspaceFollowup.m0dfc62a53a07"), target: outputs.overview },
    outputs?.styles?.length && { key: "styles", icon: <ImagePlus className="h-3.5 w-3.5" />, label: text("workspaceFollowup.m4dd91e7f25c1", { v0: outputs.styles.length }), hint: text("workspaceFollowup.m4e1d5222fd1d"), target: outputs.styles[0] },
    segments.length && { key: "segments", icon: <Film className="h-3.5 w-3.5" />, label: text("workspaceFollowup.ma89b1beb02f6", { v0: segments.length }), hint: text("workspaceFollowup.mad3011153dc9"), target: segments[0].doc ?? segments[0].clip },
    outputs?.soundGroup && { key: "sound", icon: <Music className="h-3.5 w-3.5" />, label: text("workspaceFollowup.m473400815c0f"), hint: [outputs.soundtrack && text("workspaceFollowup.m8bf0f16ddb85"), outputs.background && text("workspaceFollowup.m4847d0fca378")].filter(Boolean).join(" + ") || text("workspaceFollowup.mfd014ccaac30"), target: outputs.soundGroup },
    outputs?.framesGroup && { key: "frames", icon: <LayoutGrid className="h-3.5 w-3.5" />, label: text("workspaceFollowup.md01e296c6253", { v0: data.shots.filter(shot => shot.frameUrl).length }), hint: text("workspaceFollowup.m83d84ed7ce19"), target: outputs.framesGroup },
  ].filter(Boolean) as Array<{ key: string; icon: React.ReactNode; label: string; hint: string; target?: string }>;
  if (!items.length) return null;
  return <div className="canvas-breakdown-outputs">
    <p className="canvas-breakdown-label"><UiText id="canvas.mdc30a6be5882" /></p>
    {items.map(item => <UiProps key={item.key} ids={{"title":["canvas.m85b36396f3ea"]}}><button  type="button" className="canvas-breakdown-output nodrag nopan" disabled={!item.target || !editor?.locateCanvasNode}
      title="canvas.m85b36396f3ea" onClick={() => item.target && editor?.locateCanvasNode(item.target)}>
      <span className="canvas-breakdown-output-icon">{item.icon}</span>
      <span className="min-w-0 flex-1 text-left"><b>{item.label}</b><small>{item.hint}</small></span>
      <LocateFixed className="h-3.5 w-3.5 opacity-60" />
    </button></UiProps>)}
  </div>;
}

export function CanvasBreakdownNode({ id, data, width, height, selected }: {
  id: string; data: CanvasBreakdownData; width?: number; height?: number; selected: boolean;
}) {
  const { label: uiLabel } = useUiLocale();
  const editor = React.useContext(CanvasNodeEditorContext);
  const readOnly = useCanvasReadOnly();
  const [expanded, setExpanded] = React.useState(false);
  const [pendingModel, setPendingModel] = React.useState<CanvasBreakdownModel | null>(null);
  const detail = useStore(state => state.transform[2] >= BREAKDOWN_DETAIL_ZOOM);
  const elapsed = useElapsed(data);
  const models = editor?.breakdownModels ?? [];
  const running = data.status === "running";
  const chosen = pendingModel ?? models.find(model => model.providerId === data.providerId && model.modelId === data.model) ?? models[0];
  const percent = Math.round((data.status === "success" ? 1 : data.progress ?? 0) * 100);
  const modelLabel = models.find(model => model.providerId === data.providerId && model.modelId === data.model)?.label ?? data.model;
  const stills = data.shots.filter(shot => shot.frameUrl);
  const frameWidth = width ?? 520;
  const frameHeight = height ?? 480;
  const headline = running ? `拉片中 ${percent}%` : data.status === "success" ? "拉片完成" : data.error === "已取消拉片" ? "已停止" : "拉片失败";

  return <div className="relative" style={{ width: frameWidth, height: frameHeight }} data-canvas-breakdown={id} data-status={data.status}>
    <CanvasNodeHeading className="canvas-material-metadata">
      <Clapperboard className="canvas-material-metadata-icon" />
      <CanvasEditableNodeName name={data.title || "拉片"} onRename={value => editor?.updateData(id, current => renameCanvasNodeData(current, value), "push")} />
    </CanvasNodeHeading>
    <Handle type="target" position={Position.Left} className="!opacity-0" isConnectableStart={false} />
    <Handle type="source" id={CANVAS_RIGHT_OUTPUT_HANDLE_ID} position={Position.Right} className="!opacity-0" isConnectableEnd={false} />
    <div className={`canvas-material-frame canvas-breakdown-card h-full w-full ${selected ? "canvas-material-frame-selected" : ""}`} data-status={data.status}
      onDoubleClick={event => {
        // Double-click opens the full view, like previewing any other node.
        if ((event.target as HTMLElement).closest("button, select, a, input") || !isDeliberateDoubleClick(event)) return;
        event.stopPropagation();
        setExpanded(true);
      }}>
      {!detail ? <div className="canvas-breakdown-glance" data-canvas-breakdown-glance>
        <span className="canvas-breakdown-glance-icon">{running ? <Loader2 className="animate-spin" /> : data.status === "success" ? <Check /> : <AlertTriangle />}</span>
        <b>{uiLabel(headline)}</b>
        <small>{running ? (data.message || <UiText id="canvas.mb53be09930f4" />) : data.status === "success" ? <UiText id="canvas.mf8c4c759f41f" values={{v0: String(data.shots.length), v1: String(data.segments.length)}} /> : <UiText id="canvas.md57f3848bace" />}</small>
        {running && <div className="canvas-breakdown-bar"><span style={{ width: `${Math.max(3, percent)}%` }} /></div>}
      </div> : <>
        <header className="canvas-breakdown-head">
          <span className="canvas-breakdown-head-icon"><Clapperboard className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <b className="block truncate">{data.sourceName || <UiText id="canvas.mc20f7618d330" />}</b>
            <small className="block truncate">{[modelLabel, elapsed && `用时 ${uiLabel(elapsed)}`].filter(Boolean).join(" · ")}</small>
          </div>
          <StatusPill data={data} />
        </header>
        <div className={`canvas-breakdown-content ${selected ? "nowheel" : ""}`}>
          {running && <section className="canvas-breakdown-live" data-canvas-breakdown-progress>
            <div className="flex items-end gap-3">
              <span className="canvas-breakdown-percent">{percent}<small>%</small></span>
              <span className="min-w-0 flex-1 pb-1 text-[12px] text-[var(--app-muted)]"><span className="block truncate">{data.message ? uiLabel(data.message) : <UiText id="canvas.mb53be09930f4" />}</span></span>
            </div>
            <div className="canvas-breakdown-bar"><span style={{ width: `${Math.max(3, percent)}%` }} /></div>
          </section>}
          {data.status === "failed" && <div className="canvas-breakdown-error" role="alert"><AlertTriangle className="h-4 w-4 shrink-0" /><span>{data.error || <UiText id="canvas.me3c62cfbc406" />}</span></div>}
          {data.status === "success" && <div className="canvas-breakdown-stats">
            {[["时长", data.video ? `${data.video.duration.toFixed(1)}s` : "—"], ["镜头", `${data.shots.length}`], ["片段", `${data.segments.length}`], ["用时", elapsed || "—"]].map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}
          </div>}
          {data.status === "success" ? <Outputs data={data} /> : <Steps data={data} />}
          {stills.length > 0 && <UiProps ids={{"aria-label":["canvas.m178fd037ae24"]}}><div className="canvas-breakdown-filmstrip" aria-label="canvas.m178fd037ae24">
            {stills.slice(0, stills.length > 8 ? 7 : 8).map(shot => <Thumb key={shot.index} shot={shot} />)}
            {stills.length > 8 && <span className="canvas-breakdown-more">+{stills.length - 7}</span>}
          </div></UiProps>}
          {!running && data.warnings?.length ? <div className="canvas-breakdown-warning">{data.warnings.at(-1)}</div> : null}
        </div>
        <footer className="canvas-breakdown-foot nodrag nopan">
          {data.shots.length > 0 && <UiProps ids={{"aria-label":["canvas.m11423aad226b"]}}><button type="button" className="canvas-breakdown-button" data-variant={data.status === "success" ? "primary" : undefined} aria-label="canvas.m11423aad226b" onClick={() => setExpanded(true)}><Maximize2 className="h-3.5 w-3.5" /><UiText id="canvas.m206c8aaf38a4" /></button></UiProps>}
          {!readOnly && data.shots.some(shot => shot.frameUrl) && editor?.expandBreakdownFrames && !running && <UiProps ids={{"aria-label":["canvas.m762413b24258"]}}><button type="button" className="canvas-breakdown-icon-button canvas-breakdown-tip" aria-label="canvas.m762413b24258" data-tip={data.outputs?.framesGroup ? "定位到全部关键帧" : "把全部关键帧按宫格铺到画布"} onClick={() => editor.expandBreakdownFrames!(id)}><LayoutGrid className="h-3.5 w-3.5" /></button></UiProps>}
          <div className="ml-auto flex items-center gap-1.5">
            {!readOnly && models.length > 0 && !running && <ModelPicker data={pendingModel ? { ...data, providerId: pendingModel.providerId, model: pendingModel.modelId } : data} models={models} disabled={running} onChange={setPendingModel} />}
            {!readOnly && (running
              ? editor?.cancelBreakdown && <button type="button" className="canvas-breakdown-button" onClick={() => editor.cancelBreakdown!(id)}><Square className="h-3 w-3" /><UiText id="canvas.mca4d973c0b00" /></button>
              : editor?.rerunBreakdown && chosen && <UiProps ids={{"title":["canvas.m932085b13065"]}}><button type="button" className="canvas-breakdown-button" data-variant={data.status === "failed" ? "primary" : undefined} title="canvas.m932085b13065" onClick={() => { editor.rerunBreakdown!(id, chosen); setPendingModel(null); }}><RotateCcw className="h-3.5 w-3.5" /><UiText id="canvas.m5f3079c9d75f" /></button></UiProps>)}
          </div>
        </footer>
      </>}
    </div>
    {expanded && <Expanded id={id} data={data} onClose={() => setExpanded(false)} />}
  </div>;
}
