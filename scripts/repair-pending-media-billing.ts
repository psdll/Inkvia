import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import prisma from '../lib/prisma';
import { billingWhere } from '../lib/billing/monthly';
import { previewReconciliation } from '../lib/billing/reconcile';
import { readBillingSettings, withBillingWrite } from '../lib/billing/settings';
import { decimal } from '../lib/billing/money';
import { isRetiredProviderModel } from '../lib/providers/retired-models';

// Local repair only: preview first, then apply that exact digest. Never reprice settled rows.
async function main() {
  const target = new URL(process.env.DATABASE_URL!);
  if (process.env.INKVIA_RUNTIME_PROFILE !== 'local' || target.hostname !== '127.0.0.1'
    || target.port !== '5434' || target.pathname !== '/inkvia') throw new Error('Unexpected repair database');
  const args = process.argv.slice(2);
  const month = args.find(a => a.startsWith('--month='))?.slice(8) || '2026-09';
  const scope = { ...billingWhere({ month }), costStatus: 'missing_usage', OR: [
    { externalProvider: 'google-ai-studio', model: 'gemini-3-pro-image' },
    { externalProvider: 'apimart', model: 'doubao-seedance-2.0-face' },
  ] };
  const run = async (db: any) => {
    const settings = await readBillingSettings(db);
    let cursor = 0;
    const updates = [];
    for (;;) {
      const preview = await previewReconciliation(db, scope, settings, cursor);
      updates.push(...preview.updates.filter(u => !isRetiredProviderModel(u.provider || '', u.model)));
      if (!preview.hasMore) break;
      if (preview.nextCursor <= cursor) throw new Error('Repair pagination stalled');
      cursor = preview.nextCursor;
    }
    const digest = createHash('sha256').update(JSON.stringify({ month, revision: settings.revision, updates })).digest('hex');
    const summary = { month, digest, count: updates.length,
      amountCny: updates.reduce((sum, u) => sum.add(u.after).sub(u.before), decimal(0)).toFixed(8),
      items: updates.map(u => ({ id: u.id, provider: u.provider, model: u.model, amountCny: u.after })) };
    if (!args.includes('--apply')) return summary;
    if (args.find(a => a.startsWith('--digest='))?.slice(9) !== digest) throw new Error('Repair changed; preview again');
    const before = await db.usageLedger.findMany({ where: { id: { in: updates.map(u => u.id) } },
      select: { id: true, updatedAt: true, unitType: true, unitCount: true, unitPrice: true, amount: true,
        currency: true, costStatus: true, pricingSnapshot: true, usageSnapshot: true } });
    const backup = path.resolve('.runtime-local/billing-corrections', `pending-media-${Date.now()}.json`);
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.writeFile(backup, JSON.stringify({ ...summary, before, updates }, null, 2), { flag: 'wx' });
    for (const update of updates) {
      const result = await db.usageLedger.updateMany({ where: { id: update.id, updatedAt: update.updatedAt, costStatus: 'missing_usage' }, data: update.data });
      if (result.count !== 1) throw new Error('Ledger changed; repair rolled back');
    }
    return { ...summary, applied: true, backup };
  };
  console.log(JSON.stringify(args.includes('--apply') ? await withBillingWrite(run) : await run(prisma), null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
