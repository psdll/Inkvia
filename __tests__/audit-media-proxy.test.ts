import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('@/lib/ssrf-guard',()=>({safeFetch:vi.fn(async()=>new Response('real-image-bytes',{headers:{'content-type':'image/png'}}))}));
vi.mock('@/lib/rate-limit',()=>({getClientIp:()=> 'audit',rateLimit:()=>({ok:true})}));
import { GET } from '@/app/api/media-proxy/route';
it('must not announce zero Content-Length for a nonempty upstream without Content-Length',async()=>{
 const response=await GET(new NextRequest('http://localhost/api/media-proxy?url=https%3A%2F%2Fexample.com%2Fimage.png'));
 const body=await response.text();
 expect(body).toBe('real-image-bytes');
 expect(response.headers.get('content-length')).not.toBe('0');
});
