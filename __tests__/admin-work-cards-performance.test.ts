import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ generation: { findMany: vi.fn(), count: vi.fn() }, log: { findMany: vi.fn() }, imageBatchOutput: { findMany: vi.fn() }, liveVideoBatchOutput: { findMany: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ default: db }));
import { getAdminUserWorks, getAdminUserWorkDetail } from '@/lib/admin-user-works';
const scope = { authUserId: 7, generationWhere: { authUserId: 7 }, logWhere: { userId: '7' } };
beforeEach(() => { vi.clearAllMocks(); delete process.env.ADMIN_WORKS_READ_MODEL; db.generation.count.mockResolvedValue(10000); db.log.findMany.mockResolvedValue([]); db.imageBatchOutput.findMany.mockResolvedValue([]); db.liveVideoBatchOutput.findMany.mockResolvedValue([]); });
it('returns bounded preview cards without task logs, peer hydration or full parameters', async () => {
  db.generation.findMany.mockResolvedValue(Array.from({ length: 41 }, (_, i) => ({ id: 100-i, userId:'7', authUserId:7, type:'image_edit',source:'tool',status:'success',prompt:'p'.repeat(10000),model:'x',externalTaskId:'task-'+i,localPath:'/uploads/a.png',templateData:JSON.stringify({outputThumbUrl:'/uploads/t.webp', privateLarge:'x'.repeat(100000)}),createdAt:new Date(2026,8,29),updatedAt:new Date(2026,8,29) })));
  const result = await getAdminUserWorks({scope,page:1,pageSize:40,kind:'generated',typeFilter:'all',sourceFilter:'all',cardsOnly:true});
  expect(result.generations).toHaveLength(40);
  expect(result.pagination.hasMore).toBe(true);
  expect(result.generations[0]).toMatchObject({ id:100,thumbUrl:'/uploads/t.webp',detailsLoaded:false });
  expect(JSON.stringify(result).length).toBeLessThan(45000);
  expect(db.log.findMany).not.toHaveBeenCalled();
  expect(db.generation.findMany).toHaveBeenCalledTimes(1);
});
it('loads full details only inside the requested user scope', async () => {
  db.generation.findMany.mockResolvedValue([]);
  expect(await getAdminUserWorkDetail(scope, 93)).toBeNull();
  expect(db.generation.findMany.mock.calls[0][0].where).toEqual({AND:[{authUserId:7},{id:93}]});
});
