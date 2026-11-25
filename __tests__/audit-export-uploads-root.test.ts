import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({output:null as any,files:[] as string[],statPaths:[] as string[]}));
vi.mock('@/lib/prisma',()=>({default:new Proxy({}, {get(_target,key){return {findUnique:async()=>key==='user'?{id:1,username:'audit',createdAt:new Date(),updatedAt:new Date()}:null,findMany:async()=>key==='mediaLibraryItem'?[{id:1,fileUrl:'/uploads/audit.png'}]:[]};}})}));
vi.mock('@/lib/admin-user-scope',()=>({resolveAdminUserScope:async()=>({authUserId:1,presetUserIds:[],userIds:['1']})}));
vi.mock('@/lib/public-path',()=>({resolvePublicDir:()=> 'C:/audit/public',resolveProjectRootDir:()=> 'C:/audit',resolvePublicPath:(...parts:string[])=>parts[0]==='uploads'?'C:/audit/external-uploads/'+parts.slice(1).join('/'):'C:/audit/public/'+parts.join('/')}));
vi.mock('@/lib/admin/user-transfer-limits',()=>({assertDiskSpace:async()=>{},formatBytes:String,getMaxExportBytes:()=>1000000000}));
vi.mock('@/lib/admin/legacy-agent-data/memory-file',()=>({readAgentMemoryFile:async()=>null}));
vi.mock('@/lib/admin/legacy-agent-data/runtime-transfer',()=>({exportRuntimeRecords:async()=>[]}));
vi.mock('fs-extra',async()=>{const {PassThrough}=await import('node:stream');return {default:{ensureDir:async()=>{},createWriteStream:()=>mocks.output=new PassThrough(),stat:async(p:string)=>{mocks.statPaths.push(p);if(p.replaceAll('\\','/').endsWith('/export.zip')||p.replaceAll('\\','/').includes('/external-uploads/audit.png'))return {size:12,isFile:()=>true};throw new Error('ENOENT');},remove:async()=>{},pathExists:async()=>false}};});
vi.mock('yazl',async()=>{const {PassThrough}=await import('node:stream');return {ZipFile:class{outputStream=new PassThrough();addBuffer(){}addReadStreamLazy(name:string){mocks.files.push(name);}end(){mocks.output.emit('close');}}};});
import {buildUserExportZip,DEFAULT_EXPORT_OPTIONS} from '@/lib/admin/user-export-builder';
it('includes media from configured UPLOADS_DIR in the export',async()=>{
 vi.stubEnv('UPLOADS_DIR','C:/audit/external-uploads');
 try{
  const options=Object.fromEntries(Object.keys(DEFAULT_EXPORT_OPTIONS).map(k=>[k,k==='mediaLibrary'])) as typeof DEFAULT_EXPORT_OPTIONS;
  const result=await buildUserExportZip({userId:'1',authUserId:1,options,outPath:'C:/audit/export.zip'});
  expect(result.manifest.missing).toEqual([]);
  expect(mocks.files).toHaveLength(1);
 }finally{vi.unstubAllEnvs();mocks.output?.destroy();}
});
