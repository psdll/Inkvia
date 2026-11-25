"use client";
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";

import * as React from "react";
import { Activity, ArrowDown, Bug, Download, Minimize2, Search, X } from "lucide-react";
import { debugRunLabels, DEBUG_DETAIL_DAYS, DEBUG_EVENT_DAYS, type DebugBatch, type DebugCategory } from "@/lib/creative-agent/debug-contracts";
import { DebugAccessError, debugGet, groupDebugEvents, loadDebugDetails } from "./debug-client";
import { useDebugInspector } from "./use-debug-inspector";
import DebugDetails from "./DebugDetails";
import styles from "./debug-inspector.module.css";

type Frame = { x: number; y: number; width: number; height: number };
const initialFrame: Frame = { x: 12, y: 60, width: 560, height: 620 };
export type DebugIndicator = "running" | "waiting" | "error" | "idle";
export default function AgentDebugInspector({ canvasId, userId, activeSessionId, visible, onClose, onLocateNode, onStatus }: {
  canvasId: number; userId: number; activeSessionId: string | null; visible: boolean;
  onClose: () => void; onLocateNode: (id: string) => void; onStatus: (status: DebugIndicator) => void;
}) {
  const { locale: uiLocale, error: uiError, label: uiLabel } = useUiLocale();
  const data = useDebugInspector(canvasId, activeSessionId, visible);
  const [frame, setFrame] = React.useState(initialFrame);
  const [bounds, setBounds] = React.useState({ width: 1200, height: 800 });
  const [category, setCategory] = React.useState<DebugCategory | "all">("all");
  const [search, setSearch] = React.useState("");
  const [selectedSpan, setSelectedSpan] = React.useState("");
  const [follow, setFollow] = React.useState(true);
  const [scroll, setScroll] = React.useState(0);
  const [listHeight, setListHeight] = React.useState(300);
  const [exporting, setExporting] = React.useState(false);
  const [localError, setLocalError] = React.useState("");
  const host = React.useRef<HTMLDivElement>(null), list = React.useRef<HTMLDivElement>(null);
  const interaction = React.useRef<{ mode: "move" | "resize"; x: number; y: number; frame: Frame } | null>(null);
  const exportAbort = React.useRef<AbortController>();
  const preferenceKey = `creative-debug:frame:v1:${userId}:${canvasId}`;
  React.useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(preferenceKey) || "null"); if (saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) setFrame(saved); } catch { /* Preference is optional. */ }
    return () => exportAbort.current?.abort();
  }, [preferenceKey]);
  React.useEffect(() => {
    const parent = host.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(([entry]) => setBounds({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (!list.current || !visible) return;
    const observer = new ResizeObserver(([entry]) => setListHeight(entry.contentRect.height));
    observer.observe(list.current);
    return () => observer.disconnect();
  }, [visible, selectedSpan]);
  React.useEffect(() => {
    onStatus(data.run?.status === "failed" ? "error" : data.run?.status.startsWith("waiting") || data.run?.status === "paused" ? "waiting" : ["running", "queued", "stopping"].includes(data.run?.status || "") ? "running" : "idle");
  }, [data.run?.status, onStatus]);
  React.useEffect(() => { setSelectedSpan(""); setLocalError(""); setFollow(true); }, [data.selected]);
  const steps = React.useMemo(() => groupDebugEvents(data.events), [data.events]);
  const filtered = React.useMemo(() => steps.filter(step => (category === "all" || step.category === category || category === "model" && step.category === "http") && (!search || `${step.title} ${step.spanId} ${JSON.stringify(step.summary)}`.toLowerCase().includes(search.toLowerCase()))), [steps, category, search]);
  const selected = steps.find(step => step.spanId === selectedSpan);
  const modelSteps = steps.filter(step => step.category === "model");
  const modelIndex = modelSteps.findIndex(step => step.spanId === selectedSpan);
  const previousModel = modelIndex > 0 ? modelSteps[modelIndex - 1] : undefined;
  const sent = data.events.filter(event => event.type === "model.dispatched").length;
  const tools = steps.filter(step => step.category === "tool").length;
  const pending = steps.filter(step => step.category === "media" && ["running", "waiting", "unknown"].includes(step.status)).length;
  React.useEffect(() => {
    if (visible && follow && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [visible, follow, filtered.length, data.events.length]);
  const clampFrame = (value: Frame): Frame => {
    const width = Math.max(Math.min(340, bounds.width - 16), Math.min(value.width, bounds.width - 16));
    const height = Math.max(Math.min(300, bounds.height - 16), Math.min(value.height, bounds.height - 16));
    return { width, height, x: Math.max(8, Math.min(value.x, bounds.width - width - 8)), y: Math.max(8, Math.min(value.y, bounds.height - height - 8)) };
  };
  const actual = clampFrame(frame);
  const start = (event: React.PointerEvent, mode: "move" | "resize") => {
    if (event.button !== 0 || mode === "move" && (event.target as Element).closest("button")) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    interaction.current = { mode, x: event.clientX, y: event.clientY, frame: actual };
  };
  const finish = () => {
    if (!interaction.current) return;
    interaction.current = null;
    try { localStorage.setItem(preferenceKey, JSON.stringify(clampFrame(frame))); } catch { /* Preference is optional. */ }
  };
  const revoked = React.useCallback(() => { setSelectedSpan(""); setLocalError("调试权限已失效，请重新登录管理员"); }, []);
  const exportRun = async () => {
    if (!data.run || exporting) return;
    const run = data.run;
    const abort = new AbortController(); exportAbort.current?.abort(); exportAbort.current = abort;
    setExporting(true); setLocalError("");
    try {
      const details = await loadDebugDetails(run.id, undefined, abort.signal);
      let after = 0, publicAfter = 0, hasMore = true;
      const events: DebugBatch["events"] = [];
      while (hasMore) {
        const batch = await debugGet<DebugBatch>(`/api/creative-agent/runs/${run.id}/debug?after=${after}&publicAfter=${publicAfter}`, abort.signal);
        events.push(...batch.events); after = batch.nextSequence; publicAfter = batch.nextPublicSequence; hasMore = batch.hasMore;
      }
      const content = JSON.stringify({ format: "creative-agent-debug-v1", exportedAt: new Date().toISOString(), note: "脱敏记录；运行中导出是读取期间的快照，不会重新调用模型。二进制和超限内容有显式标记。", run, events, details }, null, 2);
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `agent-debug-${run.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { if (!abort.signal.aborted) { setLocalError(reason instanceof Error ? reason.message : "导出失败"); if (reason instanceof DebugAccessError) revoked(); } }
    finally { setExporting(false); }
  };
  const first = Math.max(0, Math.floor(scroll / 64) - 3);
  const rows = filtered.slice(first, first + Math.ceil(listHeight / 64) + 7);
  const noTrace = !data.events.some(event => !event.id.startsWith("public:"));
  return <UiProps ids={{"aria-label":["common.m66dfcc10b54d"]}}><div ref={host} role="dialog" aria-label="common.m66dfcc10b54d" aria-modal="false" tabIndex={-1} data-agent-debug-inspector className={`${styles.window} nowheel nopan nodrag`} style={{ left: actual.x, top: actual.y, width: actual.width, height: actual.height, display: visible ? undefined : "none" }}
    onPointerDown={event => { event.stopPropagation(); if (!(event.target as Element).closest("button,input,select,textarea,a,summary")) host.current?.focus({ preventScroll: true }); }} onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape" && !event.nativeEvent.isComposing) onClose(); }}
    onPointerMove={event => { const drag = interaction.current; if (!drag) return; const dx = event.clientX - drag.x, dy = event.clientY - drag.y; setFrame(clampFrame(drag.mode === "move" ? { ...drag.frame, x: drag.frame.x + dx, y: drag.frame.y + dy } : { ...drag.frame, width: drag.frame.width + dx, height: drag.frame.height + dy })); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
    <header className={styles.header} onPointerDown={event => start(event, "move")}><Bug size={15} /><strong><UiText id="common.mc265ad63e4af" /></strong><span className={styles.spacer} /><span className={styles.muted}>{data.connected ? <UiText id="common.ma1b56411cc63" /> : <UiText id="common.ma898478be181" />}</span><UiProps ids={{"aria-label":["common.m8570ecc86797"],"title":["common.m3e8f462be151"]}}><button aria-label="common.m8570ecc86797" title="common.m3e8f462be151" onClick={onClose}><Minimize2 size={15} /></button></UiProps></header>
    <div className={styles.selectors}>
      <UiProps ids={{"aria-label":["common.mf63c08f37aa9"]}}><select aria-label="common.mf63c08f37aa9" value={data.session} onChange={event => data.setSession(event.target.value)}><option value="">跟随当前对话</option>{data.index.sessions.map(session => <option key={session.id} value={session.id}>{session.title}</option>)}</select></UiProps>
      <UiProps ids={{"aria-label":["common.mf3d9345009d5"]}}><select aria-label="common.mf3d9345009d5" value={data.pinnedRun} onChange={event => data.setPinnedRun(event.target.value)}><option value="">最新运行</option>{data.runs.map(run => <option key={run.id} value={run.id}>{new Date(run.createdAt).toLocaleString(uiLocale === "en" ? "en-US" : undefined)} · {debugRunLabels[run.status]}</option>)}</select></UiProps>
      {data.index.hasMore && <UiProps ids={{"title":["common.m8995e6098829"]}}><button title="common.m8995e6098829" onClick={() => void data.loadOlder()}><UiText id="common.mc56a5bb657de" /></button></UiProps>}
    </div>
    <div className={styles.summary}><span><Activity size={12} style={{ display: "inline", marginRight: 5 }} />{data.run ? debugRunLabels[data.run.status] : <UiText id="common.md081ab9ebf63" />}</span><small>{noTrace ? <UiText id="common.mc1de2931e267" /> : <><UiText id="common.m9da70e67c2a5" />{sent}<UiText id="common.m8bec6577baa1" />{tools}<UiText id="common.mc3860cbfb6d0" />{pending}</>}</small></div>
    <UiProps ids={{"aria-label":["common.m80bd90e9696f"]}}><nav className={styles.filters} aria-label="common.m80bd90e9696f">{([ ["all", "时间线"], ["model", "模型 / API"], ["tool", "工具"], ["media", "生成任务"], ["canvas", "画布"], ["usage", "用量"] ] as const).map(([value, label]) => <button key={value} className={category === value ? styles.active : ""} onClick={() => { setCategory(value); setScroll(0); if (list.current) list.current.scrollTop = 0; }}>{label}</button>)}</nav></UiProps>
    <div className={styles.search}><Search size={13} /><UiProps ids={{"aria-label":["common.mf981483d5615"],"placeholder":["common.mc21056801ef3"]}}><input aria-label="common.mf981483d5615" placeholder="common.mc21056801ef3" value={search} onChange={event => { setSearch(event.target.value); setScroll(0); if (list.current) list.current.scrollTop = 0; }} /></UiProps><small className={styles.muted}>{filtered.length}<UiText id="common.me010e3f578cc" /></small></div>
    {(data.error || localError) && <p className={styles.warning}>{localError || uiError(data.error)}</p>}
    {data.events.some(event => event.summary.recordingGap) && <p className={styles.warning}><UiText id="common.m267e474acd79" /></p>}
    <UiProps ids={{"aria-label":["common.m97017fc050c3"]}}><div ref={list} className={styles.list} role="listbox" aria-label="common.m97017fc050c3" onWheel={event => { if (event.deltaY < 0) setFollow(false); }} onScroll={event => setScroll(event.currentTarget.scrollTop)}>
      {!data.forbidden && filtered.length > 0 ? <div style={{ height: filtered.length * 64, position: "relative" }}>{rows.map((step, index) => <button key={step.spanId} role="option" aria-selected={selectedSpan === step.spanId} className={styles.row} style={{ top: (first + index) * 64, paddingLeft: step.parentSpanId && !step.parentSpanId.startsWith("run:") ? 25 : 12 }} onClick={() => { setSelectedSpan(step.spanId); setFollow(false); }}>
        <span className={styles.dot} data-status={step.status} /><span className={styles.rowContent}><span className={styles.rowTitle}>{step.parentSpanId && !step.parentSpanId.startsWith("run:") ? "↳ " : ""}{uiLabel(step.title)}</span><span className={styles.rowSub}>{uiLabel(step.events.at(-1)?.title)} · {step.summary.elapsedMs != null ? `${step.summary.elapsedMs} ms` : step.status === "reused" ? <UiText id="common.m1726de98ca6c" /> : step.spanId.slice(0, 20)}</span></span><time className={styles.rowTime}>{new Date(step.firstAt).toLocaleTimeString(uiLocale === "en" ? "en-US" : undefined)}</time>
      </button>)}</div> : <div className={styles.empty}>{data.loading ? <UiText id="common.m90b27efe6949" /> : data.forbidden ? <UiText id="common.m76acb712884b" /> : data.run ? <UiText id="common.mfd47d676861d" /> : <UiText id="common.m88f06e46292b" />}</div>}
    </div></UiProps>
    {visible && selected && !data.forbidden && <><div style={{ textAlign: "right", height: 0, zIndex: 1 }}><UiProps ids={{"title":["common.mfbdf7b6d3373"]}}><button title="common.mfbdf7b6d3373" onClick={() => setSelectedSpan("")} style={{ transform: "translateY(-100%)" }}><X size={12} /></button></UiProps></div><DebugDetails key={`${data.selected}:${selected.spanId}`} runId={data.selected} step={selected} previousModel={previousModel} onLocateNode={onLocateNode} onForbidden={revoked} /></>}
    {noTrace && data.run && <p className={styles.note}><UiText id="common.m54cdf15d888d" /></p>}
    <footer className={styles.footer}><button onClick={() => { setFollow(current => !current); }}><ArrowDown size={12} />{follow ? <UiText id="common.m2050c05dd177" /> : <UiText id="common.m1c59875d3a15" />}</button><span className={styles.spacer} /><small><UiText id="common.m36783edf6210" />{DEBUG_DETAIL_DAYS}<UiText id="common.m710e81b77dc2" />{DEBUG_EVENT_DAYS}<UiText id="common.m4ce3054e7c4d" /></small><button disabled={!data.run || exporting || data.forbidden} onClick={() => void exportRun()}><Download size={12} />{exporting ? <UiText id="common.mc8921f15167f" /> : <UiText id="common.m76420433f22d" />}</button></footer>
    <UiProps ids={{"aria-label":["common.md189df3c1d77"]}}><button className={styles.resize} aria-label="common.md189df3c1d77" onPointerDown={event => start(event, "resize")} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); const next = clampFrame({ ...actual, width: actual.width + (event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0), height: actual.height + (event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0) }); setFrame(next); try { localStorage.setItem(preferenceKey, JSON.stringify(next)); } catch {} } }} /></UiProps>
  </div></UiProps>;
}
