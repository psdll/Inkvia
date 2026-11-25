import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn(), feed: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { generation: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } } }));
vi.mock('@/lib/server-auth', () => ({ getUserId: async () => 1 }));
vi.mock('@/lib/admin-asset-feed', () => ({ upsertAdminAssetFeedForGenerationId: mocks.feed }));
import { POST } from '@/app/api/history/cleanup/route';
it.each(['success', 'failed', 'cancelled', 'running'])('cancels only in-progress rows atomically (%s)', async status => {
  mocks.findUnique.mockResolvedValue({ id: 42, authUserId: 1, status: 'running' });
  // The state can change after findUnique; emulate the database WHERE predicate.
  mocks.updateMany.mockImplementation(async ({ where, data }) => {
    expect(where).toMatchObject({ id: 42, authUserId: 1 });
    expect(data.status).toBe('cancelled');
    return { count: where.status.in.includes(status) ? 1 : 0 };
  });
  mocks.feed.mockResolvedValue(null);
  const response = await POST(new NextRequest('http://localhost/api/history/cleanup', { method: 'POST', body: JSON.stringify({ action: 'cancel_single', generationId: 42 }) }));
  expect(await response.json()).toMatchObject({ success: true, updated: status === 'running' ? 1 : 0 });
});
