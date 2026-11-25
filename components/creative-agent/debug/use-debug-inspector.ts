"use client";
import * as React from "react";
import type { CreativeAgentRun } from "@/lib/creative-agent/contracts";
import type { DebugBatch, DebugEvent, DebugIndex } from "@/lib/creative-agent/debug-contracts";
import { DebugAccessError, debugGet, streamDebugEvents } from "./debug-client";

export function useDebugInspector(canvasId: number, activeSessionId: string | null, visible: boolean) {
  const [index, setIndex] = React.useState<DebugIndex>({ sessions: [], runs: [], hasMore: false });
  const [session, setSession] = React.useState("");
  const [pinnedRun, setPinnedRun] = React.useState("");
  const [events, setEvents] = React.useState<DebugEvent[]>([]);
  const [run, setRun] = React.useState<CreativeAgentRun | null>(null);
  const [error, setError] = React.useState("");
  const [connected, setConnected] = React.useState(false);
  const [forbidden, setForbidden] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [older, setOlder] = React.useState<CreativeAgentRun[]>([]);
  const sessionId = session || activeSessionId || "";
  const selected = pinnedRun || index.runs[0]?.id || "";
  const records = React.useRef(new Map<string, DebugEvent>());
  const cursor = React.useRef({ runId: "", after: 0, publicAfter: 0 });

  React.useEffect(() => { setPinnedRun(""); setOlder([]); }, [sessionId]);
  React.useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const result = await debugGet<DebugIndex>(`/api/creative-agent/canvases/${canvasId}/debug${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`, abort.signal);
        if (abort.signal.aborted) return;
        setIndex(result); setForbidden(false); setError("");
      } catch (reason) {
        if (abort.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "无法读取调试记录");
        if (reason instanceof DebugAccessError) { setForbidden(true); setEvents([]); setRun(null); return; }
      } finally { if (!abort.signal.aborted) setLoading(false); }
      if (!abort.signal.aborted) timer = setTimeout(refresh, visible ? 3000 : 8000);
    };
    void refresh();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [canvasId, sessionId, visible]);

  React.useEffect(() => {
    if (forbidden || !selected) { setRun(null); return; }
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    if (cursor.current.runId !== selected) {
      cursor.current = { runId: selected, after: 0, publicAfter: 0 };
      records.current.clear(); setEvents([]);
    }
    setRun([...index.runs, ...older].find(item => item.id === selected) || null);
    const receive = (batch: DebugBatch) => {
      if (abort.signal.aborted) return;
      for (const event of batch.events) records.current.set(event.id, event);
      cursor.current.after = batch.nextSequence; cursor.current.publicAfter = batch.nextPublicSequence;
      if (batch.events.length) setEvents([...records.current.values()]);
      setRun(batch.run); setConnected(true); setError("");
    };
    const connect = async () => {
      try {
        if (visible) {
          const complete = await streamDebugEvents(selected, cursor.current, abort.signal, receive);
          if (complete) return;
        } else {
          const batch = await debugGet<DebugBatch>(`/api/creative-agent/runs/${selected}/debug?after=${cursor.current.after}&publicAfter=${cursor.current.publicAfter}`, abort.signal);
          receive(batch);
          if (batch.hasMore) { timer = setTimeout(connect, 0); return; }
        }
      } catch (reason) {
        if (abort.signal.aborted) return;
        setConnected(false); setError(reason instanceof Error ? reason.message : "实时连接中断，正在重连");
        if (reason instanceof DebugAccessError) { setForbidden(true); records.current.clear(); setEvents([]); setRun(null); return; }
      }
      if (!abort.signal.aborted) timer = setTimeout(connect, visible ? 1000 : 8000);
    };
    void connect();
    return () => { abort.abort(); clearTimeout(timer); setConnected(false); };
    // Index refresh must not tear down a live stream for the same run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, visible, forbidden]);

  async function loadOlder() {
    const last = older.at(-1) || index.runs.at(-1);
    if (!last) return;
    try {
      const next = await debugGet<DebugIndex>(`/api/creative-agent/canvases/${canvasId}/debug?before=${encodeURIComponent(last.id)}${sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : ""}`);
      setOlder(current => [...current, ...next.runs.filter(item => !current.some(existing => existing.id === item.id))]);
      setIndex(current => ({ ...current, hasMore: next.hasMore }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "读取历史失败"); }
  }
  return { index, runs: [...index.runs, ...older], session, setSession, pinnedRun, setPinnedRun, selected, run, events, error, connected, forbidden, loading, loadOlder };
}
