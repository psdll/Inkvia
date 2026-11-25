import { expect, it, vi } from 'vitest';
vi.mock('@/lib/prisma', () => ({ default: {} }));
import { getAdminAccountPage } from '@/lib/admin/account-directory';
it('limits account retrieval before hydrating counts and supports server search', async () => {
 const db = { $queryRaw: vi.fn().mockResolvedValue([{name:'user-7',total:BigInt(10000)}]) };
 const result=await getAdminAccountPage({q:'user-%',page:2,pageSize:5000},db as any);
 expect(result.names).toEqual(['user-7']); expect(result.total).toBe(10000); expect(result.pageSize).toBe(50);
 const sql=db.$queryRaw.mock.calls[0][0];
 expect(sql.values).toContain('%user-\\%%'); expect(sql.values).toContain(50);
});
