import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/prisma', () => ({ default: {} }));
import { persistGenerationProviderUsage, persistUsageWrite } from '@/lib/billing/usage-persistence';
import { finishLlmCost } from '@/lib/billing/llm';
import { previewReconciliation } from '@/lib/billing/reconcile';
import { upsertUsageLedgerForGeneration } from '@/lib/billing-ledger';
import { GOOGLE_IMAGE_QUOTES } from '@/lib/billing/google-pricing';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const usage = { inputTokens: 1000000, outputTokens: 100000 };
const snapshot = { version: 1, occurredAt: '2026-09-23T00:00:00Z', prices: { input_million_token: '2', output_million_token: '8' },
  currency: 'CNY', rate: { id: 'CNY', rate: '1', effectiveFrom: null }, effectiveFrom: '2026-08-01' } as any;

describe('durable usage before downstream work', () => {
  it('retries transient database errors without re-running generation', async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockRejectedValueOnce({ code: 'P1001' }).mockRejectedValueOnce({ code: 'P1017' }).mockResolvedValue('saved');
    const pending = persistUsageWrite(write, { generationId: 1 });
    await vi.runAllTimersAsync();
    expect(await pending).toBe('saved');
    expect(write).toHaveBeenCalledTimes(3);
  });
  it('exposes persistent write failure rather than claiming the usage was saved', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const write = vi.fn().mockRejectedValue({ code: 'P2003' });
    await expect(persistUsageWrite(write, { generationId: 1 })).rejects.toEqual({ code: 'P2003' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.any(String), { generationId: 1, code: 'P2003' });
  });
  it('stores an explicit missing receipt and warns when no usage is returned', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const update = vi.fn().mockResolvedValue({});
    const saved = await persistGenerationProviderUsage({ id: 1, templateData: '{"model":"m"}', externalProvider: 'p' }, { usageMetadata: null }, { generation: { update } });
    expect(saved.usageCapture).toMatchObject({ state: 'missing', providerCompleted: true });
    expect(JSON.parse(update.mock.calls[0][0].data.templateData).model).toBe('m');
    expect(warn).toHaveBeenCalled();
  });
  it('retains real LLM tokens if settlement fails and reconciles at the original quote', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const row: any = { id: 4, model: 'm', externalProvider: 'p', billable: true, status: 'running', unitType: 'token',
      costStatus: 'pending', finishedAt: null, occurredAt: new Date(snapshot.occurredAt), updatedAt: new Date(), pricingSnapshot: snapshot };
    const updateMany = vi.fn(async ({ data }: any) => {
      if (data.costStatus) throw new Error('settlement unavailable');
      Object.assign(row, data);
      return { count: 1 };
    });
    await expect(finishLlmCost({ id: 4, snapshot }, usage, true, { usageLedger: { updateMany } })).rejects.toThrow('settlement unavailable');
    expect(row.usageSnapshot).toEqual(usage);
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(row.costStatus).toBe('pending');
    const findMany = vi.fn(async (_args: any) => [row]);
    const currentPrices = vi.fn(() => { throw new Error('must not replace captured prices'); });
    const preview = await previewReconciliation({ usageLedger: { findMany }, billingPriceRule: { findMany: currentPrices } }, {}, { mode: 'observe', revision: 1, rates: [] });
    expect(preview.updates[0].after).toBe('2.80000000');
    expect(currentPrices).not.toHaveBeenCalled();
    expect(row.costStatus).toBe('pending'); // preview must not write
    expect(findMany.mock.calls[0][0]).toMatchObject({ where: { AND: expect.arrayContaining([
      { OR: expect.arrayContaining([{ costStatus: 'pending', finishedAt: { not: null }, unitType: 'token' }]) },
    ]) } });
  });
  it('does not overwrite an already captured or settled LLM receipt', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    await finishLlmCost({ id: 4, snapshot }, usage, true, { usageLedger: { updateMany } });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].where).toEqual({ id: 4, costStatus: 'pending', finishedAt: null });
  });
  it('can recover a media ledger left pending after generation completed', async () => {
    const generation = { id: 2, userId: 'test', authUserId: null, type: 'audio_gen', source: 'canvas', model: 'seed-audio-1.0',
      externalProvider: 'volcengine-speech', status: 'success', createdAt: new Date('2026-09-23'), finishedAt: new Date(),
      templateData: JSON.stringify({ model: 'seed-audio-1.0', providerUsage: { original_duration: 30 } }) };
    const row = { id: 9, generationId: 2, model: generation.model, costStatus: 'pending', status: 'running', unitType: 'second', billable: false, updatedAt: new Date() };
    const db = { usageLedger: { findMany: async () => [row] }, generation: { findUnique: async () => generation },
      billingPriceRule: { findMany: async () => [{ id: 1, unitType: 'minute', unitPrice: 1, currency: 'CNY', priority: 1, matchConditions: null }] } };
    const preview = await previewReconciliation(db, {}, { mode: 'observe', revision: 1, rates: [] });
    expect(preview.updates[0].data).toMatchObject({ status: 'success', billable: true, costStatus: 'priced', finishedAt: generation.finishedAt });
    expect(preview.updates[0].after).toBe('0.50000000');
  });
  it('preserves usage even when malformed prices throw before settlement', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await expect(finishLlmCost({ id: 4, snapshot: { ...snapshot, prices: undefined } }, usage, true, { usageLedger: { updateMany } })).rejects.toThrow();
    expect(updateMany.mock.calls[0][0].data.usageSnapshot).toEqual(usage);
  });
  it('retains supplier usage but excludes failed media, including local delivery failures', async () => {
    const model = 'gemini-3-pro-image';
    const db: any = { billingPriceRule: { findMany: async () => GOOGLE_IMAGE_QUOTES[model].map((q, id) => ({ id, unitType: q.unitType, unitPrice: Number(q.usd) * 7, currency: 'CNY', isActive: true, matchConditions: {}, effectiveFrom: new Date('2026-08-01') })) },
      appSetting: { findUnique: async () => null }, usageLedger: { findUnique: async () => null, upsert: async ({ create }: any) => create } };
    const g = { id: 1, userId: 'test', authUserId: null, type: 'image_edit', source: 'canvas', prompt: '', model, status: 'failed', externalProvider: 'google-ai-studio', externalTaskId: null, errorMsg: 'disk full', createdAt: new Date('2026-09-23'), finishedAt: new Date(),
      templateData: JSON.stringify({ usageCapture: { providerCompleted: true }, providerUsage: { usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1229, thoughtsTokenCount: 179, totalTokenCount: 1411, candidatesTokensDetails: [{ modality: 'IMAGE', tokenCount: 1120 }] } } }) };
    const billed = await upsertUsageLedgerForGeneration(g, db);
    expect(billed).toMatchObject({ status: 'failed', billable: false, costStatus: 'failed' });
    expect(Number(billed.amount)).toBe(0);
    expect(billed.usageSnapshot.providerUsage).toEqual(JSON.parse(g.templateData).providerUsage);
    db.usageLedger.findUnique = async () => ({ costStatus: 'priced', amount: '0.965034' });
    const reversed = await upsertUsageLedgerForGeneration(g, db);
    expect(reversed.costStatus).toBe('failed');
    expect(Number(reversed.amount)).toBe(0);
    db.usageLedger.findUnique = async () => null;
    const failedAtProvider = await upsertUsageLedgerForGeneration({ ...g, templateData: '{}' }, db);
    expect(failedAtProvider).toMatchObject({ billable: false, costStatus: 'failed' });
  });
  it.each([null, usage])('excludes failed LLM calls even with reported usage %j', async (reported) => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await finishLlmCost({ id: 4, snapshot }, reported, false, { usageLedger: { updateMany } });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ status: 'failed', billable: false, amount: 0, costStatus: 'failed', usageSnapshot: reported || {} });
  });
  it.each(['failed', 'cancelled', 'canceled'])('never reprices a %s LLM during reconciliation', async (status) => {
    const row = { id: 1, status, unitType: 'token', costStatus: 'missing_usage', usageSnapshot: usage, pricingSnapshot: snapshot, updatedAt: new Date() };
    const preview = await previewReconciliation({ usageLedger: { findMany: async () => [row] } }, {}, { mode: 'observe', revision: 1, rates: [] });
    expect(preview.updates[0].data).toMatchObject({ billable: false, costStatus: 'failed', amount: 0 });
    expect(preview.updates[0].after).toBe('0');
  });
});
