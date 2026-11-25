import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import prisma from '../lib/prisma';
import { withBillingWrite } from '../lib/billing/settings';
import { failedCostData, isFailedBillingStatus } from '../lib/billing/failed-cost';
import { isRetiredProviderModel } from '../lib/providers/retired-models';

async function main() {
  const target = new URL(process.env.DATABASE_URL!);
  if (process.env.INKVIA_RUNTIME_PROFILE !== 'local' || target.hostname !== '127.0.0.1' || target.port !== '5434' || target.pathname !== '/inkvia') throw new Error('Unexpected repair database');
  const args = process.argv.slice(2);
  const run = async (db: any) => {
    const rows = (await db.usageLedger.findMany({ where: {
      OR: [{ status: { in: ['failed', 'cancelled', 'canceled'] } }, { generation: { is: { status: { in: ['failed', 'cancelled', 'canceled'] } } } }],
      AND: [{ OR: [{ costStatus: { not: 'failed' } }, { billable: true }, { amount: { not: 0 } }] }],
    }, include: { generation: { select: { status: true } } }, orderBy: { id: 'asc' } })).filter((r: any) => !isRetiredProviderModel(r.externalProvider || '', r.model));
    const updates = rows.map((row: any) => ({ id: row.id, updatedAt: row.updatedAt, data: {
      ...failedCostData(row.pricingSnapshot), status: isFailedBillingStatus(row.generation?.status || '') ? row.generation.status : row.status,
    } }));
    const digest = createHash('sha256').update(JSON.stringify(updates)).digest('hex');
    const summary = { count: rows.length, digest, items: rows.map((r: any) => ({ id: r.id, model: r.model, provider: r.externalProvider, before: r.costStatus, amount: String(r.amount) })) };
    if (!args.includes('--apply')) return summary;
    if (!args.includes(`--digest=${digest}`)) throw new Error('Rows changed; preview again');
    const backup = path.resolve('.runtime-local/billing-corrections', `failed-excluded-${Date.now()}.json`);
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.writeFile(backup, JSON.stringify({ before: rows.map(({ generation, requestSnapshot, ...row }: any) => row), updates }, null, 2), { flag: 'wx' });
    for (const update of updates) {
      const result = await db.usageLedger.updateMany({ where: { id: update.id, updatedAt: update.updatedAt }, data: update.data });
      if (result.count !== 1) throw new Error('Row changed; transaction rolled back');
    }
    return { ...summary, backup, applied: true };
  };
  console.log(JSON.stringify(args.includes('--apply') ? await withBillingWrite(run) : await run(prisma), null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
