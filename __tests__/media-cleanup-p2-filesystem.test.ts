import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
vi.mock('@/lib/oss', () => ({ isOssReady: () => false, extractOssObjectKeyFromUrl: () => '', deleteOssObjects: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: {
  generation: { findMany: async () => [] }, log: { findMany: async () => [] }, mediaLibraryItem: { findMany: async () => [] },
  materialAsset: { findMany: async () => [] }, canvas: { findMany: async () => [] }, canvasNodeState: { findMany: async () => [] }, mediaAsset: { findMany: async () => [] }, $queryRaw: async () => [],
} }));
import { deleteStoredMediaRefs } from '@/lib/media-cleanup';
afterEach(() => vi.unstubAllEnvs());
it('removes exactly the orphan source and nine variants, preserving shared and out-of-root files', async () => {
  // Temporary files are the entire destructive test target; no real uploads are used.
  const os = await import('node:os');
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'inkvia-p2-cleanup-'));
  const uploads = path.join(parent, 'uploads'); await fs.mkdir(path.join(uploads, '_thumbs'), { recursive: true });
  vi.stubEnv('UPLOADS_DIR', uploads);
  try {
    const orphan = path.join(uploads, 'orphan.png'), shared = path.join(uploads, 'shared.png'), outside = path.join(parent, 'outside.png');
    await Promise.all([orphan, shared, outside].map(file => fs.writeFile(file, 'synthetic')));
    const stat = await fs.stat(orphan);
    const variants = [100,120,200,300,400,600,800,1200,1600].map(width => path.join(uploads, '_thumbs', createHash('sha1').update(orphan).update(String(stat.mtimeMs)).update(`w${width}`).update('q88').digest('hex') + '.webp'));
    await Promise.all(variants.map(file => fs.writeFile(file, 'thumbnail')));
    const result = await deleteStoredMediaRefs(['/uploads/orphan.png', '/uploads/shared.png', '/uploads/../outside.png', outside], { localOnly: true, protectedGenerationComparableRefs: new Set(['/uploads/shared.png']) });
    expect(result.deletedLocalFiles).toBe(10);
    for (const file of [orphan, ...variants]) await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(shared, 'utf8')).toBe('synthetic'); expect(await fs.readFile(outside, 'utf8')).toBe('synthetic');
    expect(result.skippedProtectedRefsPreview).toContain('/uploads/shared.png');
  } finally {
    if (!path.resolve(parent).startsWith(path.resolve(os.tmpdir()) + path.sep + 'inkvia-p2-cleanup-')) throw Error('UNSAFE_TEST_CLEANUP');
    await fs.rm(parent, { recursive: true, force: true });
  }
});
