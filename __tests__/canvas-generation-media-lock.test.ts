import { expect, it, vi } from 'vitest';
import { getOrCreateGenerationMediaAsset } from '@/lib/canvas/generation-media';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/canvas/prepare-previews', () => ({ prepareCanvasPreviews: vi.fn(async () => undefined) }));
it('binds an existing result with the PostgreSQL two-integer advisory lock', async () => {
 const checkLock = (sql: any) => {
  const query = sql.strings.join('?');
  if (query.includes('pg_advisory_xact_lock')) {
   // Prisma sends interpolated JS integers as int8; both arguments must match int4.
   expect(query).toMatch(/pg_advisory_xact_lock\(9122026, \?::int\)/);
   return true;
  }
  return false;
 };
 const tx = {
  $executeRaw: vi.fn(async sql => { checkLock(sql); return 1; }),
  $queryRaw: vi.fn(async sql => checkLock(sql) ? [] : [{ id: 'existing-media', publicUrl: '/uploads/result.mp4' }]),
 };
 const client = { $transaction: (fn: any) => fn(tx) } as any;
 await expect(getOrCreateGenerationMediaAsset(client, { id: 45704, authUserId: 1, type: 'video_gen', localPath: '/uploads/result.mp4' })).resolves.toEqual({ mediaId: 'existing-media', url: '/uploads/result.mp4' });
});
