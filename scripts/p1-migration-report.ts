import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import prisma from '@/lib/prisma';
import { getRuntimePolicy, prepareRuntime } from './lib/runtime-isolation.cjs';

async function main() {
  await prepareRuntime();
  const policy = getRuntimePolicy();
  if (policy.profile !== 'test') throw new Error('P1_REPORT_REQUIRES_TEST_RESOURCE');
  const rows = await prisma.$queryRaw<Array<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`;
  if (rows.some(row => !row.finished_at && !row.rolled_back_at)) throw new Error('MIGRATION_FAILED_OR_PENDING');
  const applied = rows.filter(row => row.finished_at && !row.rolled_back_at);
  const checksums = applied.map(row => {
    const sql = fs.readFileSync(path.join('prisma/migrations', row.migration_name, 'migration.sql'));
    const exact = createHash('sha256').update(sql).digest('hex');
    const normalized = createHash('sha256').update(sql.toString('utf8').replace(/\r\n/g, '\n')).digest('hex');
    return { name: row.migration_name, appliedChecksum: row.checksum, sourceChecksum: exact, normalizedChecksum: normalized, matches: row.checksum === exact || row.checksum === normalized };
  });
  if (checksums.some(row => !row.matches)) throw new Error('APPLIED_MIGRATION_SOURCE_CHANGED');
  const dir = path.resolve('.codex-artifacts/phase2-p1-20260906'); fs.mkdirSync(dir, { recursive: true });
  const appliedPath = path.join(dir, 'actual-applied-migrations.txt'); fs.writeFileSync(appliedPath, applied.map(r => r.migration_name).join('\n') + '\n');
  const checked = spawnSync(process.execPath, ['scripts/validate-migration-policy.mjs', '--applied', appliedPath], { encoding: 'utf8' });
  if (checked.status !== 0) throw new Error('MIGRATION_POLICY_REJECTED');
  const report = { resourceFingerprint: policy.fingerprint, appliedCount: applied.length, checksums, validator: JSON.parse(checked.stdout) };
  fs.writeFileSync(path.join(dir, 'migration-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ appliedCount: applied.length, checksumMatches: checksums.every(r => r.matches), errors: report.validator.errors, resourceFingerprint: policy.fingerprint }));
}
main().catch(error => { console.error(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'P1_MIGRATION_REPORT_FAILED'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
