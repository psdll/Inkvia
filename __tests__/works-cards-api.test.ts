import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const db = vi.hoisted(() => ({ generation: { findMany: vi.fn(), findFirst: vi.fn() }, $queryRaw: vi.fn(), log: { findMany: vi.fn(async () => []) }, generationInputMedia: { findMany: vi.fn(async () => []) }, imageBatchOutput: { findMany: vi.fn(async () => []) }, liveVideoBatchOutput: { findMany: vi.fn(async () => []) } }));
vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/server-auth', () => ({ getUserId: async () => 7 }));
vi.mock('@/lib/admin-auth', () => ({ isAdminRequest: () => false }));
vi.mock('@/lib/inspiration-template-service', () => ({ getUserInspirationTemplatesByGenerationIds: async () => new Map() }));
import { GET } from '@/app/api/assets/route';
const row = { id: 9, type: 'image_edit', source: 'tool', status: 'success', authUserId: 7, userId: '7', prompt: '测试', externalTaskId: 'group-a', createdAt: new Date('2026-09-28'), localPath: '/uploads/full.png', templateData: JSON.stringify({ outputThumbUrl: '/uploads/thumb.webp', imagePaths: ['/uploads/input.png'], seed: 42 }) };
beforeEach(() => { vi.clearAllMocks(); db.generation.findMany.mockResolvedValue([row, { ...row, id: 8, localPath: '/uploads/second.png' }]); db.generation.findFirst.mockResolvedValue(row); });
it('returns small grouped cards without loading logs, input media or full parameters', async () => {
  const response = await GET(new NextRequest('http://localhost/api/assets?view=cards&take=60'));
  const { items } = await response.json();
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ id: 9, thumbUrl: '/uploads/thumb.webp', detailPending: true, outputPaths: ['/uploads/full.png', '/uploads/second.png'] });
  expect(items[0]).not.toHaveProperty('templateData');
  expect(items[0]).not.toHaveProperty('authUserId');
  expect(items[0].params).not.toHaveProperty('seed');
  expect(db.log.findMany).not.toHaveBeenCalled();
  expect(db.generationInputMedia.findMany).not.toHaveBeenCalled();
});
it('loads full group details with the same ownership filter', async () => {
  const response = await GET(new NextRequest('http://localhost/api/assets?detailId=9&source=all'));
  const { item } = await response.json();
  expect(item).toMatchObject({ id: 9, params: { seed: 42 }, inputImages: ['/uploads/input.png'] });
  expect(JSON.stringify(db.generation.findFirst.mock.calls[0][0].where)).toContain('"authUserId":7');
  expect(JSON.stringify(db.generation.findMany.mock.calls[0][0].where)).toContain('"authUserId":7');
});
it('does not disclose a different owner asset or load its group', async () => {
  db.generation.findFirst.mockResolvedValue(null);
  const response = await GET(new NextRequest('http://localhost/api/assets?detailId=999&source=all'));
  expect(response.status).toBe(404);
  expect(db.generation.findMany).not.toHaveBeenCalled();
});

it('continues from the cursor timestamp even if the cursor row was deleted', async () => {
  const cursor = Buffer.from(JSON.stringify({ id: 10, createdAt: '2026-09-28T00:00:00.000Z' })).toString('base64url');
  await GET(new NextRequest(`http://localhost/api/assets?view=cards&take=60&cursor=${cursor}`));
  const query = db.generation.findMany.mock.calls[0][0];
  expect(query).not.toHaveProperty('cursor');
  expect(query.where.AND[1].OR).toEqual([{ createdAt: { lt: new Date('2026-09-28') } }, { createdAt: new Date('2026-09-28'), id: { lt: 10 } }]);
});

it('orders ascending pages and advances the cursor forward', async () => {
  db.generation.findMany.mockResolvedValue([
    { ...row, id: 1, externalTaskId: 'old', createdAt: new Date('2026-09-01') },
    { ...row, id: 2, externalTaskId: 'new', createdAt: new Date('2026-09-02') },
  ]);
  const cursor = Buffer.from(JSON.stringify({ id: 10, createdAt: '2026-08-31T00:00:00.000Z' })).toString('base64url');
  const response = await GET(new NextRequest(`http://localhost/api/assets?view=cards&take=60&order=asc&cursor=${cursor}`));
  const query = db.generation.findMany.mock.calls[0][0];
  expect(query.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  expect(query.where.AND[1].OR).toEqual([{ createdAt: { gt: new Date('2026-08-31') } }, { createdAt: new Date('2026-08-31'), id: { gt: 10 } }]);
  expect((await response.json()).items.map((item: any) => item.id)).toEqual([1, 2]);
});

it('filters image cards while retaining account ownership', async () => {
  await GET(new NextRequest('http://localhost/api/assets?view=cards&type=image'));
  const where = JSON.stringify(db.generation.findMany.mock.calls[0][0].where);
  expect(where).toContain('"authUserId":7');
  expect(where).toContain('"type":{"in":["image_edit","face_swap"]}');
});
