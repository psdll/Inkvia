import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
  groupBy: vi.fn(),
  updateMany: vi.fn(),
  listOptions: vi.fn(),
  deleteStoredMediaRefs: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({ requireAdminRequest: mocks.requireAdminRequest }));
vi.mock("@/lib/prisma", () => ({
  default: {
    materialAsset: {
      count: mocks.count,
      findMany: mocks.findMany,
      groupBy: mocks.groupBy,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock("@/lib/material-asset-options", async () => {
  const actual = await vi.importActual<typeof import("@/lib/material-asset-options")>("@/lib/material-asset-options");
  return { ...actual, listMaterialAssetOptionValues: mocks.listOptions };
});
vi.mock("@/lib/media-cleanup", () => ({ deleteStoredMediaRefs: mocks.deleteStoredMediaRefs }));
vi.mock("@/lib/material-asset-media", () => ({ materialAssetAllMediaRefs: () => [] }));

import { DELETE, GET } from "@/app/api/admin/material-assets/route";

function request(path: string) {
  return new Request(`http://localhost${path}`) as any;
}

function containsCondition(value: unknown, key: string, expected: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => containsCondition(entry, key, expected));
  const record = value as Record<string, unknown>;
  if (
    Object.prototype.hasOwnProperty.call(record, key) &&
    JSON.stringify(record[key]) === JSON.stringify(expected)
  ) {
    return true;
  }
  return Object.values(record).some((entry) => containsCondition(entry, key, expected));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdminRequest.mockReturnValue({ ok: true, username: "admin" });
  mocks.count.mockResolvedValue(0);
  mocks.findMany.mockResolvedValue([]);
  mocks.groupBy.mockResolvedValue([
    { category: "按摩椅", modelName: "M616" },
    { category: "按摩椅", modelName: " M717 " },
    { category: "净化器", modelName: "P200" },
  ]);
  mocks.listOptions.mockResolvedValue({
    category: ["按摩椅", "净化器"],
    creator: ["张三"],
    model: ["M616", "M717", "P200"],
  });
  mocks.updateMany.mockResolvedValue({ count: 0 });
  mocks.deleteStoredMediaRefs.mockResolvedValue({
    deletedLocalFiles: 0,
    deletedOssObjects: 0,
    skippedProtectedRefsCount: 0,
    skippedProtectedRefsPreview: [],
    ossError: null,
  });
});

describe("administrator material filters", () => {
  it("returns real category-linked model groups and the global uncategorized flag", async () => {
    mocks.count.mockResolvedValueOnce(1).mockResolvedValueOnce(1);

    const response = await GET(
      request("/api/admin/material-assets?category=%E6%8C%89%E6%91%A9%E6%A4%85&modelName=M616"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.modelGroups).toEqual([
      { category: "按摩椅", models: ["M616", "M717"] },
      { category: "净化器", models: ["P200"] },
    ]);
    expect(data.hasUncategorized).toBe(true);
    expect(containsCondition(mocks.findMany.mock.calls[0][0].where, "modelName", "M616")).toBe(true);
  });

  it("adds modelName to keyword search", async () => {
    await GET(request("/api/admin/material-assets?q=M616"));

    const where = mocks.findMany.mock.calls[0][0].where;
    expect(containsCondition(where, "modelName", { contains: "M616" })).toBe(true);
  });

  it("keeps modelName in idsOnly selection scope", async () => {
    mocks.findMany.mockResolvedValue([{ id: 7 }]);

    const response = await GET(
      request("/api/admin/material-assets?idsOnly=1&category=%E5%87%80%E5%8C%96%E5%99%A8&modelName=P200"),
    );

    await expect(response.json()).resolves.toEqual({ success: true, ids: [7] });
    expect(containsCondition(mocks.findMany.mock.calls[0][0].where, "modelName", "P200")).toBe(true);
  });

  it("keeps modelName and date boundaries in filtered deletion scope", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/admin/material-assets", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "filtered",
          category: "按摩椅",
          modelName: "M717",
          dateFrom: "2026-08-01T00:00:00.000Z",
          dateTo: "2026-08-17T23:59:59.999Z",
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(containsCondition(where, "modelName", "M717")).toBe(true);
    expect(
      containsCondition(where, "createdAt", {
        gte: new Date("2026-08-01T00:00:00.000Z"),
        lte: new Date("2026-08-17T23:59:59.999Z"),
      }),
    ).toBe(true);
  });
});
