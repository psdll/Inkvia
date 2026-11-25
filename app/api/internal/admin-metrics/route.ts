import { getHeapStatistics } from "node:v8";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getAdminMetricSnapshot } from "@/lib/admin-observability";
import { thumbnailCache } from "@/lib/thumbnail-cache";
import { canvasMetrics } from "@/lib/canvas/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest) {
  const token = String(process.env.INTERNAL_METRICS_TOKEN || "").trim();
  if (token) return req.headers.get("authorization") === `Bearer ${token}`;
  if (process.env.NODE_ENV === "production") return false;
  const hostname = new URL(req.url).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function json(value: unknown) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}

function ageSeconds(value: unknown, now = Date.now()) {
  const timestamp = new Date(String(value || "")).getTime();
  return Number.isNaN(timestamp) ? null : Math.max(0, (now - timestamp) / 1_000);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return new NextResponse("not found", { status: 404 });
  const [eventRows, heartbeatRow, diffRow, canvasQueueRows, canvasStorageRows, canvasDbRows, canvasWorkerHeartbeat] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ backlog_count: bigint; oldest_at: Date | null; exhausted_count: bigint }>>(
      `SELECT COUNT(*)::bigint AS backlog_count,
              MIN("occurredAt") AS oldest_at,
              COUNT(*) FILTER (WHERE "status" = 'failed' AND "attempts" >= 8)::bigint AS exhausted_count
       FROM "AdminEvent" WHERE "status" IN ('pending', 'failed', 'processing')`,
    ),
    prisma.appSetting.findUnique({ where: { key: "admin_event_worker_heartbeat" } }),
    prisma.appSetting.findUnique({ where: { key: "admin_read_model_diff" } }),
    prisma.$queryRawUnsafe<Array<{
      queue_length: bigint; oldest_wait_ms: number; submission_unknown: bigint; projection_mismatch: bigint;
    }>>(`
      SELECT
        COUNT(*) FILTER (WHERE step."status" IN ('queued', 'leased', 'retry_wait'))::bigint AS queue_length,
        COALESCE(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - MIN(step."createdAt") FILTER (WHERE step."status" = 'queued'))) * 1000, 0)::float8 AS oldest_wait_ms,
        COUNT(*) FILTER (WHERE step."status" = 'submission_unknown')::bigint AS submission_unknown,
        (SELECT COUNT(*) FROM "Canvas" WHERE "deletedAt" IS NULL AND "projectionRevision" <> "revision64")::bigint AS projection_mismatch
      FROM "CanvasRunStep" step
    `),
    prisma.$queryRawUnsafe<Array<{ compaction_backlog: bigint; snapshot_bytes: bigint; media_gc_backlog: bigint }>>(`
      SELECT
        (SELECT COUNT(*) FROM "Canvas" WHERE "deletedAt" IS NULL AND "snapshotRevision" < "revision64")::bigint AS compaction_backlog,
        COALESCE((SELECT SUM(snapshot."uncompressedBytes") FROM "CanvasSnapshot" snapshot
          JOIN "Canvas" canvas ON canvas."currentSnapshotId" = snapshot."id"), 0)::bigint AS snapshot_bytes,
        (SELECT COUNT(*) FROM "MediaAsset" WHERE "referenceCount" = 0 AND "status" IN ('initiated', 'failed', 'soft_deleted', 'purging')
          AND ("retentionUntil" IS NULL OR "retentionUntil" <= CURRENT_TIMESTAMP))::bigint AS media_gc_backlog
    `),
    prisma.$queryRawUnsafe<Array<{ used_connections: bigint; max_connections: number }>>(`
      SELECT COUNT(*)::bigint AS used_connections, current_setting('max_connections')::int AS max_connections FROM pg_stat_activity
    `),
    prisma.appSetting.findMany({ where: { key: { in: ["canvas_worker_heartbeat", "canvas_worker_heartbeat_all", "canvas_worker_heartbeat_generation", "canvas_worker_heartbeat_media"] } } }),
  ]);
  const processMetrics = getAdminMetricSnapshot();
  const thumbnail = thumbnailCache.getMetrics();
  const heartbeat = json(heartbeatRow?.value);
  const diff = json(diffRow?.value);
  const backlog = Number(eventRows[0]?.backlog_count || 0);
  const exhausted = Number(eventRows[0]?.exhausted_count || 0);
  const oldestAge = backlog ? ageSeconds(eventRows[0]?.oldest_at) : 0;
  const heartbeatAge = ageSeconds(heartbeat?.successAt);
  const rawDiffCount = diff?.count;
  const diffCount = rawDiffCount !== null && rawDiffCount !== undefined && rawDiffCount !== "" && Number.isFinite(Number(rawDiffCount))
    ? Math.max(0, Number(rawDiffCount))
    : null;
  const diffAge = ageSeconds(diff?.checkedAt);
  const lines = ["# TYPE admin_event_backlog gauge", `admin_event_backlog ${backlog}`];
  lines.push(`admin_event_oldest_age_seconds ${oldestAge ?? 0}`);
  lines.push(`admin_event_oldest_missing ${backlog > 0 && oldestAge == null ? 1 : 0}`);
  lines.push(`admin_event_exhausted_total ${exhausted}`);
  lines.push(`admin_worker_heartbeat_age_seconds ${heartbeatAge ?? 0}`);
  lines.push(`admin_worker_heartbeat_missing ${heartbeatAge == null ? 1 : 0}`);
  lines.push(`admin_read_model_diff_count ${diffCount ?? 0}`);
  lines.push(`admin_read_model_diff_missing ${diffCount == null || diffAge == null ? 1 : 0}`);
  lines.push(`admin_read_model_diff_age_seconds ${diffAge ?? 0}`);
  for (const [name, values] of Object.entries(processMetrics.latencies)) {
    const metric = `admin_${name.replace(/[^a-zA-Z0-9_]/g, "_")}_latency_ms`;
    lines.push(`${metric}{quantile="0.5"} ${values.p50}`);
    lines.push(`${metric}{quantile="0.95"} ${values.p95}`);
    lines.push(`${metric}{quantile="0.99"} ${values.p99}`);
    lines.push(`${metric}_count ${values.count}`);
  }
  for (const [name, values] of Object.entries(processMetrics.caches)) {
    const metric = `admin_${name.replace(/[^a-zA-Z0-9_]/g, "_")}_cache`;
    lines.push(`${metric}_hits_total ${values.hits}`);
    lines.push(`${metric}_misses_total ${values.misses}`);
    lines.push(`${metric}_hit_ratio ${values.hitRate}`);
  }
  lines.push(`admin_thumbnail_cache_hits_total ${thumbnail.hits}`);
  lines.push(`admin_thumbnail_cache_misses_total ${thumbnail.misses}`);
  lines.push(`admin_thumbnail_cache_hit_ratio ${thumbnail.hits + thumbnail.misses ? thumbnail.hits / (thumbnail.hits + thumbnail.misses) : 0}`);
  lines.push(`admin_thumbnail_queue_length ${thumbnail.queueLength}`);
  const canvasQueue = canvasQueueRows[0];
  const canvasStorage = canvasStorageRows[0];
  const canvasDb = canvasDbRows[0];
  const canvasHeartbeatAges = canvasWorkerHeartbeat.map((row) => ageSeconds(json(row.value)?.successAt)).filter((value): value is number => value !== null);
  const hasCombinedWorker = canvasWorkerHeartbeat.some((row) => row.key === "canvas_worker_heartbeat" || row.key === "canvas_worker_heartbeat_all");
  const hasSplitWorkers = canvasWorkerHeartbeat.some((row) => row.key === "canvas_worker_heartbeat_generation")
    && canvasWorkerHeartbeat.some((row) => row.key === "canvas_worker_heartbeat_media");
  lines.push(`canvas_run_queue_length ${Number(canvasQueue?.queue_length || 0)}`);
  lines.push(`canvas_run_wait_duration_ms ${Number(canvasQueue?.oldest_wait_ms || 0)}`);
  lines.push(`canvas_submission_unknown_current ${Number(canvasQueue?.submission_unknown || 0)}`);
  lines.push(`canvas_projection_checksum_mismatch ${Number(canvasQueue?.projection_mismatch || 0)}`);
  lines.push(`canvas_compaction_backlog ${Number(canvasStorage?.compaction_backlog || 0)}`);
  lines.push(`canvas_snapshot_bytes ${Number(canvasStorage?.snapshot_bytes || 0)}`);
  lines.push(`canvas_media_gc_backlog ${Number(canvasStorage?.media_gc_backlog || 0)}`);
  lines.push(`canvas_worker_heartbeat_age_seconds ${canvasHeartbeatAges.length ? Math.max(...canvasHeartbeatAges) : 0}`);
  lines.push(`canvas_worker_heartbeat_missing ${hasCombinedWorker || hasSplitWorkers ? 0 : 1}`);
  lines.push(`canvas_database_connection_usage_ratio ${canvasDb?.max_connections ? Number(canvasDb.used_connections) / canvasDb.max_connections : 0}`);
  const nodeMemory = process.memoryUsage();
  const heapLimitBytes = getHeapStatistics().heap_size_limit;
  lines.push("# TYPE inkvia_web_heap_used_bytes gauge");
  lines.push(`inkvia_web_heap_used_bytes ${Math.max(0, Math.floor(nodeMemory.heapUsed))}`);
  lines.push("# TYPE inkvia_web_heap_limit_bytes gauge");
  lines.push(`inkvia_web_heap_limit_bytes ${Math.max(0, Math.floor(heapLimitBytes))}`);
  lines.push("# TYPE inkvia_web_resident_memory_bytes gauge");
  lines.push(`inkvia_web_resident_memory_bytes ${Math.max(0, Math.floor(nodeMemory.rss))}`);
  const canvasProcessMetrics = canvasMetrics.formatPrometheus();
  if (canvasProcessMetrics) lines.push(canvasProcessMetrics);
  return new NextResponse(`${lines.join("\n")}\n`, {
    headers: { "Content-Type": "text/plain; version=0.0.4", "Cache-Control": "no-store" },
  });
}
