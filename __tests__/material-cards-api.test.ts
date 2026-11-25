import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn(), metadata: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { materialAsset: mocks } }));
vi.mock("@/lib/server-auth", () => ({ getCurrentUser: async () => ({ id: 7, username: "tester" }) }));
vi.mock("@/lib/material-creator-permissions", () => ({ isMaterialCreatorInspirationEnabled: async () => false }));
vi.mock("sharp", () => ({ default: () => ({ metadata: mocks.metadata }) }));
import { GET } from "@/app/api/material-assets/route";
const row = (id: number) => ({ id, title: `Material ${id}`, imageUrl: `/sample/${id}.jpg`, media: [{ id: `m${id}`, originalUrl: `/sample/${id}.jpg`, width: 1200, height: 800 }], createdAt: new Date('2026-09-01'), listedAt: new Date('2026-09-01'), sortOrder: 0 });
beforeEach(() => { vi.clearAllMocks(); mocks.count.mockResolvedValue(100); mocks.findMany.mockResolvedValue(Array.from({ length: 25 }, (_, i) => row(100-i))); });
it('shares in-flight summary counts across 100 identical readers but isolates filters', async () => {
  const releases: Array<(value: number) => void> = [];
  mocks.count.mockImplementation(() => new Promise(resolve => { releases.push(resolve); }));
  const pending = Array.from({ length: 100 }, () => GET(new Request('http://localhost/api/material-assets?view=summary') as any));
  await Promise.resolve(); await Promise.resolve();
  const sharedCalls = mocks.count.mock.calls.length;
  const other = GET(new Request('http://localhost/api/material-assets?view=summary&q=different') as any);
  await Promise.resolve(); await Promise.resolve();
  const filteredCalls = mocks.count.mock.calls.length - sharedCalls;
  releases.forEach(resolve => resolve(100));
  const responses = await Promise.all([...pending, other]);
  expect(responses.every(response => response.status === 200)).toBe(true);
  expect(sharedCalls).toBe(4);
  expect(filteredCalls).toBe(4);
  mocks.count.mockResolvedValue(101);
  const fresh = await (await GET(new Request('http://localhost/api/material-assets?view=summary') as any)).json();
  expect(fresh.total).toBe(101);
});
it("returns the first cards without waiting for counts or download histories", async () => {
  const response = await GET(new Request('http://localhost/api/material-assets?view=cards&pageSize=24') as any);
  const data = await response.json();
  expect(response.status).toBe(200);
  expect(mocks.count).not.toHaveBeenCalled();
  expect(data.items).toHaveLength(24);
  expect(data.pagination.hasMore).toBe(true);
  expect(data.pagination.nextCursor).toEqual(expect.any(String));
  expect(mocks.findMany.mock.calls[0][0].include.downloads).toBeUndefined();
  expect(data.items[0]).toMatchObject({ previewWidth: 1200, previewHeight: 800 });
  expect(mocks.metadata).not.toHaveBeenCalled();
});
it("continues by the last card and snapshot instead of shifting page offsets", async () => {
  const first = await (await GET(new Request('http://localhost/api/material-assets?view=cards&pageSize=24') as any)).json();
  mocks.findMany.mockClear();
  await GET(new Request(`http://localhost/api/material-assets?view=cards&pageSize=24&page=2&cursor=${encodeURIComponent(first.pagination.nextCursor)}`) as any);
  const query = mocks.findMany.mock.calls[0][0];
  expect(query.skip).toBeUndefined();
  expect(JSON.stringify(query.where)).toContain('"id":{"lt":77}');
  expect(JSON.stringify(query.where)).toContain('"createdAt":{"lte":');
});
it("rejects malformed cursors rather than silently restarting and duplicating cards", async () => {
  const response = await GET(new Request('http://localhost/api/material-assets?view=cards&cursor=invalid') as any);
  expect(response.status).toBe(400);
});

it.each(['all', 'available', 'selected', 'mine', 'archived', 'available_archived'])("keeps historical materials discoverable in %s without an age cutoff", async status => {
  await GET(new Request(`http://localhost/api/material-assets?status=${status}&q=old`) as any);
  const where = mocks.findMany.mock.calls[0][0].where;
  const serialized = JSON.stringify(where);
  expect(serialized).not.toMatch(/selectedAt|listedAt|createdAt/);
  expect(serialized).toContain('"isDeleted":false');
  expect(serialized).toContain('"contains":"old"');
  if (status === 'mine' || status === 'archived') expect(serialized).toContain('"selectedByUserId":7');
  if (status === 'available' || status === 'available_archived') expect(serialized).toContain('"selectedByUserId":null');
  for (const [query] of mocks.count.mock.calls) expect(JSON.stringify(query.where)).not.toMatch(/selectedAt|listedAt|createdAt/);
});

it('still respects an explicitly requested date range', async () => {
  await GET(new Request('http://localhost/api/material-assets?status=all&dateFrom=2026-09-01') as any);
  expect(JSON.stringify(mocks.findMany.mock.calls[0][0].where)).toContain('"createdAt":{"gte":"2026-09-01T00:00:00.000Z"}');
});

it('paginates all my selections, including legacy rows without a selection timestamp', async () => {
  const cursor = Buffer.from(JSON.stringify({ snapshot: '2026-09-28T00:00:00Z', values: ['2025-01-01T00:00:00Z', 99] })).toString('base64url');
  await GET(new Request(`http://localhost/api/material-assets?view=cards&status=mine&cursor=${cursor}`) as any);
  let query = mocks.findMany.mock.calls[0][0];
  expect(query.orderBy[0]).toEqual({ selectedAt: { sort: 'desc', nulls: 'last' } });
  expect(query.where.AND.at(-1).OR).toContainEqual({ selectedAt: null });
  mocks.findMany.mockClear();
  const legacyCursor = Buffer.from(JSON.stringify({ snapshot: '2026-09-28T00:00:00Z', values: [null, 50] })).toString('base64url');
  await GET(new Request(`http://localhost/api/material-assets?view=cards&status=mine&cursor=${legacyCursor}`) as any);
  query = mocks.findMany.mock.calls[0][0];
  expect(query.where.AND.at(-1).OR).toEqual([{ selectedAt: null, id: { lt: 50 } }]);
});
