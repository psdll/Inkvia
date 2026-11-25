import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  updateMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  eventCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRequest: mocks.requireAdminRequest,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    materialAsset: {
      updateMany: mocks.updateMany,
      findFirst: mocks.findFirst,
      update: mocks.update,
    },
    materialAssetSelectionEvent: {
      create: mocks.eventCreate,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/material-asset-media", () => ({
  selectedMediaSnapshot: () => ({
    selectedMediaId: null,
    selectedMediaUrl: null,
  }),
}));

describe("expired unselected material relisting", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T12:00:00.000Z"));
    mocks.requireAdminRequest.mockReturnValue({ ok: true, username: "admin" });
    mocks.updateMany.mockResolvedValue({ count: 3 });
    mocks.update.mockResolvedValue({ id: 12 });
    mocks.eventCreate.mockResolvedValue({ id: 1 });
    mocks.transaction.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retires bulk age-based relisting without changing materials", async () => {
    const routePath = resolve(
      process.cwd(),
      "app/api/admin/material-assets/relist-expired/route.ts",
    );
    expect(existsSync(routePath)).toBe(true);
    const { POST } =
      await import("@/app/api/admin/material-assets/relist-expired/route");

    const response = await POST(
      new Request("http://localhost/api/admin/material-assets/relist-expired", {
        method: "POST",
      }) as any,
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: "MATERIAL_ARCHIVE_RETIRED" });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated bulk relisting", async () => {
    mocks.requireAdminRequest.mockReturnValue({
      ok: false,
      error: "未登录管理员",
    });
    const routePath = resolve(
      process.cwd(),
      "app/api/admin/material-assets/relist-expired/route.ts",
    );
    expect(existsSync(routePath)).toBe(true);
    const { POST } =
      await import("@/app/api/admin/material-assets/relist-expired/route");

    const response = await POST(
      new Request("http://localhost/api/admin/material-assets/relist-expired", {
        method: "POST",
      }) as any,
    );

    expect(response.status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("refreshes the listing time when an individually selected material is released", async () => {
    mocks.findFirst.mockResolvedValue({
      id: 12,
      title: "客厅素材",
      category: "未分类",
      imageUrl: "/uploads/material.jpg",
      thumbnailUrl: null,
      selectedByUserId: 7,
      selectedByUser: { id: 7, username: "user7" },
      selectedMediaId: null,
    });
    const { POST } =
      await import("@/app/api/admin/material-assets/[id]/release/route");

    const response = await POST(
      new Request("http://localhost/api/admin/material-assets/12/release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }) as any,
      { params: { id: "12" } },
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: {
        selectedByUserId: null,
        selectedAt: null,
        selectedMediaId: null,
        listedAt: new Date("2026-08-07T12:00:00.000Z"),
      },
      select: { id: true },
    });
  });
});

it.each(['GET','POST'] as const)('retires the archive settings %s without persisting old configuration', async method => {
  mocks.requireAdminRequest.mockReturnValue({ ok: true });
  const route = await import('@/app/api/admin/settings/material-archive/route');
  const response = await route[method](new Request('http://localhost/api/admin/settings/material-archive', { method }) as any);
  expect(response.status).toBe(410);
  expect(await response.json()).toMatchObject({ code: 'MATERIAL_ARCHIVE_RETIRED' });
});
