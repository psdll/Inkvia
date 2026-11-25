import prisma from '@/lib/prisma';

// Retry only local, idempotent writes. Never repeat a paid provider request.
export async function persistUsageWrite<T>(write: () => Promise<T>, identity: { generationId?: number; ledgerId?: number }): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      const code = String((error as { code?: unknown })?.code || '');
      if (attempt < 2 && ['P1001', 'P1002', 'P1017', 'P2024', 'P2034', 'ECONNRESET', 'ETIMEDOUT'].includes(code)) {
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        continue;
      }
      console.error('[billing] usage persistence failed', { ...identity, code });
      throw error;
    }
  }
}

export async function persistGenerationProviderUsage(
  record: { id: number; templateData: string | null; externalProvider?: string | null },
  providerUsage: Record<string, unknown>,
  db: any = prisma,
) {
  const received = Object.values(providerUsage).some(value => value != null);
  const template = {
    ...JSON.parse(record.templateData || '{}'),
    providerUsage,
    usageCapture: { state: received ? 'received' : 'missing', providerCompleted: true, capturedAt: new Date().toISOString() },
  };
  // Commit before downloading/decoding media or calculating prices. A subsequent
  // failure then leaves real supplier usage available for audit and reconciliation.
  await persistUsageWrite(() => db.generation.update({
    where: { id: record.id }, data: { templateData: JSON.stringify(template) },
  }), { generationId: record.id });
  if (!received) console.warn('[billing] provider returned no usage', { generationId: record.id, provider: record.externalProvider });
  return template;
}
