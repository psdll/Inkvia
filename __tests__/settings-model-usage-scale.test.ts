import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ id: 7 as number | null, raw: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/server-auth", () => ({ getCurrentUser: async () => mocks.id ? { id: mocks.id } : null }));
vi.mock("@/lib/prisma", () => ({ default: { $queryRaw: mocks.raw, generation: { findMany: mocks.findMany } } }));
import { GET } from "@/app/api/settings/model-usage/route";

const request = () => new Request("http://localhost/api/settings/model-usage") as any;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.id = 7;
  mocks.findMany.mockResolvedValue([]);
  mocks.raw.mockImplementation(async (query: any) => query.sql.includes('AS "day"') ? [] : [
    { model: " image-model ", type: "image_gen", status: "success", total: BigInt(10000), last30: BigInt(800), last7: BigInt(120), lastUsedAt: new Date("2026-09-20T10:00:00Z") },
    { model: "image-model", type: "image_edit", status: "FAILED", total: BigInt(20), last30: BigInt(10), last7: BigInt(2), lastUsedAt: new Date("2026-09-21T10:00:00Z") },
    { model: null, type: "video_gen", status: "pending", total: BigInt(5), last30: BigInt(5), last7: BigInt(1), lastUsedAt: new Date("2026-09-22T10:00:00Z") },
  ]);
});

it("computes the same counters from database aggregates without loading 10,000 historical records", async () => {
  const response = await GET(request());
  const body = await response.json();
  expect(body.summary).toEqual({ total: 10025, last30: 815, last7: 123, activeModels30: 2, topModel30: "image-model" });
  expect(body.models[0]).toMatchObject({ model: "image-model", total: 10020, success: 10000, failed: 20, categories: { 图片: 10020 }, lastUsedAt: "2026-09-21T10:00:00.000Z" });
  expect(body.models[1].model).toBe("未标注模型");
  expect(body.trend30).toHaveLength(30);
  expect(body.trend7).toHaveLength(7);
  expect(mocks.findMany).not.toHaveBeenCalled();
  expect(mocks.raw).toHaveBeenCalledTimes(2);
  for (const [query] of mocks.raw.mock.calls) {
    expect(query.sql).toContain('"authUserId" IS NULL');
    expect(query.values).toContain(7);
    expect(query.values).toContain("7");
  }
});

it("shares concurrent reads for one account and drops the result after completion", async () => {
  const releases: Array<() => void> = [];
  mocks.raw.mockImplementation(() => new Promise(resolve => releases.push(() => resolve([]))));
  const pending = Array.from({ length: 100 }, () => GET(request()));
  await Promise.resolve(); await Promise.resolve();
  const readCount = mocks.raw.mock.calls.length;
  releases.forEach(resolve => resolve());
  await Promise.all(pending);
  expect(readCount).toBe(2);
  mocks.raw.mockResolvedValue([]);
  await GET(request());
  expect(mocks.raw).toHaveBeenCalledTimes(4);
});

it("does not share aggregates between accounts", async () => {
  const a = GET(request());
  await Promise.resolve();
  mocks.id = 8;
  const b = GET(request());
  await Promise.all([a, b]);
  expect(mocks.raw).toHaveBeenCalledTimes(4);
});

it("rejects unauthenticated reads before any statistics query", async () => {
  mocks.id = null;
  expect((await GET(request())).status).toBe(401);
  expect(mocks.raw).not.toHaveBeenCalled();
  expect(mocks.findMany).not.toHaveBeenCalled();
});
