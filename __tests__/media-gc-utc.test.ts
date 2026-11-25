import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/media-cleanup", () => ({ collectMediaRefs: vi.fn(), deleteStoredMediaRefs: vi.fn() }));
vi.mock("@/lib/oss", () => ({ deleteOssObjects: vi.fn() }));
vi.mock("@/lib/canvas/observability", () => ({ canvasMetrics: { increment: vi.fn() } }));

import { runCanvasMediaGcBatch } from "@/lib/canvas/media-gc";

describe("media GC uses UTC timestamp columns consistently", () => {
  it("binds expiration and lease times without the database session timezone conversion", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const client = { $transaction: (callback: any) => callback({ $queryRaw: query }) };
    await runCanvasMediaGcBatch(client as never, {
      workerId: "test-gc", now: new Date("2026-09-07T04:11:54.000Z"),
    });
    const sql = query.mock.calls[0][0];
    // Date values are sent as timestamptz by Prisma. The schema's timestamps
    // contain UTC wall times, so these predicates must bind explicit timestamps.
    expect(sql.values.some((value: unknown) => value instanceof Date)).toBe(false);
    expect(sql.values.filter((value: unknown) => value === "2026-09-07T04:11:54.000Z")).toHaveLength(3);
    expect(sql.values).toContain("2026-09-07T04:16:54.000Z");
    expect(sql.text).toMatch(/"retentionUntil" <= \$\d+::timestamp/);
    expect(sql.text).toMatch(/"expiresAt" > \$\d+::timestamp/);
    expect(sql.text).toMatch(/"leaseUntil" = \$\d+::timestamp/);
    expect(sql.text).toContain("CURRENT_TIMESTAMP AT TIME ZONE 'UTC'");
  });
});
