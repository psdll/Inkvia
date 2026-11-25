import type { DebugBatch, DebugDetail, DebugEvent } from "@/lib/creative-agent/debug-contracts";

export class DebugAccessError extends Error {}
export async function debugGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal });
  if ([401, 403, 404].includes(response.status)) throw new DebugAccessError("调试权限或画布访问权限已失效");
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "调试记录暂时不可用");
  return value as T;
}
export async function streamDebugEvents(runId: string, cursor: { after: number; publicAfter: number }, signal: AbortSignal, receive: (batch: DebugBatch) => void) {
  const response = await fetch(`/api/creative-agent/runs/${encodeURIComponent(runId)}/debug/stream?after=${cursor.after}&publicAfter=${cursor.publicAfter}`, { cache: "no-store", credentials: "same-origin", signal });
  if ([401, 403, 404].includes(response.status)) throw new DebugAccessError("调试权限或画布访问权限已失效");
  if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("实时连接中断");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (block.startsWith("event: complete")) return true;
        if (block.startsWith("event: forbidden")) throw new DebugAccessError("调试权限或画布访问权限已失效");
        if (block.startsWith("event: reconnect")) return false;
        const data = block.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
        if (data) {
          const batch = JSON.parse(data) as DebugBatch;
          if (batch.run?.id !== runId || !Array.isArray(batch.events) || batch.nextSequence < cursor.after || batch.nextPublicSequence < cursor.publicAfter) throw new Error("实时记录格式无效");
          receive(batch);
          cursor.after = batch.nextSequence; cursor.publicAfter = batch.nextPublicSequence;
        }
      }
      if (buffer.length > 4_000_000) throw new Error("实时记录超过大小限制");
      if (chunk.done) return false;
    }
    return false;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export type DebugStep = DebugEvent & { firstAt: string; eventCount: number; events: DebugEvent[] };
export function groupDebugEvents(events: DebugEvent[]): DebugStep[] {
  const byId = new Map(events.map(event => [event.id, event]));
  const bySpan = new Map<string, DebugStep>();
  for (const event of [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.sequence - b.sequence)) {
    const prior = bySpan.get(event.spanId);
    if (!prior) bySpan.set(event.spanId, { ...event, firstAt: event.createdAt, eventCount: 1, events: [event] });
    else bySpan.set(event.spanId, { ...prior, ...event, title: ["model", "tool", "http", "media"].includes(prior.category) ? prior.title : event.title, parentSpanId: prior.parentSpanId ?? event.parentSpanId, hasDetail: prior.hasDetail || event.hasDetail, summary: { ...prior.summary, ...event.summary }, eventCount: prior.eventCount + 1, events: [...prior.events, event] });
  }
  return [...bySpan.values()];
}

export async function loadDebugDetails(runId: string, spanId?: string, signal?: AbortSignal) {
  let after = 0, more = true;
  const items: DebugDetail[] = [];
  while (more) {
    const page = await debugGet<{ items: DebugDetail[]; nextSequence: number; hasMore: boolean }>(`/api/creative-agent/runs/${encodeURIComponent(runId)}/debug?details=1&after=${after}${spanId ? `&spanId=${encodeURIComponent(spanId)}` : ""}`, signal);
    items.push(...page.items);
    more = page.hasMore && page.nextSequence > after;
    after = page.nextSequence;
  }
  return items;
}
