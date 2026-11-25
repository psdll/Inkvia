import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ aggregate: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { materialAsset: { aggregate: mocks.aggregate } } }));
vi.mock("@/lib/server-auth", () => ({ getCurrentUser: async () => ({ id: 7 }) }));
afterEach(() => vi.useRealTimers());
it("streams database changes and stops work when all clients disconnect", async () => {
  vi.useFakeTimers();
  mocks.aggregate.mockResolvedValue({ _max: { id: 1, updatedAt: new Date(0) } });
  const { GET } = await import("@/app/api/material-assets/events/route");
  const abort = new AbortController();
  const response = await GET(new Request('http://localhost/api/material-assets/events', { signal: abort.signal }) as any);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  expect(first).toContain('event: changed');
  mocks.aggregate.mockResolvedValue({ _max: { id: 2, updatedAt: new Date(1000) } });
  await vi.advanceTimersByTimeAsync(600);
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: changed');
  abort.abort();
  const calls = mocks.aggregate.mock.calls.length;
  await vi.advanceTimersByTimeAsync(2000);
  expect(mocks.aggregate).toHaveBeenCalledTimes(calls);
  expect((await reader.read()).done).toBe(true);
});
it('cleans up a cancelled reader without attempting to close an already cancelled stream', async () => {
  vi.useFakeTimers();
  mocks.aggregate.mockResolvedValue({ _max: { id: 3, updatedAt: new Date(2000) } });
  const { GET } = await import('@/app/api/material-assets/events/route');
  const response = await GET(new Request('http://localhost/api/material-assets/events') as any);
  const reader = response.body!.getReader(); await reader.read();
  await expect(reader.cancel()).resolves.toBeUndefined();
});

it('shares one database revision poll across 100 subscribers', async () => {
  vi.useFakeTimers(); mocks.aggregate.mockClear();
  mocks.aggregate.mockResolvedValue({ _max: { id: 100, updatedAt: new Date(3000) } });
  const { GET } = await import('@/app/api/material-assets/events/route');
  const controllers = Array.from({ length: 100 }, () => new AbortController());
  const responses = await Promise.all(controllers.map(controller => GET(new Request('http://localhost/api/material-assets/events', { signal: controller.signal }) as any)));
  try {
    await Promise.all(responses.map(async response => response.body!.getReader().read()));
    expect(mocks.aggregate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(mocks.aggregate).toHaveBeenCalledTimes(2);
  } finally { controllers.forEach(controller => controller.abort()); }
  await vi.advanceTimersByTimeAsync(2000);
  expect(mocks.aggregate).toHaveBeenCalledTimes(2);
});
