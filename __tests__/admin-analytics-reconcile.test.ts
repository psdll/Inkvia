import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  rebuildWorkFeed: vi.fn(async () => 2),
}));

const tx = {
  $queryRawUnsafe: vi.fn(async (sql: string) => {
    if (sql.includes("pg_try_advisory_xact_lock")) return [{ acquired: true }];
    if (sql.includes("FULL OUTER JOIN")) return [{ count: BigInt(0) }];
    if (sql.includes("daily_updated")) return [{ scanned: 2, buckets: 1, upserted: 1, deleted: 0 }];
    if (sql.includes('FROM "AdminWorkFeed"')) return [];
    return [];
  }),
  $executeRawUnsafe: mocks.execute,
  analyticsDailyByUser: {
    findMany: vi.fn(async () => []),
  },
  adminWorkFeed: { findMany: vi.fn(async () => []) },
  adminUserSummary: { findMany: vi.fn(async () => []) },
  user: { findMany: vi.fn(async () => []) },
  appSetting: {
    findUnique: vi.fn(async () => null),
    upsert: vi.fn(async () => ({})),
  },
};

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
  generation: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("@/lib/admin-operational", () => ({
  rebuildAdminWorkFeedFromGeneration: mocks.rebuildWorkFeed,
}));

import {
  measureAdminReadModelDiff,
  measureAdminUserSummaryDiff,
  rebuildRecentDailyAnalytics,
} from "@/lib/admin-analytics-rollup";

describe("admin daily analytics reconciliation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("replaces the target range from a database aggregate under the event lease", async () => {
    const result = await rebuildRecentDailyAnalytics(3);

    expect(result).toEqual({ scanned: 2, buckets: 1, leaseAcquired: true });
    const sql = String(tx.$queryRawUnsafe.mock.calls.find(([value]) => String(value).includes("daily_updated"))?.[0] || "");
    expect(sql).toContain("daily_inserted");
    expect(sql).toContain("WHERE NOT EXISTS");
    expect(sql).toContain("IS DISTINCT FROM");
    expect(sql).toContain("daily_deleted");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(prismaMock.generation.findMany).not.toHaveBeenCalled();
  });

  it("repairs the lifecycle read model before a weekly full reconciliation", async () => {
    await rebuildRecentDailyAnalytics("all");
    expect(mocks.rebuildWorkFeed).toHaveBeenCalledWith(1000, tx);
  });

  it("compares every generation-derived summary aggregate before declaring parity", async () => {
    await measureAdminUserSummaryDiff(tx);
    const sql = String(tx.$queryRawUnsafe.mock.calls.at(-1)?.[0] || "");
    for (const field of [
      "todayTaskCount",
      "last7TaskCount",
      "last30TaskCount",
      "totalTaskCount",
      "successTaskCount",
      "failedTaskCount",
      "successRate30d",
      "failedCount30d",
      "storageBytes",
      "assetCount",
      "deviceCount",
      "linkedUserIds",
    ]) {
      expect(sql).toContain(`summary."${field}"`);
    }
  });

  it("compares canonical display and error fields before declaring work-feed parity", async () => {
    await measureAdminReadModelDiff(tx);
    const sql = String(tx.$queryRawUnsafe.mock.calls.at(-1)?.[0] || "");
    expect(sql).toContain("pg_input_is_valid");
    for (const field of ["thumbUrl", "previewUrl", "displayUrl", "posterUrl", "errorCode"]) {
      expect(sql).toContain(`feed.\"${field}\"`);
    }
  });
});
