const { spawnSync } = require("node:child_process");
const result = spawnSync(process.execPath, ["scripts/run-p0-check.cjs", "vitest", "run", "--config", "vitest.p0.config.ts"], {
  stdio: "inherit", env: { ...process.env, RUN_P0_DB_TESTS: "1" },
});
process.exitCode = result.status ?? 1;
