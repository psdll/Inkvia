import { afterAll, expect, it, vi } from 'vitest';
import { loadAdminAnalysisTrends, loadAdminStorageSummary } from '@/lib/admin/analysis-aggregates';
import { getAdminAccountPage } from '@/lib/admin/account-directory';
import { buildModelFailurePeriods } from '@/lib/admin-model-failure';
let db:any; afterAll(async()=>{await db?.$disconnect()});
const integration=process.env.RUN_P0_DB_TESTS==='1'?it:it.skip;
integration('aggregates 10000 tasks without transferring history and preserves ownership and file deduplication',async()=>{
 db=(await import('@/lib/prisma')).default;
 await db.$transaction(async(tx:any)=>{
  await tx.$executeRaw`CREATE TEMP TABLE "Generation" (id int,"authUserId" int,"userId" text,type text,status text,model text,"createdAt" timestamp,"localPath" text,"sizeBytes" int,"externalProvider" text,"errorMsg" text) ON COMMIT DROP`;
  await tx.$executeRaw`CREATE TEMP TABLE "UsageLedger" ("userId" text,"authUserId" int,"externalProvider" text,model text,module text,status text,"occurredAt" timestamp,"generationId" int,"unitType" text) ON COMMIT DROP`;
  await tx.$executeRaw`CREATE TEMP TABLE "Log" ("userId" text,category text,level text,"createdAt" timestamp) ON COMMIT DROP`;
  await tx.$executeRaw`CREATE TEMP TABLE "MediaLibraryItem" (id int,"ownerUserId" int,"isDeleted" boolean,"ossUrl" text,"thumbnailUrl" text,"sizeBytes" int) ON COMMIT DROP`;
  await tx.$executeRaw`CREATE TEMP TABLE "UserRoleSkill" (id int,"authUserId" int,"coverUrl" text) ON COMMIT DROP`;
  const now=new Date(); const day=new Date(now);day.setHours(0,0,0,0);
  await tx.$executeRaw`INSERT INTO "Generation" (id,"authUserId","userId",type,status,model,"createdAt","localPath","sizeBytes") SELECT n,7,'7','image_edit','success','x',${day},'/uploads/'||n||'.webp',100 FROM generate_series(1,10000) n`;
  await tx.$executeRaw`INSERT INTO "Generation" (id,"authUserId","userId",type,status,model,"createdAt","localPath","sizeBytes") VALUES (10001,8,'7','image_edit','failed','wrong',${day},'/uploads/private.webp',999999),(10002,NULL,'old','image_edit','failed','x',${day},'uploads/1.webp?download=1',200)`;
  await tx.$executeRaw`INSERT INTO "MediaLibraryItem" VALUES (1,7,false,'/uploads/1.webp','/uploads/t.webp',300),(2,8,false,'/uploads/secret.webp',NULL,9999)`;
  const scope={requestedUserId:'7',authUserId:7,linkedUserIds:['7','old'],linkedGuestUserIds:['old'],presetUserIds:['7'],generationWhere:{},logWhere:{userId:{in:['old']}}};
  const before=performance.now();const old=await tx.$queryRaw`SELECT model,status,"createdAt",type FROM "Generation" WHERE "authUserId"=7 OR ("authUserId" IS NULL AND "userId"='old')`;const oldMs=performance.now()-before;
  const start=performance.now(); const result=await loadAdminAnalysisTrends(scope,now,tx); const storage=await loadAdminStorageSummary(scope,tx);
  expect(result.activeDays).toBe(1);
  expect(Object.values(result.daily14).reduce((a:any,b:any)=>a+b,0)).toBe(10001);
  expect(result.modelFailurePeriods).toEqual(buildModelFailurePeriods(old,now));
  expect(storage).toMatchObject({fileCount:10001,verifiedFiles:10000,unverifiedFiles:1,totalBytes:1000200,generatedBytes:1000200,privateLibraryBytes:0});
  console.info(JSON.stringify({fixtureRows:10002,oldMs:Math.round(oldMs),aggregateMs:Math.round(performance.now()-start),oldBytes:JSON.stringify(old).length,aggregateBytes:JSON.stringify(result).length}));
 },{timeout:20000});
},30000);

integration('pages and searches 10000 accounts in SQL, including an empty last page',async()=>{
 db=(await import('@/lib/prisma')).default;
 await db.$transaction(async(tx:any)=>{
  await tx.$executeRaw`CREATE TEMP TABLE "WhitelistName" (name text,"createdAt" timestamp) ON COMMIT DROP`;
  await tx.$executeRaw`CREATE TEMP TABLE "User" (username text,"createdAt" timestamp) ON COMMIT DROP`;
  await tx.$executeRaw`INSERT INTO "WhitelistName" SELECT 'user-'||lpad(n::text,5,'0'),NOW() FROM generate_series(1,10000) n`;
  const first=await getAdminAccountPage({page:1},tx);
  const last=await getAdminAccountPage({page:200},tx);
  const empty=await getAdminAccountPage({page:201},tx);
  const search=await getAdminAccountPage({q:'user-09999'},tx);
  expect(first.total).toBe(10000); expect(first.names).toHaveLength(50);
  expect(last.names).toHaveLength(50); expect(new Set([...first.names,...last.names]).size).toBe(100);
  expect(empty).toMatchObject({names:[],total:10000});
  expect(search.names).toEqual(['user-09999']);
 },{timeout:20000});
},30000);
integration('uses the actual deployed database column mappings',async()=>{
 db=(await import('@/lib/prisma')).default;
 const scope={requestedUserId:'-1',authUserId:-1,linkedUserIds:[],linkedGuestUserIds:[],presetUserIds:[],generationWhere:{},logWhere:{userId:{in:[]}}};
 expect(await loadAdminStorageSummary(scope,db)).toMatchObject({fileCount:0,totalBytes:0});
});
