"use client";

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";

import * as React from "react";
import { Copy, Check, LocateFixed } from "lucide-react";
import type { DebugDetail } from "@/lib/creative-agent/debug-contracts";
import { DebugAccessError, loadDebugDetails, type DebugStep } from "./debug-client";
import styles from "./debug-inspector.module.css";

function Value({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [open, setOpen] = React.useState(depth < 1);
  if (value == null) return <span className={styles.muted}><UiText id="common.m756762e293f2" /></span>;
  if (typeof value !== "object") {
    const text = String(value);
    if (text.startsWith("/uploads/") && /\.(png|jpe?g|webp)(\?|$)/i.test(text)) return <a href={text} target="_blank" rel="noreferrer"><UiProps ids={{"alt":["common.m97e7e4a2376d"]}}><img className={styles.preview} src={text} alt="common.m97e7e4a2376d" loading="lazy" /></UiProps></a>;
    return <pre className={styles.text}>{text}</pre>;
  }
  const object = value as Record<string, unknown>;
  if (object.__traceBinary) return <div className={styles.note}><UiText id="common.mca62732edf65" />{String(object.mimeType || "媒体")} · {String(object.bytes || 0)} bytes{Boolean(object.sha256) && <code title={String(object.sha256)}> SHA-256 {String(object.sha256).slice(0, 16)}…</code>}</div>;
  if (object.__traceOmitted) return <div className={styles.warning}><UiText id="common.m7bf13bdd0b57" />{String(object.reason)}</div>;
  const entries = Object.entries(object);
  return <details className={styles.value} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{Array.isArray(value) ? <UiText id="common.m245e49b68907" values={{v0: String(entries.length)}} /> : <UiText id="common.m1c1cba406717" values={{v0: String(entries.length)}} />}</summary>
    {open && entries.map(([key, item]) => <div className={styles.field} key={key}><strong>{key}</strong><Value value={item} depth={depth + 1} /></div>)}
  </details>;
}

export function compareDebugRequests(previous: Record<string, any>, current: Record<string, any>) {
  const before = Array.isArray(previous.messages) ? previous.messages : [];
  const after = Array.isArray(current.messages) ? current.messages : [];
  const old = new Set(before.map((message: unknown) => JSON.stringify(message))), next = new Set(after.map((message: unknown) => JSON.stringify(message)));
  return {
    新带入的消息: after.filter((message: unknown) => !old.has(JSON.stringify(message))),
    未再带入的消息: before.filter((message: unknown) => !next.has(JSON.stringify(message))),
    变化的请求参数: [...new Set([...Object.keys(previous), ...Object.keys(current)])].filter(key => key !== "messages" && JSON.stringify(previous[key]) !== JSON.stringify(current[key])).map(key => ({ 参数: key, 上次: previous[key], 本次: current[key] })),
  };
}

function responsePreview(items: DebugDetail[]) {
  let text = "", reasoning = "";
  const calls = new Map<number, { name: string; arguments: string }>();
  for (const item of items) {
    const detail = item.detail as any;
    for (const packet of detail?.packets || []) {
      const choice = packet?.choices?.[0];
      const delta = choice?.delta || choice?.message;
      if (typeof delta?.content === "string") text += delta.content;
      if (typeof (delta?.reasoning_content ?? delta?.reasoning) === "string") reasoning += delta.reasoning_content ?? delta.reasoning;
      for (const [index, call] of (delta?.tool_calls || []).entries()) {
        const key = call.index ?? index;
        const prior = calls.get(key) || { name: "", arguments: "" };
        calls.set(key, { name: prior.name + (call.function?.name || ""), arguments: prior.arguments + (call.function?.arguments || "") });
      }
    }
  }
  const completed = items.find(item => item.type === "model.completed")?.detail as any;
  return { 文本: completed?.response?.text ?? text, 模型返回的推理内容: completed?.response?.thinking || reasoning || "供应商未提供", 工具调用: completed?.response?.calls ?? [...calls.values()] };
}

export default function DebugDetails({ runId, step, previousModel, onLocateNode, onForbidden }: { runId: string; step: DebugStep; previousModel?: DebugStep; onLocateNode: (id: string) => void; onForbidden: () => void }) {
  const { label: uiLabel, error: uiError, locale: uiLocale } = useUiLocale();
  const [items, setItems] = React.useState<DebugDetail[]>([]);
  const [error, setError] = React.useState("");
  const [tab, setTab] = React.useState("readable");
  const [copied, setCopied] = React.useState(false);
  const [comparison, setComparison] = React.useState<unknown>(null);
  const version = step.eventCount;
  const latestVersion = React.useRef(version);
  latestVersion.current = version;
  React.useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>, loadedVersion = -1;
    const refresh = async () => {
      const requestedVersion = latestVersion.current;
      if (loadedVersion !== requestedVersion) {
        try {
          const value = await loadDebugDetails(runId, step.spanId, abort.signal);
          if (abort.signal.aborted) return;
          setItems(value); setError(""); loadedVersion = requestedVersion;
        } catch (reason) {
          if (abort.signal.aborted) return;
          setError(reason instanceof Error ? reason.message : "详情读取失败");
          if (reason instanceof DebugAccessError) { setItems([]); onForbidden(); return; }
        }
      }
      if (!abort.signal.aborted) timer = setTimeout(refresh, 350);
    };
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [runId, step.spanId, onForbidden]);
  React.useEffect(() => {
    if (tab !== "diff" || !previousModel) return;
    const abort = new AbortController();
    void loadDebugDetails(runId, previousModel.spanId, abort.signal).then(before => {
      const previous = (before.find(item => item.type === "model.prepared")?.detail as any)?.body;
      const current = (items.find(item => item.type === "model.prepared")?.detail as any)?.body;
      if (!abort.signal.aborted) setComparison(previous && current ? compareDebugRequests(previous, current) : { 提示: "请求正文未采集或已过保留期，无法比较" });
    }).catch(reason => { if (!abort.signal.aborted) { setError(reason.message); if (reason instanceof DebugAccessError) onForbidden(); } });
    return () => abort.abort();
  }, [tab, previousModel?.spanId, runId, items, onForbidden]);

  const request = (items.find(item => item.type === "model.prepared")?.detail as any)?.body;
  const nodeIds = Array.isArray(step.summary.nodeIds) ? step.summary.nodeIds.filter((id): id is string => typeof id === "string") : [];
  const raw = JSON.stringify(items.length ? items : step.events, null, 2);
  return <UiProps ids={{"aria-label":["common.ma7f80876a413"]}}><section className={styles.details} aria-label="common.ma7f80876a413">
    <div className={styles.detailHeading}><strong>{uiLabel(step.title)}</strong><UiProps ids={{"title":["common.m339b8ee738a6"]}}><button title="common.m339b8ee738a6" onClick={() => { void navigator.clipboard.writeText(raw).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => setError("复制失败，请使用导出")); }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button></UiProps></div>
    <nav className={styles.detailTabs}>
      {[ ["readable", "易读"], ["json", "原始数据"], ...(step.category === "model" ? [["request", "发送内容"], ["response", "模型返回"], ["tools", "工具定义"], ...(previousModel ? [["diff", "对比上次请求"]] : [])] : []) ].map(([value, label]) => <button key={value} className={tab === value ? styles.active : ""} onClick={() => setTab(value)}>{label}</button>)}
    </nav>
    <div className={styles.detailBody}>
      {error && <p className={styles.warning}>{uiError(error)}</p>}
      {nodeIds.length > 0 && <div className={styles.nodeLinks}>{nodeIds.map(id => <button key={id} onClick={() => onLocateNode(id)}><LocateFixed size={12} /><UiText id="common.mbed4e74d2634" />{id.slice(0, 8)}</button>)}</div>}
      <div className={styles.meta}><UiText id="common.m2a45ec27e574" />{step.spanId} {step.parentSpanId && <><UiText id="common.mee6de43158c3" />{step.parentSpanId}</>}</div>
      {tab === "json" ? <pre className={styles.json}>{raw}</pre> : tab === "request" ? <Value value={request ?? "请求正文未记录或已过保留期"} /> : tab === "tools" ? <Value value={request?.tools ?? "未提供工具定义"} /> : tab === "response" ? <Value value={responsePreview(items)} /> : tab === "diff" ? <Value value={comparison ?? "正在比较…"} /> : <>
        <Value value={step.summary} />
        {items.length ? items.filter(item => item.detail != null && item.type !== "model.response.delta").map(item => <div className={styles.record} key={item.id}><h4>{item.title} <small>{new Date(item.createdAt).toLocaleTimeString(uiLocale === "en" ? "en-US" : undefined)}</small></h4><Value value={item.detail} /></div>) : <p className={styles.muted}>{step.hasDetail ? <UiText id="common.m6f160ba76bd9" /> : <UiText id="common.m7f7b2cf88f27" />}</p>}
        {items.some(item => item.hasDetail === false) && <p className={styles.note}><UiText id="common.mebc3ce7d77fd" /></p>}
      </>}
    </div>
  </section></UiProps>;
}
