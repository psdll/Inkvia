import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({root:''}));
vi.mock('@/lib/storage',()=>({resolveUploadsRootDirectory:()=>state.root}));
vi.mock('@/lib/runtime-isolation',()=>({assertWritablePath:vi.fn()}));
import { captureGenerationImageOutputs, readGenerationImageOutputs, removeGenerationImageOutputs } from '@/lib/generation/agent-output-recovery';
import { isPrivateUploadPath } from '@/lib/private-upload-path';
beforeEach(async()=>{state.root=await mkdtemp(path.join(os.tmpdir(),'agent-output-recovery-'));});
afterEach(async()=>{await rm(state.root,{recursive:true,force:true});});
it('durably retains signed URLs and inline bytes in a private owner-only file, recoverable by the same generation',async()=>{
 const sources=['https://example.test/a?signature=secret','data:image/png;base64,Yg=='];
 const key=await captureGenerationImageOutputs(41,sources);
 expect(key).toMatch(/^41-[\da-f-]{36}$/);
 const relative='.agent-memory/generation-output-recovery/'+key+'.json';
 expect(isPrivateUploadPath(relative)).toBe(true);
 expect((await stat(path.join(state.root,relative))).mode & 0o777).toBe(0o600);
 expect((await stat(path.dirname(path.join(state.root,relative)))).mode & 0o777).toBe(0o700);
 expect(JSON.parse(await readFile(path.join(state.root,relative),'utf8')).sources).toEqual(sources);
 expect(await readGenerationImageOutputs(41,key)).toEqual(sources);
 await expect(readGenerationImageOutputs(42,key)).rejects.toThrow('identity');
 await expect(readGenerationImageOutputs(41,'../'+key)).rejects.toThrow('identity');
 await removeGenerationImageOutputs(41,key);
 expect(await readdir(path.dirname(path.join(state.root,relative)))).toEqual([]);
});
it.each(['file:///etc/passwd','javascript:alert(1)','https://user:pass@example.test/a','data:text/html;base64,YQ==','data:image/svg+xml;base64,YQ=='])('rejects unsafe recovery source %s without persisting it',async(source)=>{
 await expect(captureGenerationImageOutputs(41,[source])).rejects.toThrow('Invalid output recovery source');
 expect(await readdir(state.root)).toEqual([]);
});

it.each(['png','jpg','jpeg','webp','gif','avif','bmp','tiff'])('roundtrips supported %s headers and existing CRLF/padding variants',async(mime)=>{
 const sources=['Yg','Yg=','Yg==','Y\r\ng==','\r\n'].map(body=>`DATA:IMAGE/${mime.toUpperCase()};BASE64,${body}`);
 const key=await captureGenerationImageOutputs(41,sources);
 expect(await readGenerationImageOutputs(41,key)).toEqual(sources);
});
it.each(['','=', 'Yg===','Y=g','Yg==\n','Y g','Y\tg','Y_g','Y-g','Yé','Yg==,'])('rejects malformed inline body %j before writing',async(body)=>{
 await expect(captureGenerationImageOutputs(41,['data:image/png;base64,'+body])).rejects.toThrow('Invalid output recovery source');
 expect(await readdir(state.root)).toEqual([]);
});
it.each(['data:image/png;charset=utf8;base64,Yg==','data:image/png; base64,Yg==','data:image/png;base64;Yg==','https://user@example.test/a','not a URL'])('rejects malformed header or URL %s',async(source)=>{
 await expect(captureGenerationImageOutputs(41,[source])).rejects.toThrow('Invalid output recovery source');
});
it('captures and reads multi-MiB inline data and rejects a late invalid byte without writing',async()=>{
 const body='Ab09+/'.repeat(1024*1024);
 await expect(captureGenerationImageOutputs(41,['data:image/png;base64,'+body+'!'])).rejects.toThrow('Invalid output recovery source');
 expect(await readdir(state.root)).toEqual([]);
 const source='data:image/png;base64,'+body+'==';
 const key=await captureGenerationImageOutputs(41,[source]);
 expect(await readGenerationImageOutputs(41,key)).toEqual([source]);
});
