import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  adminEvent: {
    findMany: vi.fn().mockResolvedValue([]),
  },
}));
const cleanupMock = vi.hoisted(() => vi.fn(async () => ({
  ossError: "",
  failedOssKeys: [],
  skippedProtectedRefsCount: 0,
})));
const protectedGenerationRefsMock = vi.hoisted(() => vi.fn(async () => new Set<string>()));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/media-cleanup", () => ({
  collectComparableGenerationLocalPathRefs: protectedGenerationRefsMock,
  deleteStoredMediaRefs: cleanupMock,
}));
import {
  ADMIN_EVENT_RETRY_DELAYS_MS,
  canApplyAdminWorkEvent,
  getAdminEventRetryDelay,
  processAdminEvents,
  processMediaCleanupRetryEvents,
} from "@/lib/admin-operational";

describe("admin event worker policy", () => {
  const originalUploadsDir = process.env.UPLOADS_DIR;

  afterEach(() => {
    if (originalUploadsDir === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = originalUploadsDir;
    cleanupMock.mockClear();
    protectedGenerationRefsMock.mockClear();
  });

  it("uses the required eight retry delays", () => {
    expect(ADMIN_EVENT_RETRY_DELAYS_MS).toEqual([
      5_000,
      15_000,
      60_000,
      5 * 60_000,
      15 * 60_000,
      30 * 60_000,
      60 * 60_000,
      3 * 60 * 60_000,
    ]);
    expect(getAdminEventRetryDelay(1)).toBe(5_000);
    expect(getAdminEventRetryDelay(8)).toBe(3 * 60 * 60_000);
  });

  it("never lets an older generation event overwrite a newer feed state", () => {
    expect(canApplyAdminWorkEvent(0, 1)).toBe(true);
    expect(canApplyAdminWorkEvent(41, 42)).toBe(true);
    expect(canApplyAdminWorkEvent(42, 42)).toBe(false);
    expect(canApplyAdminWorkEvent(43, 42)).toBe(false);
  });

  it("takes a database lease and claims at most 100 rows with SKIP LOCKED", async () => {
    const rawCalls: Array<{ sql: string; args: unknown[] }> = [];
    const tx = {
      $queryRawUnsafe: async (sql: string, ...args: unknown[]) => {
        rawCalls.push({ sql, args });
        return rawCalls.length === 1 ? [{ acquired: true }] : [];
      },
    };
    const db = { $transaction: (run: (client: typeof tx) => unknown) => run(tx) };

    const result = await processAdminEvents(999, { db: db as any, workerId: "worker-test" });

    expect(result).toEqual(expect.objectContaining({ processed: 0, leaseAcquired: true }));
    expect(rawCalls[0].sql).toContain("pg_try_advisory_xact_lock");
    expect(rawCalls[1].sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(rawCalls[1].args).toContain(100);
  });

  it("marks a failed event with its retry availability instead of losing it", async () => {
    const event = {
      id: 9,
      eventType: "generation.update",
      entityType: "generation",
      entityId: "42",
      userId: "device-a",
      authUserId: 7,
      occurredAt: new Date("2026-07-16T00:00:00.000Z"),
      attempts: 1,
    };
    const updates: any[] = [];
    const savepointSql: string[] = [];
    let rawCall = 0;
    const tx = {
      $queryRawUnsafe: async () => (++rawCall === 1 ? [{ acquired: true }] : [event]),
      $executeRawUnsafe: async (sql: string) => { savepointSql.push(sql); return 0; },
      adminWorkFeed: { findUnique: async () => null },
      generation: { findUnique: async () => { throw new Error("temporary db error"); } },
      adminEvent: { update: async (args: any) => { updates.push(args); } },
    };
    const db = { $transaction: (run: (client: typeof tx) => unknown) => run(tx) };

    const result = await processAdminEvents(10, { db: db as any, workerId: "worker-test" });

    expect(result).toEqual(expect.objectContaining({ processed: 0, failed: 1 }));
    expect(updates[0]).toEqual(expect.objectContaining({
      where: { id: 9 },
      data: expect.objectContaining({ status: "failed", lockedAt: null, lockedBy: null }),
    }));
    expect(updates[0].data.availableAt.getTime()).toBeGreaterThanOrEqual(Date.now() + 4_000);
    expect(savepointSql.some((sql) => sql.startsWith("ROLLBACK TO SAVEPOINT"))).toBe(true);
  });

  it("retries persisted media cleanup events and marks them done only after success", async () => {
    const event = {
      id: 10,
      eventType: "media_cleanup_retry",
      entityType: "media_cleanup",
      entityId: "cleanup-10",
      payload: { refs: ["/uploads/generated/a.png"] },
      occurredAt: new Date("2026-08-12T00:00:00.000Z"),
      attempts: 1,
    };
    const updates: any[] = [];
    let rawCall = 0;
    const tx = {
      $queryRawUnsafe: async () => (++rawCall === 1 ? [{ acquired: true }] : [event]),
    };
    const db = {
      $transaction: (run: (client: typeof tx) => unknown) => run(tx),
      adminEvent: { update: async (args: any) => { updates.push(args); } },
    };

    const result = await processMediaCleanupRetryEvents(10, { db: db as any, workerId: "worker-test" });

    expect(result).toEqual(expect.objectContaining({ processed: 1, failed: 0 }));
    expect(cleanupMock).toHaveBeenCalledWith(
      ["/uploads/generated/a.png"],
      expect.objectContaining({
        canonicalGenerationOutputs: true,
        protectedGenerationComparableRefs: expect.any(Set),
      }),
    );
    expect(updates.at(-1)).toEqual(expect.objectContaining({
      where: { id: 10 },
      data: expect.objectContaining({ status: "done" }),
    }));
  });

  it("projects a generation with one monotonic ON CONFLICT statement", async () => {
    const event = {
      id: 12,
      eventType: "generation.update",
      entityType: "generation",
      entityId: "42",
      userId: "device-a",
      authUserId: 7,
      occurredAt: new Date("2026-07-16T00:00:00.000Z"),
      attempts: 1,
    };
    const generation = {
      id: 42,
      userId: "device-a",
      authUserId: 7,
      type: "image_edit",
      status: "success",
      source: "canvas",
      externalProvider: null,
      model: "model-a",
      localPath: "/uploads/result.png",
      templateData: null,
      errorMsg: null,
      createdAt: new Date("2026-07-16T00:00:00.000Z"),
      updatedAt: new Date("2026-07-16T00:01:00.000Z"),
      finishedAt: new Date("2026-07-16T00:01:00.000Z"),
      sizeBytes: 123,
    };
    const projectionSql: string[] = [];
    const tx = {
      $queryRawUnsafe: async (sql: string) => {
        projectionSql.push(sql);
        if (sql.includes("pg_try_advisory_xact_lock")) return [{ acquired: true }];
        if (sql.includes("WITH claimable")) return [event];
        if (sql.includes('INSERT INTO "AdminWorkFeed"')) return [{ generationId: 42 }];
        return [];
      },
      $executeRawUnsafe: async (sql: string) => { projectionSql.push(sql); return 1; },
      adminWorkFeed: {
        findUnique: async () => null,
        aggregate: async () => ({ _max: { createdAt: generation.createdAt } }),
        findMany: async () => [{ userId: generation.userId }],
      },
      analyticsDailyByUser: { findMany: async () => [] },
      user: { findUnique: async () => ({ username: "tester" }) },
      generation: { findUnique: async () => generation },
      adminEvent: { update: async () => ({}) },
    };
    const db = { $transaction: (run: (client: typeof tx) => unknown) => run(tx) };

    const result = await processAdminEvents(10, { db: db as any, workerId: "worker-test" });

    expect(result).toEqual(expect.objectContaining({ processed: 1, updatedGenerations: 1 }));
    const upsertSql = projectionSql.find((sql) => sql.includes('ON CONFLICT ("generationId") DO UPDATE'));
    expect(upsertSql).toContain('"AdminWorkFeed"."sourceEventId" < EXCLUDED."sourceEventId"');
    expect(projectionSql.some((sql) => sql.includes('INSERT INTO "AnalyticsDailyByUser"'))).toBe(true);
    expect(projectionSql.some((sql) => sql.includes('INSERT INTO "AdminUserSummary"'))).toBe(true);
    expect(projectionSql.some((sql) => sql.startsWith("SAVEPOINT"))).toBe(true);
    expect(projectionSql.some((sql) => sql.startsWith("RELEASE SAVEPOINT"))).toBe(true);
  });

  it("hydrates a missing generation size from the mounted uploads directory before projection", async () => {
    const uploadsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "admin-event-size-"));
    process.env.UPLOADS_DIR = uploadsRoot;
    await fs.writeFile(path.join(uploadsRoot, "result.png"), Buffer.alloc(321));

    const event = {
      id: 13,
      eventType: "generation.update",
      entityType: "generation",
      entityId: "43",
      userId: "device-a",
      authUserId: 7,
      occurredAt: new Date("2026-07-16T00:00:00.000Z"),
      attempts: 1,
    };
    const generation = {
      id: 43,
      userId: "device-a",
      authUserId: 7,
      type: "image_edit",
      status: "success",
      source: "canvas",
      externalProvider: null,
      model: "model-a",
      localPath: "/uploads/result.png",
      templateData: null,
      errorMsg: null,
      createdAt: new Date("2026-07-16T00:00:00.000Z"),
      updatedAt: new Date("2026-07-16T00:01:00.000Z"),
      finishedAt: new Date("2026-07-16T00:01:00.000Z"),
      sizeBytes: null,
    };
    const projectionCalls: Array<{ sql: string; args: unknown[] }> = [];
    const tx = {
      $queryRawUnsafe: async (sql: string, ...args: unknown[]) => {
        projectionCalls.push({ sql, args });
        if (sql.includes("pg_try_advisory_xact_lock")) return [{ acquired: true }];
        if (sql.includes("WITH claimable")) return [event];
        if (sql.includes('INSERT INTO "AdminWorkFeed"')) return [{ generationId: 43 }];
        return [];
      },
      $executeRawUnsafe: async () => 1,
      adminWorkFeed: {
        findUnique: async () => null,
        aggregate: async () => ({ _max: { createdAt: generation.createdAt } }),
        findMany: async () => [{ userId: generation.userId }],
      },
      analyticsDailyByUser: { findMany: async () => [] },
      user: { findUnique: async () => ({ username: "tester" }) },
      generation: {
        findUnique: async () => generation,
        update: async ({ data }: any) => ({ ...generation, ...data }),
      },
      adminEvent: { update: async () => ({}) },
    };
    const db = { $transaction: (run: (client: typeof tx) => unknown) => run(tx) };

    try {
      const result = await processAdminEvents(10, { db: db as any, workerId: "worker-test" });
      const upsert = projectionCalls.find((call) => call.sql.includes('INSERT INTO "AdminWorkFeed"'));

      expect(result).toEqual(expect.objectContaining({ processed: 1, updatedGenerations: 1 }));
      expect(upsert?.args[14]).toBe(321);
      expect(upsert?.args[15]).toBe(BigInt(321));
    } finally {
      await fs.rm(uploadsRoot, { recursive: true, force: true });
    }
  });

  it("tombstones a deleted user summary before marking the event done", async () => {
    const operations: string[] = [];
    const event = {
      id: 14,
      eventType: "user_deleted",
      entityType: "user",
      entityId: "6",
      userId: "6",
      authUserId: 6,
      payload: { linkedGuestUserIds: ["device-a"] },
      occurredAt: new Date("2026-07-17T05:00:00.000Z"),
      attempts: 1,
    };
    let rawCall = 0;
    const tx = {
      $queryRawUnsafe: async () => (++rawCall === 1 ? [{ acquired: true }] : [event]),
      $executeRawUnsafe: async () => 1,
      adminUserSummary: {
        updateMany: async () => {
          operations.push("summary");
          return { count: 2 };
        },
      },
      adminEvent: {
        update: async ({ data }: any) => {
          operations.push(data.status);
          return {};
        },
      },
    };
    const db = { $transaction: (run: (client: typeof tx) => unknown) => run(tx) };

    await expect(processAdminEvents(10, { db: db as any, workerId: "worker-test" }))
      .resolves.toEqual(expect.objectContaining({ processed: 1, failed: 0 }));
    expect(operations).toEqual(["summary", "done"]);
  });
});
