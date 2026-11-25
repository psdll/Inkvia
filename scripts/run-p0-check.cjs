const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
async function main() {
  const environment = JSON.parse(fs.readFileSync(path.resolve(".runtime-local/p0-test/environment.json"), "utf8"));
  Object.assign(process.env, environment, { ADMIN_USERNAME: "p0-test-admin", ADMIN_PASSWORD: "p0-test-admin-password", ADMIN_SECRET: "p0-test-only-admin-secret" });
  const check = spawnSync(process.execPath, [path.resolve("scripts/runtime-identity-check.cjs")], { stdio: "inherit", env: { ...process.env } });
  if (check.status !== 0) throw new Error("ENV_IDENTITY_UNVERIFIED");
  const [command, ...args] = process.argv.slice(2);
  const bins = { prisma: "prisma/build/index.js", vitest: "vitest/vitest.mjs", tsc: "typescript/bin/tsc", next: "next/dist/bin/next", tsx: "tsx/cli" };
  if (!bins[command]) throw new Error("UNSUPPORTED_CHECK");
  const bin = command === "vitest" ? path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs") : require.resolve(bins[command]);
  const child = spawn(process.execPath, [bin, ...args], { stdio: "inherit", env: { ...process.env } });
  child.on("error", () => { process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
main().catch((error) => { console.error(error.code || "P0_CHECK_PREPARATION_FAILED"); process.exitCode = 1; });
