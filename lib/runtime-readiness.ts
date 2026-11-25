import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import prisma from "@/lib/prisma";
import { resolveProjectRootDir, resolvePublicPath } from "@/lib/public-path";

export const READINESS_UPLOADS_SENTINEL = ".inkvia-uploads";
export const READINESS_UPLOADS_SENTINEL_CONTENT = "INKVIA_UPLOADS_V1\n";

type Check = { status: "ok" | "error"; latencyMs?: number; [key: string]: unknown };
type ReadinessInput = {
  db?: any;
  now?: Date;
  env?: Record<string, string | undefined>;
  migrationsRoot?: string;
};

function parseJson(value: unknown): Record<string, any> | null {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function dateAgeMs(value: unknown, now: Date): number | null {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? null : Math.max(0, now.getTime() - date.getTime());
}

async function writableProbe(directory: string) {
  await fs.access(directory, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
}

async function timed(code: string, run: () => Promise<Check>): Promise<Check> {
  const startedAt = performance.now();
  try {
    return { ...(await run()), latencyMs: Math.round((performance.now() - startedAt) * 100) / 100 };
  } catch (error) {
    console.warn(`[readiness] ${code}:`, (error as Error)?.message || error);
    return {
      status: "error",
      latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
      code,
    };
  }
}

export async function runReadinessChecks(input: ReadinessInput = {}) {
  const db = input.db || prisma;
  const now = input.now || new Date();
  const env = input.env || process.env;
  const production = env.NODE_ENV === "production";
  const configuredUploads = String(env.UPLOADS_DIR || "").trim();
  const uploadsRoot = configuredUploads ? path.resolve(configuredUploads) : resolvePublicPath("uploads");
  const migrationsRoot = input.migrationsRoot || path.join(resolveProjectRootDir(), "prisma", "migrations");
  const requireSentinel = production || env.READINESS_REQUIRE_UPLOADS_SENTINEL === "1";
  const heartbeatMaxAgeMs = Math.max(1_000, Number(env.WORKER_HEARTBEAT_MAX_AGE_MS) || 120_000);
  const eventMaxAgeMs = Math.max(1_000, Number(env.ADMIN_EVENT_MAX_AGE_MS) || 30_000);
  const diffMaxAgeMs = Math.max(60_000, Number(env.ADMIN_READ_MODEL_DIFF_MAX_AGE_MS) || 2 * 60 * 60_000);
  const zeroWindowMs = Math.max(60_000, Number(env.ADMIN_READ_MODEL_ZERO_WINDOW_MS) || 24 * 60 * 60_000);
  const checks: Record<string, Check> = {};

  checks.database = await timed("DATABASE_UNAVAILABLE", async () => {
    await db.$queryRawUnsafe("SELECT 1 AS ok");
    return { status: "ok" };
  });
  checks.uploadsMount = await timed("UPLOADS_MOUNT_UNAVAILABLE", async () => {
    if (production && !configuredUploads) throw new Error("UPLOADS_DIR is required in production");
    const rootStat = await fs.stat(uploadsRoot);
    if (!rootStat.isDirectory()) throw new Error("uploads path is not a directory");
    await fs.realpath(uploadsRoot);
    if (requireSentinel) {
      const sentinel = await fs.readFile(path.join(uploadsRoot, READINESS_UPLOADS_SENTINEL), "utf8");
      if (sentinel !== READINESS_UPLOADS_SENTINEL_CONTENT) throw new Error("uploads sentinel mismatch");
    }
    return { status: "ok", sentinel: requireSentinel ? "verified" : "not-required" };
  });
  checks.uploadsWritable = await timed("UPLOADS_NOT_WRITABLE", async () => {
    await writableProbe(uploadsRoot);
    return { status: "ok" };
  });
  checks.thumbnailDirectory = await timed("THUMBNAIL_DIRECTORY_UNAVAILABLE", async () => {
    const directory = path.join(uploadsRoot, "_thumbs");
    const directoryStat = await fs.stat(directory);
    if (!directoryStat.isDirectory()) throw new Error("thumbnail path is not a directory");
    await writableProbe(directory);
    return { status: "ok" };
  });
  checks.migrations = await timed("MIGRATION_DRIFT", async () => {
    const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
    const expected = entries
      .filter((entry) => entry.isDirectory() && /^\d+_[a-zA-Z0-9_-]+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    const rows = await db.$queryRawUnsafe(
      `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`,
    );
    const applied = new Set(rows
      .filter((row: any) => row.finished_at && !row.rolled_back_at)
      .map((row: any) => String(row.migration_name)));
    const failed = rows.filter((row: any) => !row.finished_at && !row.rolled_back_at);
    const pending = expected.filter((name) => !applied.has(name));
    if (failed.length || pending.length) throw new Error(`migration drift pending=${pending.length} failed=${failed.length}`);
    return { status: "ok", applied: expected.length };
  });
  checks.generationRequestKey = await timed("GENERATION_REQUEST_KEY_UNSAFE", async () => {
    if (!production) {
      return { status: "ok", indexReady: false, duplicateGroups: 0, required: false };
    }
    const rows = await db.$queryRawUnsafe(
      `WITH request_key_index AS (
         SELECT EXISTS (
           SELECT 1
           FROM pg_class index_class
           JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
           JOIN pg_index index_state ON index_state.indexrelid = index_class.oid
           WHERE index_namespace.nspname = current_schema()
             AND index_class.relname = 'Generation_requestKey_key'
             AND index_state.indisunique
             AND index_state.indisvalid
             AND index_state.indisready
         ) AS index_ready
       )
       SELECT
         index_ready,
         CASE
           WHEN index_ready THEN 0::bigint
           ELSE (
             SELECT COUNT(*)::bigint
             FROM (
               SELECT "requestKey"
               FROM "Generation"
               WHERE "requestKey" IS NOT NULL
               GROUP BY "requestKey"
               HAVING COUNT(*) > 1
             ) duplicate_request_keys
           )
         END AS duplicate_groups
       FROM request_key_index`,
    );
    const indexReady = rows?.[0]?.index_ready === true;
    const duplicateGroups = Number(rows?.[0]?.duplicate_groups || 0);
    if (!indexReady || duplicateGroups > 0) {
      throw new Error(`generation request key unsafe indexReady=${indexReady} duplicateGroups=${duplicateGroups}`);
    }
    return { status: "ok", indexReady, duplicateGroups, required: true };
  });
  checks.workerHeartbeat = await timed("WORKER_HEARTBEAT_STALE", async () => {
    const row = await db.appSetting.findUnique({ where: { key: "admin_event_worker_heartbeat" } });
    const heartbeat = parseJson(row?.value);
    const ageMs = dateAgeMs(heartbeat?.successAt, now);
    if (ageMs == null || ageMs > heartbeatMaxAgeMs) throw new Error("admin event worker heartbeat is stale");
    return { status: "ok", ageMs };
  });
  checks.eventBacklog = await timed("ADMIN_EVENT_BACKLOG_UNHEALTHY", async () => {
    const rows = await db.$queryRawUnsafe(
      `SELECT COUNT(*)::bigint AS backlog_count,
              MIN("occurredAt") AS oldest_at,
              COUNT(*) FILTER (WHERE "status" = 'failed' AND "attempts" >= 8)::bigint AS exhausted_count
       FROM "AdminEvent" WHERE "status" IN ('pending', 'failed', 'processing')`,
    );
    const backlog = Number(rows?.[0]?.backlog_count || 0);
    const exhausted = Number(rows?.[0]?.exhausted_count || 0);
    const oldestAgeMs = backlog ? dateAgeMs(rows?.[0]?.oldest_at, now) : 0;
    if (exhausted > 0) throw new Error(`admin event retries exhausted: ${exhausted}`);
    if (oldestAgeMs != null && oldestAgeMs > eventMaxAgeMs) throw new Error("admin event backlog is too old");
    return { status: "ok", backlog, exhausted, oldestAgeMs };
  });
  checks.readModelDiff = await timed("READ_MODEL_DIFF_UNVERIFIED", async () => {
    const enabled = env.ADMIN_WORKS_READ_MODEL === "1";
    const row = await db.appSetting.findUnique({ where: { key: "admin_read_model_diff" } });
    const snapshot = parseJson(row?.value);
    const rawCount = snapshot?.count;
    const count = rawCount !== null && rawCount !== undefined && rawCount !== "" && Number.isFinite(Number(rawCount))
      ? Math.max(0, Number(rawCount))
      : null;
    const ageMs = dateAgeMs(snapshot?.checkedAt, now);
    const zeroAgeMs = dateAgeMs(snapshot?.zeroSince, now);
    if (production && enabled && (count == null || ageMs == null)) throw new Error("read model diff snapshot is missing");
    if (enabled && ageMs != null && ageMs > diffMaxAgeMs) throw new Error("read model diff snapshot is stale");
    if (enabled && count != null && count > 0) throw new Error(`read model diff is ${count}`);
    if (enabled && (zeroAgeMs == null || zeroAgeMs < zeroWindowMs)) {
      throw new Error("read model zero-diff observation window is incomplete");
    }
    return { status: "ok", count, ageMs, zeroAgeMs, enabled, measured: enabled && count != null };
  });
  checks.userSummaryDiff = await timed("USER_SUMMARY_DIFF_UNVERIFIED", async () => {
    const row = await db.appSetting.findUnique({ where: { key: "admin_user_summary_read_model_diff" } });
    const snapshot = parseJson(row?.value);
    const rawCount = snapshot?.count;
    const count = rawCount !== null && rawCount !== undefined && rawCount !== "" && Number.isFinite(Number(rawCount))
      ? Math.max(0, Number(rawCount))
      : null;
    const ageMs = dateAgeMs(snapshot?.checkedAt, now);
    const enabled = env.ADMIN_SUMMARY_READ_MODEL === "1";
    if (production && enabled && (count == null || ageMs == null)) throw new Error("user summary diff snapshot is missing");
    if (enabled && ageMs != null && ageMs > diffMaxAgeMs) throw new Error("user summary diff snapshot is stale");
    if (enabled && count != null && count > 0) throw new Error(`user summary diff is ${count}`);
    return { status: "ok", count, ageMs, enabled, measured: enabled && count != null };
  });

  return {
    ready: Object.values(checks).every((check) => check.status === "ok"),
    checks,
    timestamp: now.toISOString(),
    uptimeSec: Math.round(process.uptime()),
  };
}
