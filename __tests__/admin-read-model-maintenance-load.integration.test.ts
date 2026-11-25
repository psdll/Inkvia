import { afterAll, describe, expect, it } from "vitest";

import { rebuildRecentDailyAnalytics } from "@/lib/admin-analytics-rollup";
import { processAdminEvents } from "@/lib/admin-operational";
import prisma from "@/lib/prisma";

const loadIt = process.env.RUN_ADMIN_MAINTENANCE_LOAD_GATE === "1" ? it : it.skip;

async function currentWalLsn() {
  const rows = await prisma.$queryRawUnsafe<Array<{ lsn: string }>>(`SELECT pg_current_wal_lsn()::text AS lsn`);
  return rows[0]?.lsn || "0/0";
}

async function walBytes(from: string, to: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ bytes: bigint }>>(
    `SELECT pg_wal_lsn_diff($2::pg_lsn, $1::pg_lsn)::bigint AS bytes`,
    from,
    to,
  );
  return Number(rows[0]?.bytes || 0);
}

describe("administrator read-model maintenance load gate", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  loadIt("reconciles one million works set-wise and is idempotent", async () => {
    const count = await prisma.generation.count();
    expect(count).toBe(1_000_000);

    const firstStartedAt = performance.now();
    const first = await rebuildRecentDailyAnalytics("all");
    const firstMs = performance.now() - firstStartedAt;
    expect(first.leaseAcquired).toBe(true);
    expect(first.scanned).toBe(1_000_000);
    expect(firstMs).toBeLessThan(120_000);

    const beforeLsn = await currentWalLsn();
    const secondStartedAt = performance.now();
    const second = await rebuildRecentDailyAnalytics("all");
    const secondMs = performance.now() - secondStartedAt;
    const afterLsn = await currentWalLsn();
    const secondWalBytes = await walBytes(beforeLsn, afterLsn);

    expect(second.leaseAcquired).toBe(true);
    expect(second.scanned).toBe(1_000_000);
    expect(secondMs).toBeLessThan(30_000);
    expect(secondWalBytes).toBeLessThan(16 * 1024 * 1024);

    const [workDiff, summaryDiff] = await Promise.all([
      prisma.appSetting.findUnique({ where: { key: "admin_read_model_diff" } }),
      prisma.appSetting.findUnique({ where: { key: "admin_user_summary_read_model_diff" } }),
    ]);
    expect(JSON.parse(workDiff?.value || "{}").count).toBe(0);
    expect(JSON.parse(summaryDiff?.value || "{}").count).toBe(0);
    console.info(JSON.stringify({ firstMs, secondMs, secondWalBytes }));
  }, 180_000);

  loadIt("processes a status update for a 100k-work guest without scanning that history", async () => {
    await prisma.adminEvent.updateMany({ where: { status: { not: "done" } }, data: { status: "done", processedAt: new Date() } });
    const source = await prisma.generation.findFirst({
      where: { userId: "load-gate-user" },
      orderBy: { id: "asc" },
      select: { id: true, status: true },
    });
    expect(source).not.toBeNull();
    const nextStatus = source!.status === "success" ? "failed" : "success";
    await prisma.generation.update({ where: { id: source!.id }, data: { status: nextStatus } });

    const startedAt = performance.now();
    const result = await processAdminEvents(10, { workerId: "maintenance-load-gate" });
    const durationMs = performance.now() - startedAt;
    const feed = await prisma.adminWorkFeed.findUnique({ where: { generationId: source!.id } });

    expect(result.failed).toBe(0);
    expect(result.processed).toBeGreaterThan(0);
    expect(feed?.status).toBe(nextStatus);
    expect(durationMs).toBeLessThan(3_000);
    console.info(JSON.stringify({ workerStatusUpdateMs: durationMs }));
  }, 30_000);

  loadIt("reprojects a 100k-work guest when the device becomes authenticated", async () => {
    const marker = `load-gate-identity-${Date.now()}`;
    let generationId = 0;
    let authUserId = 0;
    try {
      const user = await prisma.user.create({
        data: { username: marker, password: "load-gate-only" },
      });
      authUserId = user.id;
      const generation = await prisma.generation.create({
        data: {
          userId: "load-gate-user",
          authUserId,
          type: "image_edit",
          source: "tool",
          prompt: "load gate identity transition",
          status: "success",
          sizeBytes: 1024,
        },
      });
      generationId = generation.id;

      const startedAt = performance.now();
      const result = await processAdminEvents(10, { workerId: "maintenance-identity-load-gate" });
      const durationMs = performance.now() - startedAt;
      const [authSummary, guestSummary] = await Promise.all([
        prisma.adminUserSummary.findUnique({ where: { adminKey: `auth:${authUserId}` } }),
        prisma.adminUserSummary.findUnique({ where: { adminKey: "guest:load-gate-user" } }),
      ]);

      expect(result.failed).toBe(0);
      expect(authSummary).toEqual(expect.objectContaining({ totalTaskCount: 100_001, deletedAt: null }));
      expect(guestSummary?.deletedAt).not.toBeNull();
      expect(durationMs).toBeLessThan(15_000);
      console.info(JSON.stringify({ identityTransitionMs: durationMs }));
    } finally {
      if (generationId) await prisma.generation.deleteMany({ where: { id: generationId } });
      if (authUserId) await prisma.user.deleteMany({ where: { id: authUserId } });
      if (generationId) {
        await processAdminEvents(10, { workerId: "maintenance-identity-cleanup" });
      }
    }
  }, 60_000);
});
