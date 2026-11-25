import "server-only";
import prisma from "@/lib/prisma";
import { randomUUID } from "node:crypto";
import { creativeAgentStore } from "./store";
import { DEBUG_DETAIL_DAYS, DEBUG_EVENT_DAYS, debugRunLabels, type DebugBatch, type DebugDetail, type DebugEvent, type DebugIndex } from "./debug-contracts";
import type { TraceWrite } from "./debug-trace";
import { sanitizeDebugValue } from "./debug-sanitize";
import type { Run } from "./store-types";
import { CreativeAgentError } from "./errors";

type Row = Record<string, any>;
const metadataColumns = `id,sequence,run_id,span_id,parent_span_id,category,type,title,status,summary,created_at,(detail IS NOT NULL) AS has_detail`;
const mapEvent = (row: Row): DebugEvent => ({ id: row.id, sequence: Number(row.sequence), runId: row.run_id, spanId: row.span_id, parentSpanId: row.parent_span_id, category: row.category, type: row.type, title: row.title, status: row.status, summary: row.summary, createdAt: new Date(row.created_at).toISOString(), hasDetail: row.has_detail });
const publicRun = (run: Run) => ({ id: run.id, sessionId: run.sessionId, canvasId: run.canvasId, status: run.status, error: run.error, createdAt: run.createdAt, updatedAt: run.updatedAt });

export async function requireDebugStorage() {
  const rows = await prisma.$queryRawUnsafe<Row[]>(`SELECT to_regclass('public."CreativeAgentTraceEvent"')::text AS name`);
  if (!rows[0]?.name) throw new CreativeAgentError("DEBUG_STORAGE_UNAVAILABLE", "调试记录表尚未就绪，请完成数据库迁移", 503);
}

export async function appendDebugEvent(record: TraceWrite) {
  // Serialize sequence allocation AND commit per run, including separate worker processes.
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '1000ms'");
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text", `creative-debug:${record.runId}`);
    await tx.$executeRawUnsafe(`INSERT INTO "CreativeAgentTraceEvent"(id,run_id,span_id,parent_span_id,category,type,title,status,summary,detail,event_key,created_at)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12 FROM "CreativeAgentRun" WHERE id=$2 AND actor_user_id=$13 AND canvas_id=$14
      ON CONFLICT(run_id,event_key) DO NOTHING`, randomUUID(), record.runId, record.spanId, record.parentSpanId ?? null, record.category, record.type, record.title, record.status ?? "info", JSON.stringify(record.summary ?? {}), record.detail === undefined ? null : JSON.stringify(record.detail), record.eventKey ?? null, record.createdAt, record.actorUserId, record.canvasId);
  }, { maxWait: 1000, timeout: 2000 });
}

export async function readDebugIndex(actorUserId: number, canvasId: number, sessionId?: string, before?: string): Promise<DebugIndex> {
  const sessions = await creativeAgentStore.listSessions(actorUserId, canvasId);
  if (sessionId && !sessions.some(item => item.id === sessionId)) throw new CreativeAgentError("SESSION_NOT_FOUND", "对话不存在", 404);
  const rows = await prisma.$queryRawUnsafe<Row[]>(`SELECT id,session_id,canvas_id,status,error,created_at,updated_at FROM "CreativeAgentRun"
    WHERE actor_user_id=$1 AND canvas_id=$2 AND ($3::text IS NULL OR session_id=$3)
    AND ($4::text IS NULL OR (created_at,id) < (SELECT created_at,id FROM "CreativeAgentRun" WHERE id=$4 AND actor_user_id=$1 AND canvas_id=$2))
    ORDER BY created_at DESC,id DESC LIMIT 51`, actorUserId, canvasId, sessionId ?? null, before ?? null);
  return { sessions, runs: rows.slice(0, 50).map(row => ({ id: row.id, sessionId: row.session_id, canvasId: Number(row.canvas_id), status: row.status, error: row.error, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() })), hasMore: rows.length > 50 };
}

const publicTypes = ["run.status", "decision.requested", "canvas.committed", "usage.updated", "error"];
function mapPublic(row: Row): DebugEvent {
  const payload = sanitizeDebugValue(row.payload) as Record<string, unknown>;
  const status = String(payload.status || "");
  const title = row.type === "run.status" ? debugRunLabels[status] || status : row.type === "decision.requested" ? "等待用户确认" : row.type === "canvas.committed" ? "已写入画布" : row.type === "usage.updated" ? "更新模型用量" : "运行异常";
  return { id: `public:${row.sequence}`, sequence: Number(row.sequence), runId: row.run_id, spanId: row.type === "run.status" ? `run:${row.run_id}` : `public:${row.sequence}`, parentSpanId: null, category: row.type === "canvas.committed" ? "canvas" : row.type === "usage.updated" ? "usage" : "run", type: row.type, title, status: row.type === "error" || status === "failed" ? "error" : status.startsWith("waiting") || status === "paused" || row.type === "decision.requested" ? "waiting" : status === "running" || status === "queued" ? "running" : "info", createdAt: row.created_at.toISOString(), summary: payload, hasDetail: false };
}

export async function readDebugBatch(run: Run, after: number, publicAfter: number): Promise<DebugBatch> {
  const [trace, events] = await Promise.all([
    prisma.$queryRawUnsafe<Row[]>(`SELECT ${metadataColumns} FROM "CreativeAgentTraceEvent" WHERE run_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 101`, run.id, BigInt(after)),
    prisma.$queryRawUnsafe<Row[]>(`SELECT sequence,run_id,type,payload,created_at FROM "CreativeAgentEvent" WHERE run_id=$1 AND sequence>$2 AND type=ANY($3::text[]) ORDER BY sequence LIMIT 101`, run.id, BigInt(publicAfter), publicTypes),
  ]);
  const rows = trace.slice(0, 100), publicRows = events.slice(0, 100);
  return { events: [...rows.map(mapEvent), ...publicRows.map(mapPublic)].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)), nextSequence: Number(rows.at(-1)?.sequence ?? after), nextPublicSequence: Number(publicRows.at(-1)?.sequence ?? publicAfter), hasMore: trace.length > 100 || events.length > 100, run: publicRun(run) };
}

export async function readDebugDetails(runId: string, spanId?: string, after = 0) {
  const rows = await prisma.$queryRawUnsafe<Row[]>(`SELECT ${metadataColumns},detail FROM "CreativeAgentTraceEvent" WHERE run_id=$1 AND ($2::text IS NULL OR span_id=$2) AND sequence>$3 ORDER BY sequence LIMIT 51`, runId, spanId ?? null, BigInt(after));
  const items: DebugDetail[] = rows.slice(0, 50).map(row => ({ ...mapEvent(row), detail: row.detail }));
  const billingIds = [...new Set(items.map(item => item.summary.billingId).filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id)))];
  if (billingIds.length) {
    const billing = await prisma.$queryRawUnsafe<Row[]>(`SELECT id,status,"costStatus",amount::text,currency,"unitCount"::text,"unitType","finishedAt" FROM "UsageLedger" WHERE id=ANY($1::int[]) AND "authUserId"=(SELECT actor_user_id FROM "CreativeAgentRun" WHERE id=$2)`, billingIds, runId);
    for (const item of items) {
      const ledger = billing.find(row => row.id === item.summary.billingId);
      if (ledger) item.detail = { ...(item.detail && typeof item.detail === "object" ? item.detail : {}), billing: { ...ledger, amount: ledger.costStatus === "priced" || ledger.costStatus === "free" ? ledger.amount : null, note: "账本金额；未定价或未结算显示为空，不代表免费" } };
    }
  }
  return { items, hasMore: rows.length > 50, nextSequence: items.at(-1)?.sequence ?? after };
}

let nextPruneAt = 0;
export async function pruneDebugRecords() {
  if (Date.now() < nextPruneAt) return;
  nextPruneAt = Date.now() + 3_600_000;
  try {
    // Bounded diagnostics-only cleanup, never deletes Agent conversations or action receipts.
    await prisma.$executeRawUnsafe(`UPDATE "CreativeAgentTraceEvent" SET detail=NULL WHERE id IN (SELECT id FROM "CreativeAgentTraceEvent" WHERE created_at < now() - $1 * interval '1 day' AND detail IS NOT NULL ORDER BY created_at LIMIT 500)`, DEBUG_DETAIL_DAYS);
    await prisma.$executeRawUnsafe(`DELETE FROM "CreativeAgentTraceEvent" WHERE id IN (SELECT id FROM "CreativeAgentTraceEvent" WHERE created_at < now() - $1 * interval '1 day' ORDER BY created_at LIMIT 500)`, DEBUG_EVENT_DAYS);
  } catch { /* Optional diagnostics cannot stop the worker. */ }
}
