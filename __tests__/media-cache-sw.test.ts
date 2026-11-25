import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function setup(count = 0) {
  const entries = new Map<string, Response>(Array.from({ length: count }, (_, i) => [
    `http://localhost/uploads/${i}.webp`, new Response('image', { headers: { 'content-type': 'image/webp', 'x-sw-cached-at': String(Date.now()) } }),
  ]));
  const key = (request: Request | string) => typeof request === 'string' ? request : request.url;
  const cache = {
    keys: vi.fn(async () => [...entries.keys()]),
    match: vi.fn(async (request: Request | string) => entries.get(key(request))?.clone()),
    delete: vi.fn(async (request: Request | string) => entries.delete(key(request))),
    put: vi.fn(async (request: Request | string, response: Response) => { entries.set(key(request), response); }),
  };
  const events: Record<string, (event: any) => void> = {};
  const fetch = vi.fn(async () => new Response('image', { headers: { 'content-type': 'image/webp' } }));
  const context = vm.createContext({ self: { addEventListener: (name: string, handler: any) => { events[name] = handler; }, location: { origin: 'http://localhost' } }, caches: { open: async () => cache }, URL, Response, Headers, fetch });
  vm.runInContext(fs.readFileSync('public/media-cache-sw.js', 'utf8'), context);
  return { cache, entries, context, events, fetch };
}

describe('media cache sustained browsing', () => {
  it('evicts at capacity without opening every cached image response', async () => {
    const { cache, entries, context } = setup(1000);
    for (let i = 1000; i < 1120; i++) {
      await context.writeToCache(cache, `http://localhost/uploads/${i}.webp`, new Response('image', { headers: { 'content-type': 'image/webp' } }));
    }
    expect(cache.match.mock.calls.length).toBe(0);
    expect(entries.size).toBeLessThanOrEqual(1000);
    expect(entries.has('http://localhost/uploads/1119.webp')).toBe(true);
  });
  it('keeps cache maintenance in the fetch event lifetime and bounds concurrent writes', async () => {
    const { cache, events } = setup(1000);
    let active = 0, peak = 0;
    const original = cache.put.getMockImplementation()!;
    cache.put.mockImplementation(async (...args) => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setTimeout(resolve, 1));
      await original(...args); active--;
    });
    const writes: Promise<unknown>[] = [], responses: Promise<Response>[] = [];
    for (let i = 1000; i < 1120; i++) events.fetch({ request: new Request(`http://localhost/uploads/${i}.webp`), respondWith: (p: Promise<Response>) => responses.push(p), waitUntil: (p: Promise<unknown>) => writes.push(p) });
    const results = await Promise.all(responses);
    await Promise.all(writes);
    expect(results.every(r => r.ok)).toBe(true);
    expect(writes.length).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(6);
    expect(cache.match).toHaveBeenCalledTimes(120); // Only the requested URLs, no full-cache scans.
  });
  it('still serves a fresh hit and a stale hit on network failure', async () => {
    const { cache, context, fetch, entries } = setup(1);
    const url = 'http://localhost/uploads/0.webp';
    expect((await context.handleFetch(new Request(url))).ok).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    entries.set(url, new Response('stale', { headers: { 'x-sw-cached-at': '1' } }));
    fetch.mockRejectedValueOnce(new Error('offline'));
    expect(await (await context.handleFetch(new Request(url))).text()).toBe('stale');
    expect(cache.delete).toHaveBeenCalledWith(expect.any(Request));
  });
  it('does not cache non-image downloads or partial media requests', async () => {
    const { cache, context, fetch } = setup();
    fetch.mockResolvedValueOnce(new Response('video', { headers: { 'content-type': 'video/mp4' } }));
    await context.handleFetch(new Request('http://localhost/uploads/movie.mp4'));
    expect(cache.put.mock.calls.length).toBe(0);
    expect(context.shouldHandle(new Request('http://localhost/uploads/movie.mp4', { headers: { Range: 'bytes=0-500' } }))).toBe(false);
  });
  it('handles storage quota exhaustion without opening cached bodies or retrying a consumed response', async () => {
    const { cache, context, entries } = setup(400);
    cache.put.mockImplementationOnce(async (_request, response) => {
      await response.text();
      throw Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
    });
    await context.writeToCache(cache, 'http://localhost/uploads/new.webp', new Response('image'));
    expect(cache.put.mock.calls.length).toBe(1);
    expect(cache.match.mock.calls.length).toBe(0);
    expect(entries.size).toBe(200);
  });

});
