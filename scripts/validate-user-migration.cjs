// Requires the isolated runtime prepared by scripts/prepare-p0-test-runtime.cjs.
// Missing test resource/policy is a failure, never an invitation to use .env.local.
const { spawnSync } = require("node:child_process");
const tests = [
  "__tests__/user-account-migration-db.integration.test.ts",
  "__tests__/admin-user-import-account.test.ts",
  "__tests__/admin-user-migration-contracts.test.ts",
  "__tests__/admin-user-migration-ui.test.ts",
  "__tests__/admin-user-export-migration-route.test.ts",
  "__tests__/user-migration-package.test.ts",
  "__tests__/admin-user-import-restore.test.ts",
  "__tests__/admin-user-import-retry.test.ts",
  "__tests__/admin-user-export-integrity.test.ts",
  "__tests__/admin-user-export-large-files.test.ts",
  "__tests__/admin-user-import-upload.test.ts",
  "__tests__/role-skill-data-lifecycle.test.ts",
];
const result = spawnSync(process.execPath, ["scripts/run-p0-check.cjs", "vitest", "run", ...tests], {
  stdio: "inherit", env: { ...process.env, RUN_P0_DB_TESTS: "1" },
});
process.exitCode = result.status ?? 1;
