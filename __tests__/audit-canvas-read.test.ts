import { expect,it,vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks=vi.hoisted(()=>({findFirst:vi.fn(),create:vi.fn()}));
vi.mock('@/lib/prisma',()=>({default:{canvas:{findFirst:mocks.findFirst,create:mocks.create}}}));
vi.mock('@/lib/server-auth',()=>({getUserId:async()=>1}));
import { GET } from '@/app/api/canvas/[id]/route';
it('serializes a Prisma Canvas with bigint revisions',async()=>{
 mocks.findFirst.mockResolvedValue({id:1,title:'audit',data:{mode:'smart'},revision:1,revision64:BigInt("2"),projectionRevision:BigInt("2"),snapshotRevision:BigInt("0"),currentSnapshotId:null});
 const response=await GET(new NextRequest('http://localhost/api/canvas/1'),{params:{id:'1'}});
 expect(response.status).toBe(200);
});
