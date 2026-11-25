import {expect,it,vi} from 'vitest';
import { PassThrough } from 'node:stream';
const mocks=vi.hoisted(()=>({canvasRows:[] as any[],writes:[] as any[],files:[] as any[],output:null as any}));
vi.mock('@/lib/prisma',()=>{
 const db:any=new Proxy({}, {get(_target,key){if(key==='$transaction')return async(fn:any)=>fn(db);return {findUnique:async()=>key==='user'?{id:1,username:'audit',createdAt:new Date(),updatedAt:new Date()}:null,findFirst:async()=>mocks.canvasRows[0],findMany:async()=>key==='canvas'?mocks.canvasRows:[]};}});
 return {default:db};
});
vi.mock('@/lib/admin-user-scope',()=>({resolveAdminUserScope:async()=>({authUserId:1,presetUserIds:[],userIds:['1']})}));
vi.mock('@/lib/public-path',()=>({resolvePublicDir:()=> 'C:/audit/public',resolveProjectRootDir:()=> 'C:/audit',resolvePublicPath:(...parts:string[])=>'C:/audit/public/'+parts.join('/')}));
vi.mock('@/lib/admin/user-transfer-limits',()=>({assertDiskSpace:async()=>{},formatBytes:String,getMaxExportBytes:()=>1000000000}));
vi.mock('@/lib/admin/legacy-agent-data/memory-file',()=>({readAgentMemoryFile:async()=>null}));
vi.mock('@/lib/admin/legacy-agent-data/runtime-transfer',()=>({exportRuntimeRecords:async()=>[]}));
vi.mock('fs-extra',async()=>{
 const {PassThrough}=await import('node:stream');
 return {default:{ensureDir:async()=>{},createWriteStream:()=>mocks.output=new PassThrough(),stat:async()=>({size:1,isFile:()=>true}),remove:async()=>{},pathExists:async()=>false}};
});
vi.mock('yazl',async()=>{
 const {PassThrough}=await import('node:stream');
 return {ZipFile:class{ outputStream=new PassThrough(); addBuffer(buffer:Buffer,name:string){mocks.writes.push({name,content:buffer.toString()});} addReadStreamLazy(name:string){mocks.files.push(name);} end(){mocks.output.emit('close');} }};
});
import {buildUserExportZip,DEFAULT_EXPORT_OPTIONS} from '@/lib/admin/user-export-builder';
it('does not declare personal skills when workspace export is disabled',async()=>{
 mocks.writes=[];
 const options=Object.fromEntries(Object.keys(DEFAULT_EXPORT_OPTIONS).map(k=>[k,false])) as typeof DEFAULT_EXPORT_OPTIONS;
 await buildUserExportZip({userId:'1',authUserId:1,options,outPath:'C:/audit/export.zip'});
 const manifest=JSON.parse(mocks.writes.find(item=>item.name.endsWith('/manifest.json')).content);
 expect(manifest).not.toHaveProperty('roleSkillsVersion');
 expect(manifest.stats).not.toHaveProperty('userRoleSkills');
 expect(mocks.writes.some(item=>item.name.endsWith('/user_role_skills.json'))).toBe(false);
 mocks.output.destroy();
});
it('exports a real Prisma Canvas whose revisions are BigInt',async()=>{
 mocks.canvasRows=[{id:1,authUserId:1,title:'audit',data:{mode:'smart',nodes:[],edges:[]},revision64:BigInt("2"),projectionRevision:BigInt("0"),snapshotRevision:BigInt("0"),currentSnapshotId:null}];
 const options=Object.fromEntries(Object.keys(DEFAULT_EXPORT_OPTIONS).map(k=>[k,k==='workspaceData'])) as typeof DEFAULT_EXPORT_OPTIONS;
 // It must reach packing canvases rather than fail on JSON serialization.
 let caught:unknown;
 try{ await buildUserExportZip({userId:'1',authUserId:1,options,outPath:'C:/audit/export.zip'});}catch(error){caught=error;}
 expect(caught).toBeUndefined();
 const canvasFile=mocks.writes.find(item=>item.name.endsWith('/canvases.json'));
 expect(JSON.parse(canvasFile.content)[0].revision64).toBe('2');
 mocks.output.destroy();
});
