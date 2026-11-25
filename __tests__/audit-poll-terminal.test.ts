import { expect, it, vi } from 'vitest';
import { waitForGenerationResult } from '@/components/canvas/run-node';
it.each([401, 403, 404, 410])('stops polling a permanent HTTP %s', async status => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: false, error: 'terminal' }), { status }));
  vi.stubGlobal('fetch', fetcher);
  try {
    const work = waitForGenerationResult(42, undefined, 10, 20);
    const assertion = expect(work).rejects.toThrow('terminal');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});
it('retries transient failures and still returns a completed result', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, status: 'success', url: '/uploads/done.png' })));
  vi.stubGlobal('fetch', fetcher);
  try {
    const work = waitForGenerationResult(42, undefined, 10, 100);
    await vi.advanceTimersByTimeAsync(30);
    expect(await work).toBe('/uploads/done.png');
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});
