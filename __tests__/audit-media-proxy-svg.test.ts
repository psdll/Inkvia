import { expect,it,vi } from 'vitest';
import {NextRequest} from 'next/server';
vi.mock('@/lib/ssrf-guard',()=>({safeFetch:async()=>new Response('<svg xmlns="http://www.w3.org/2000/svg"><script>window.audit = true</script></svg>',{headers:{'content-type':'image/svg+xml','content-length':'82'}})}));
vi.mock('@/lib/rate-limit',()=>({getClientIp:()=> 'audit-svg',rateLimit:()=>({ok:true})}));
import { GET } from '@/app/api/media-proxy/route';
it('rejects active SVG or serves it with an attachment/sandbox policy',async()=>{
 const response=await GET(new NextRequest('http://localhost/api/media-proxy?url=https%3A%2F%2Fexample.com%2Fimage.svg'));
 const blocked=response.status===415 || response.headers.get('content-disposition')?.includes('attachment') || /sandbox|default-src 'none'/.test(response.headers.get('content-security-policy')||'');
 expect(Boolean(blocked)).toBe(true);
});

