import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { runCanvasMediaGcBatch } from "@/lib/canvas/media-gc";
import { cleanupExpiredCanvasUndoMediaHolds } from "@/lib/canvas/undo-media-holds";
import { runCanvasWorkerBatch } from "@/lib/canvas/run-worker";
import { compactCanvasSnapshot, pruneCanvasSnapshots } from "@/lib/canvas/snapshot-compactor";
import { purgeExpiredCanvasTrashBatch } from "@/lib/canvas/trash-retention";
import prisma from "@/lib/prisma";
import { rebuildCanvasProjection } from "@/lib/canvas/projection-rebuild-service";
import { runToolMediaRelayMaintenanceBatch } from "@/lib/tool-media/maintenance";
import { purgeExpiredSystemRoleSkills } from "@/lib/role-skills/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sameSecret(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorized(req: NextRequest) {
  const token = String(process.env.CANVAS_WORKER_TOKEN || process.env.INTERNAL_METRICS_TOKEN || "").trim();
  if (token) return sameSecret(req.headers.get("authorization") || "", `Bearer ${token}`);
  if (process.env.NODE_ENV === "production") return false;
  return ["127.0.0.1", "localhost", "::1"].includes(new URL(req.url).hostname);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return new NextResponse("not found", { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { workerId?: string; limit?: number; action?: string; canvasId?: number; repair?: boolean; role?: string };
  const workerId = String(body.workerId || req.headers.get("x-worker-id") || "canvas-worker").slice(0, 256);
  if (body.action === "rebuild_projection") {
    const canvasId = Number(body.canvasId);
    if (!Number.isSafeInteger(canvasId) || canvasId < 1) return NextResponse.json({ success: false, error: "invalid canvasId" }, { status: 400 });
    const rebuild = await rebuildCanvasProjection(prisma, { canvasId, repair: body.repair === true });
    return NextResponse.json({ success: true, workerId, rebuild });
  }
  const limit = Math.min(Math.max(Math.floor(Number(body.limit) || 20), 1), 100);
  const role = body.role === "generation" || body.role === "media" ? body.role : "all";
  const runQueue = role === "media" ? null : await runCanvasWorkerBatch({ workerId, limit });
  const expiredUndoMediaHolds = role === "generation"
    ? null
    : await cleanupExpiredCanvasUndoMediaHolds(prisma, new Date(), Math.min(limit * 20, 500));
  const trashCleanup = role === "generation"
    ? null
    : await purgeExpiredCanvasTrashBatch(prisma, { limit });
  const mediaGc = role === "generation" ? null : await runCanvasMediaGcBatch(prisma, { workerId: `${workerId}:media`, limit: Math.min(limit, 25) });
  const toolMediaRelay = role === "generation" ? null : await runToolMediaRelayMaintenanceBatch(prisma, { workerId: `${workerId}:tool-relay`, limit: Math.min(limit, 25) });
  const systemSkillCleanup = role === "generation" ? null : await purgeExpiredSystemRoleSkills({ limit });
  const candidates = role === "media" ? [] : await prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT "id" FROM "Canvas"
    WHERE "deletedAt" IS NULL AND "projectionRevision" = "revision64"
      AND "snapshotRevision" < "revision64"
      AND ("revision64" - "snapshotRevision" >= 100 OR "updatedAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes')
    ORDER BY ("revision64" - "snapshotRevision") DESC, "updatedAt" ASC
    LIMIT 2
  `);
  const snapshots = [];
  for (const candidate of candidates) {
    const compacted = await compactCanvasSnapshot(prisma, candidate.id);
    const pruned = await pruneCanvasSnapshots(prisma, candidate.id, 3);
    snapshots.push({ canvasId: candidate.id, compacted, pruned });
  }
  await prisma.appSetting.upsert({
    where: { key: "canvas_worker_heartbeat" },
    create: { key: "canvas_worker_heartbeat", value: JSON.stringify({ workerId, successAt: new Date().toISOString() }) },
    update: { value: JSON.stringify({ workerId, successAt: new Date().toISOString() }) },
  });
  return NextResponse.json({ success: true, workerId, role, runQueue, expiredUndoMediaHolds, trashCleanup, mediaGc, toolMediaRelay, systemSkillCleanup, snapshots });
}
