import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/providers/transport', () => ({ resolveProviderRequestContext: vi.fn(), fetchWithProviderEgress: vi.fn() }));
import { fetchWithProviderEgress, resolveProviderRequestContext } from '@/lib/providers/transport';
import { volcSeedreamGenerate } from '@/lib/volcengine';
beforeEach(() => {
 vi.clearAllMocks();
 vi.mocked(resolveProviderRequestContext).mockResolvedValue({ provider: { baseUrl: 'https://provider.test', apiKey: 'test-key' }, decision: { mode: 'direct', providerId: 'volcengine' } } as any);
});
it('keeps a signed provider model exact without discovery or access-error fallback calls', async () => {
 vi.mocked(fetchWithProviderEgress).mockResolvedValue(new Response(JSON.stringify({ error: { message: 'do not have access' } }), { status: 403 }));
 await expect(volcSeedreamGenerate({ model: 'doubao-seedream-5-0-pro-260628', prompt: 'x' }, { exactModel: true })).rejects.toThrow();
 expect(fetchWithProviderEgress).toHaveBeenCalledOnce();
 const call = vi.mocked(fetchWithProviderEgress).mock.calls[0];
 expect(call[1]).toBe('https://provider.test/api/v3/images/generations');
 expect(JSON.parse(String(call[2]?.body)).model).toBe('doubao-seedream-5-0-pro-260628');
});
