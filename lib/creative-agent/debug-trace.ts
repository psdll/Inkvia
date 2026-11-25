import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { sanitizeDebugValue } from "./debug-sanitize";
import type { DebugCategory, DebugStatus } from "./debug-contracts";

export type TraceScope = { runId: string; actorUserId: number; canvasId: number; epoch: number };
export type TraceRecord = {
  spanId: string; parentSpanId?: string | null; category: DebugCategory; type: string; title: string;
  status?: DebugStatus; summary?: Record<string, unknown>; detail?: unknown; eventKey?: string;
};
export type TraceWrite = TraceScope & TraceRecord & { createdAt: Date };
type TraceState = { queue: Promise<void>; pending: number; dropped: number; secrets: Set<string>; lastModelSpan?: string };
type TraceContext = { scope: TraceScope; spanId: string; state: TraceState; write: (record: TraceWrite) => Promise<unknown> };
const globalTrace = globalThis as typeof globalThis & { creativeTraceContext?: AsyncLocalStorage<TraceContext> };
const storage = globalTrace.creativeTraceContext ??= new AsyncLocalStorage<TraceContext>();

export const currentCreativeTrace = () => storage.getStore();
export const newDebugSpan = (kind: string) => `${kind}:${randomUUID()}`;
export function rememberDebugSecrets(values: string[]) { const context = storage.getStore(); for (const value of values) if (value.length >= 4) context?.state.secrets.add(value); }
export function setDebugModelSpan(spanId: string) { const context = storage.getStore(); if (context) context.state.lastModelSpan = spanId; }
export const lastDebugModelSpan = () => storage.getStore()?.state.lastModelSpan;

export function recordCreativeDebug(record: TraceRecord): void {
  const context = storage.getStore();
  if (!context) return;
  const { state } = context;
  try {
    if (state.pending >= 256) { state.dropped++; return; }
    const secrets = [...state.secrets];
    const sanitized = sanitizeDebugValue({ ...record, detail: undefined, parentSpanId: record.parentSpanId ?? (record.spanId === context.spanId ? null : context.spanId), summary: { ...record.summary, ...(state.dropped ? { recordingGap: state.dropped } : {}) }, status: record.status ?? "info" }, secrets) as TraceRecord;
    if (record.detail !== undefined) sanitized.detail = sanitizeDebugValue(record.detail, secrets);
    state.pending++;
    const write = { ...context.scope, ...sanitized, createdAt: new Date() };
    state.queue = state.queue.then(async () => {
      const gap = state.dropped; state.dropped = 0;
      try { await context.write({ ...write, summary: { ...write.summary, ...(gap ? { recordingGap: gap } : {}) } }); }
      catch { state.dropped += gap + 1; }
    }).finally(() => { state.pending--; });
  } catch { state.dropped++; }
}

export function withDebugSpan<T>(spanId: string, work: () => T): T {
  const context = storage.getStore();
  return context ? storage.run({ ...context, spanId }, work) : work();
}

export async function withCreativeDebug<T>(scope: TraceScope, work: () => Promise<T>, write?: (record: TraceWrite) => Promise<unknown>): Promise<T> {
  const context: TraceContext = { scope, spanId: `run:${scope.runId}`, state: { queue: Promise.resolve(), pending: 0, dropped: 0, secrets: new Set() }, write: write ?? (async record => (await import("./debug-store")).appendDebugEvent(record)) };
  return storage.run(context, async () => {
    try { return await work(); }
    finally {
      // Best effort diagnostics must not turn a successful action into a retry.
      await Promise.race([context.state.queue, new Promise<void>(resolve => { const timer = setTimeout(resolve, 1000); timer.unref?.(); })]);
      if (context.state.dropped) console.warn("creative agent debug recording incomplete", { runId: scope.runId, count: context.state.dropped });
    }
  });
}
