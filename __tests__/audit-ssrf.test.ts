import { afterEach, expect, it, vi } from 'vitest';
import { isDangerousIp, safeFetch } from '@/lib/ssrf-guard';
afterEach(() => vi.unstubAllGlobals());
it.each(['[::1]', '::', '0:0:0:0:0:0:0:1', '[::ffff:127.0.0.1]', '::ffff:7f00:1', '[fd01::1234]', '[febf::1]', '::ffff:c0a8:101', '10.1.2.3', '169.254.169.254', 'invalid'])('rejects private or invalid IP %s', ip => {
  expect(isDangerousIp(ip)).toBe(true);
});
it.each(['8.8.8.8', '2606:4700:4700::1111', '[2001:4860:4860::8888]'])('allows public IP %s', ip => expect(isDangerousIp(ip)).toBe(false));
it('blocks loopback before any network request', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(safeFetch('http://[::1]/test')).rejects.toThrow('forbidden host');
  expect(fetcher).not.toHaveBeenCalled();
});
it('revalidates redirects and releases their bodies', async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream({ cancel }), { status: 302, headers: { location: 'http://[::ffff:7f00:1]/' } });
  const fetcher = vi.fn(async () => response); vi.stubGlobal('fetch', fetcher);
  await expect(safeFetch('http://8.8.8.8/test')).rejects.toThrow('forbidden host');
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
});
