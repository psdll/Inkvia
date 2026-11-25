import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  appSetting: {
    findUnique: vi.fn(),
  },
  adminUserSummary: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import {
  decodeAdminSummaryPageCursor,
  decodeAdminSummaryCursor,
  encodeAdminSummaryCursor,
  getAdminUserSummaryChanges,
  isAdminSummaryReadModelEnabled,
  isAdminSummaryReadModelReady,
  listAdminUserSummariesFromReadModel,
  tombstoneAdminUserSummary,
} from "@/lib/admin-user-summary-read-model";

const row = (adminKey: string, updatedAt: string, overrides: Record<string, unknown> = {}) => ({
  adminKey,
  userId: adminKey.split(":")[1],
  authUserId: adminKey.startsWith("auth:") ? Number(adminKey.split(":")[1]) : null,
  username: null,
  lastActiveAt: new Date(updatedAt),
  totalTaskCount: 4,
  deviceCount: 1,
  linkedUserIds: [adminKey.split(":")[1]],
  updatedAt: new Date(updatedAt),
  deletedAt: null,
  ...overrides,
});

describe("admin user summary read model", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the summary read model disabled until explicitly enabled", () => {
    expect(isAdminSummaryReadModelEnabled({})).toBe(false);
    expect(isAdminSummaryReadModelEnabled({ ADMIN_SUMMARY_READ_MODEL: "0" })).toBe(false);
    expect(isAdminSummaryReadModelEnabled({ ADMIN_SUMMARY_READ_MODEL: "true" })).toBe(false);
    expect(isAdminSummaryReadModelEnabled({ ADMIN_SUMMARY_READ_MODEL: "1" })).toBe(true);
  });

  it("waits for the completed backfill marker before serving the read model", async () => {
    prismaMock.appSetting.findUnique.mockResolvedValueOnce(null);
    await expect(isAdminSummaryReadModelReady({ ADMIN_SUMMARY_READ_MODEL: "1" })).resolves.toBe(false);

    prismaMock.appSetting.findUnique.mockResolvedValueOnce({
      value: JSON.stringify({ version: 1, completedAt: "2026-07-17T00:00:00.000Z" }),
    });
    await expect(isAdminSummaryReadModelReady({ ADMIN_SUMMARY_READ_MODEL: "1" })).resolves.toBe(true);
    await expect(isAdminSummaryReadModelReady({ ADMIN_SUMMARY_READ_MODEL: "0" })).resolves.toBe(false);
  });

  it("round-trips a composite updatedAt and adminKey cursor", () => {
    const value = { updatedAt: new Date("2026-07-16T00:00:00.000Z"), adminKey: "auth:7" };
    expect(decodeAdminSummaryCursor(encodeAdminSummaryCursor(value))).toEqual(value);
    expect(() => decodeAdminSummaryCursor("broken")).toThrow("invalid summary cursor");
  });

  it("reads the initial user list only from AdminUserSummary and returns a safe high water", async () => {
    prismaMock.adminUserSummary.findFirst.mockResolvedValue(row("auth:9", "2026-07-16T00:00:02.000Z"));
    prismaMock.adminUserSummary.findMany.mockResolvedValue([
      row("auth:9", "2026-07-16T00:00:02.000Z"),
      row("auth:7", "2026-07-16T00:00:01.000Z"),
    ]);

    const result = await listAdminUserSummariesFromReadModel(200);

    expect(result.items.map((item) => item.adminKey)).toEqual(["auth:9", "auth:7"]);
    expect(result.items[0]).toEqual(expect.objectContaining({ generationCount: 4, linkedUserIds: ["9"] }));
    expect(result.hasMore).toBe(false);
    expect(result.nextPageCursor).toBeNull();
    expect(prismaMock.adminUserSummary.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deletedAt: null },
    }));
    expect(decodeAdminSummaryCursor(result.summaryCursor!)).toEqual({
      updatedAt: new Date("2026-07-16T00:00:02.000Z"),
      adminKey: "auth:9",
    });
  });

  it("paginates every active summary without a hard 1000-user cutoff", async () => {
    prismaMock.adminUserSummary.findFirst.mockResolvedValue(row("auth:9", "2026-07-16T00:00:02.000Z"));
    prismaMock.adminUserSummary.findMany.mockResolvedValue([
      row("auth:9", "2026-07-16T00:00:02.000Z"),
      row("auth:8", "2026-07-16T00:00:01.000Z"),
    ]);

    const first = await listAdminUserSummariesFromReadModel({ limit: 1 });
    expect(first.items.map((item) => item.adminKey)).toEqual(["auth:9"]);
    expect(first.hasMore).toBe(true);
    expect(decodeAdminSummaryPageCursor(first.nextPageCursor!)).toEqual({
      lastActiveAt: new Date("2026-07-16T00:00:02.000Z"),
      adminKey: "auth:9",
    });

    prismaMock.adminUserSummary.findMany.mockReset();
    prismaMock.adminUserSummary.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row("auth:8", "2026-07-16T00:00:01.000Z")])
      .mockResolvedValueOnce([]);
    await listAdminUserSummariesFromReadModel({ limit: 1, pageCursor: first.nextPageCursor });
    expect(prismaMock.adminUserSummary.findMany).toHaveBeenCalledTimes(3);
    expect(prismaMock.adminUserSummary.findMany.mock.calls.map(([args]) => args.where)).toEqual([
      { deletedAt: null, lastActiveAt: new Date("2026-07-16T00:00:02.000Z"), adminKey: { gt: "auth:9" } },
      { deletedAt: null, lastActiveAt: { lt: new Date("2026-07-16T00:00:02.000Z") } },
      { deletedAt: null, lastActiveAt: null },
    ]);
  });

  it("uses both cursor fields so same-millisecond user updates are not lost", async () => {
    prismaMock.adminUserSummary.findMany
      .mockResolvedValueOnce([
        row("auth:8", "2026-07-16T00:00:00.000Z"),
        row("auth:9", "2026-07-16T00:00:00.000Z"),
      ])
      .mockResolvedValueOnce([]);
    const cursor = encodeAdminSummaryCursor({
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      adminKey: "auth:7",
    });

    const result = await getAdminUserSummaryChanges({ cursor, limit: 100 });

    expect(prismaMock.adminUserSummary.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { updatedAt: new Date("2026-07-16T00:00:00.000Z"), adminKey: { gt: "auth:7" } },
      orderBy: [{ updatedAt: "asc" }, { adminKey: "asc" }],
      take: 101,
    }));
    expect(prismaMock.adminUserSummary.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { updatedAt: { gt: new Date("2026-07-16T00:00:00.000Z") } },
      orderBy: [{ updatedAt: "asc" }, { adminKey: "asc" }],
      take: 101,
    }));
    expect(result.items.map((item) => item.adminKey)).toEqual(["auth:8", "auth:9"]);
    expect(result.deletedAdminKeys).toEqual([]);
    expect(decodeAdminSummaryCursor(result.nextCursor)).toEqual({
      updatedAt: new Date("2026-07-16T00:00:00.000Z"),
      adminKey: "auth:9",
    });
  });

  it("returns tombstones separately so the client removes merged guest identities", async () => {
    prismaMock.adminUserSummary.findMany
      .mockResolvedValueOnce([
        row("guest:device-a", "2026-07-16T00:00:01.000Z", { deletedAt: new Date("2026-07-16T00:00:01.000Z") }),
      ])
      .mockResolvedValueOnce([]);
    const result = await getAdminUserSummaryChanges({ limit: 100 });
    expect(result.items).toEqual([]);
    expect(result.deletedAdminKeys).toEqual(["guest:device-a"]);
  });

  it("tombstones authenticated and linked guest summaries idempotently", async () => {
    const deletedAt = new Date("2026-07-17T05:00:00.000Z");
    prismaMock.adminUserSummary.updateMany.mockResolvedValue({ count: 2 });

    await expect(tombstoneAdminUserSummary({
      userId: "6",
      authUserId: 6,
      linkedGuestUserIds: ["device-a", "device-a", ""],
      deletedAt,
    })).resolves.toEqual({ count: 2 });

    expect(prismaMock.adminUserSummary.updateMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        OR: [
          { adminKey: "auth:6" },
          { authUserId: 6 },
          { adminKey: { in: ["guest:device-a"] } },
        ],
      },
      data: { deletedAt, updatedAt: deletedAt },
    });
  });
});
