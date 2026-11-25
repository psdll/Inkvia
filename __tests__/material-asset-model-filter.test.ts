import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  getCurrentUser: vi.fn(),
  isMaterialCreatorInspirationEnabled: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    materialAsset: {
      groupBy: mocks.groupBy,
      findMany: mocks.findMany,
      count: mocks.count,
    },
  },
}));

vi.mock("@/lib/server-auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock("@/lib/material-creator-permissions", () => ({
  isMaterialCreatorInspirationEnabled:
    mocks.isMaterialCreatorInspirationEnabled,
}));

import { GET as getMaterialAssetCategories } from "@/app/api/material-assets/categories/route";
import { GET as getMaterialAssets } from "@/app/api/material-assets/route";

function request(path: string) {
  return new Request(`http://localhost${path}`) as any;
}

function hasKeyDeep(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasKeyDeep(item, key));
  const record = value as Record<string, unknown>;
  return (
    Object.prototype.hasOwnProperty.call(record, key) ||
    Object.values(record).some((item) => hasKeyDeep(item, key))
  );
}

function expectWhereToInclude(where: any, key: string, value: string) {
  const conditions = Array.isArray(where?.AND) ? where.AND : [];
  const found = conditions.some((condition: any) => {
    const actual = condition?.[key];
    return actual === value || actual?.equals === value;
  });
  expect(found).toBe(true);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.groupBy.mockResolvedValue([]);
  mocks.findMany.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
  mocks.getCurrentUser.mockResolvedValue(null);
  mocks.isMaterialCreatorInspirationEnabled.mockResolvedValue(false);
});

describe("material asset category model groups", () => {
  it("keeps categories without models and groups distinct active non-blank models by category", async () => {
    mocks.groupBy.mockResolvedValue([
      { category: "按摩椅", modelName: "M616" },
      { category: "按摩椅", modelName: "M616" },
      { category: "按摩椅", modelName: " M717 " },
      { category: "按摩椅", modelName: "   " },
      { category: "净化器", modelName: null },
      { category: "美容仪", modelName: "M616" },
    ]);

    const response = await getMaterialAssetCategories(
      request("/api/material-assets/categories"),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.categories).toEqual(["按摩椅", "净化器", "美容仪"]);
    expect(data.hasUngrouped).toBe(false);
    expect(data.modelGroups).toEqual([
      { category: "按摩椅", models: ["M616", "M717"] },
      { category: "美容仪", models: ["M616"] },
    ]);

    expect(mocks.groupBy).toHaveBeenCalledTimes(1);
    const [modelQuery] = mocks.groupBy.mock.calls[0];
    expect(modelQuery).toMatchObject({
      by: ["category", "modelName"],
      where: {
        isDeleted: false,
      },
    });
  });
});

describe("GET /api/material-assets model filtering", () => {
  it("adds category and modelName to findMany and all four count filters", async () => {
    const response = await getMaterialAssets(
      request(
        "/api/material-assets?category=%E6%8C%89%E6%91%A9%E6%A4%85&modelName=M616",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.count).toHaveBeenCalledTimes(4);

    const findManyWhere = mocks.findMany.mock.calls[0][0].where;
    expectWhereToInclude(findManyWhere, "category", "按摩椅");
    expectWhereToInclude(findManyWhere, "modelName", "M616");

    for (const [{ where }] of mocks.count.mock.calls) {
      expectWhereToInclude(where, "category", "按摩椅");
      expectWhereToInclude(where, "modelName", "M616");
    }
  });

  it.each([
    ["omitted", ""],
    ["blank", "&modelName=%20%20%20"],
  ])(
    "does not add a modelName filter when the parameter is %s",
    async (_label, suffix) => {
      const response = await getMaterialAssets(
        request(
          `/api/material-assets?category=%E6%8C%89%E6%91%A9%E6%A4%85${suffix}`,
        ),
      );

      expect(response.status).toBe(200);
      expect(mocks.findMany).toHaveBeenCalledTimes(1);
      expect(mocks.count).toHaveBeenCalledTimes(4);

      const whereValues = [
        mocks.findMany.mock.calls[0][0].where,
        ...mocks.count.mock.calls.map(([{ where }]) => where),
      ];
      for (const where of whereValues) {
        expect(hasKeyDeep(where, "modelName")).toBe(false);
      }
    },
  );

  it("keeps old and relisted materials in the available view", async () => {
    const response = await getMaterialAssets(
      request("/api/material-assets?status=available"),
    );

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.findMany.mock.calls[0][0].where.AND).toContainEqual({ selectedByUserId: null });
    expect(hasKeyDeep(mocks.findMany.mock.calls[0][0].where, "listedAt")).toBe(false);
    expect(hasKeyDeep(mocks.findMany.mock.calls[0][0].where, "createdAt")).toBe(false);
    expect(mocks.findMany.mock.calls[0][0].orderBy).toEqual([
      { sortOrder: "asc" },
      { listedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "desc" },
    ]);
  });

  it("maps the earlier-unselected view to all available history", async () => {
    const response = await getMaterialAssets(
      request("/api/material-assets?status=available_archived"),
    );

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.findMany.mock.calls[0][0].where.AND).toContainEqual({ selectedByUserId: null });
    expect(hasKeyDeep(mocks.findMany.mock.calls[0][0].where, "listedAt")).toBe(false);
    expect(hasKeyDeep(mocks.findMany.mock.calls[0][0].where, "createdAt")).toBe(false);
  });
});

it.each([null, ""])("reports an unclassified category only when materials exist (%s)", async category => {
  mocks.groupBy.mockResolvedValue([{ category, modelName: null }]);
  const data = await (await getMaterialAssetCategories(request("/api/material-assets/categories"))).json();
  expect(data).toMatchObject({ categories: [], hasUngrouped: true });
  mocks.groupBy.mockResolvedValue([]);
  const empty = await (await getMaterialAssetCategories(request("/api/material-assets/categories"))).json();
  expect(empty).toMatchObject({ categories: [], hasUngrouped: false });
});
