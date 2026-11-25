const { spawnSync } = require('node:child_process');
// P1 already includes P0; do not count or execute P0 twice here.
const prior = spawnSync(process.execPath, ['scripts/validate-p1.cjs'], { stdio: 'inherit', env: process.env });
if (prior.status !== 0) process.exit(prior.status ?? 1);
const result = spawnSync(process.execPath, ['scripts/run-p0-check.cjs', 'vitest', 'run', '--config', 'vitest.p2.config.ts', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, RUN_P0_DB_TESTS: '1' } });
process.exitCode = result.status ?? 1;
