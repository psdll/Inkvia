import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { materialAsset: mocks } }));
vi.mock("@/lib/server-auth", () => ({ getCurrentUser: async (request: Request) => ({ id: Number(request.headers.get("x-test-user")) }) }));
import { GET } from "@/app/api/material-assets/selection-state/route";

const row = { id: 1, selectedByUserId: 1, selectedAt: new Date(0), selectedMediaId: null, selectedByUser: { id: 1, username: "owner" }, _count: { downloads: 0 } };
const request = (ids: string, user = 1) => new Request(`http://localhost/api/material-assets/selection-state?ids=${ids}`, { headers: { "x-test-user": String(user) } }) as any;
beforeEach(() => { vi.clearAllMocks(); mocks.findMany.mockResolvedValue([row]); });

it("bounds a request to 200 material IDs even for a 10000-item caller", async () => {
  const response = await GET(request(Array.from({ length: 10000 }, (_, i) => i + 1).join(",")));
  expect(response.status).toBe(200);
  expect(mocks.findMany.mock.calls[0][0].where.id.in).toHaveLength(200);
});

it("shares an in-flight lookup across 100 users without sharing user-specific flags", async () => {
  const releases: Array<(value: typeof row[]) => void> = [];
  mocks.findMany.mockImplementation(() => new Promise(resolve => { releases.push(resolve); }));
  const pending = Array.from({ length: 100 }, (_, i) => GET(request(i % 2 ? "2,1" : "1,2", i + 1)));
  await Promise.resolve(); await Promise.resolve();
  const queryCount = mocks.findMany.mock.calls.length;
  // Resolve every call even on the unfixed implementation, so a failure cannot hang the test.
  releases.forEach(release => release([row]));
  const results = await Promise.all(pending.map(async result => (await (await result).json()).items[0]));
  expect(queryCount).toBe(1);
  expect(results[0].isSelectedByMe).toBe(true);
  expect(results.slice(1).every(item => !item.isSelectedByMe)).toBe(true);
  mocks.findMany.mockResolvedValue([{ ...row, selectedByUserId: 2 }]);
  expect((await (await GET(request("1,2", 2))).json()).items[0].isSelectedByMe).toBe(true);
  expect(mocks.findMany).toHaveBeenCalledTimes(2);
});

it("releases failed shared queries so the next request can recover", async () => {
  mocks.findMany.mockRejectedValueOnce(new Error("temporary failure"));
  expect((await GET(request("1"))).status).toBe(500);
  expect((await GET(request("1"))).status).toBe(200);
  expect(mocks.findMany).toHaveBeenCalledTimes(2);
});
