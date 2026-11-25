// Explicit entry for the separately provisioned P0 resource; never rewrites .env files.
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { loadEnvConfig } = require("@next/env");
async function main() {
  const root = path.resolve(".runtime-local/p0-test");
  const environment = JSON.parse(fs.readFileSync(path.join(root, "environment.json"), "utf8"));
  const policy = JSON.parse(fs.readFileSync(environment.INKVIA_RUNTIME_POLICY, "utf8"));
  if (policy.profile !== "test" || policy.networkMode !== "mock") throw new Error("P0_TEST_RESOURCE_REQUIRED");
  const args = process.argv.slice(2);
  const portIndex = args.findIndex(arg => arg === '-p' || arg === '--port');
  const hasPort = portIndex >= 0;
  const port = hasPort ? Number(args[portIndex + 1]) : 3310;
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || args.some(arg => /^(?:-H|--hostname|--port=|-p=)/.test(arg))) throw new Error('P0_LOOPBACK_ONLY');
  // Empty inherited file settings so Next cannot fall back to production provider keys.
  const loaded = loadEnvConfig(process.cwd(), true);
  for (const key of Object.keys(loaded.parsedEnv || {})) process.env[key] = "";
  const policyPath = path.join(root, "dev-policy.json");
  // Next dev proxies /uploads back to its own HTTP listener. Allow only this preview,
  // never the ordinary local app, arbitrary loopback services, or external providers.
  fs.writeFileSync(policyPath, JSON.stringify({ ...policy, profile: "local", projectRoot: process.cwd(), networkMode: 'explicit-test', allowedTestOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`], testGenerationLimit: 1 }, null, 2));
  Object.assign(process.env, environment, { INKVIA_RUNTIME_PROFILE: "local", INKVIA_RUNTIME_POLICY: policyPath, APP_ROOT_DIR: process.cwd(), NODE_ENV: "development",
    ADMIN_USERNAME: "p0-test-admin", ADMIN_PASSWORD: "p0-test-admin-password", ADMIN_SECRET: "p0-test-only-admin-secret", NEXT_TELEMETRY_DISABLED: "1", TSX_DISABLE_CACHE: "1" });
  const migrated = spawnSync(process.execPath, ["scripts/dev-migrate.cjs"], { stdio: "inherit", env: { ...process.env } });
  if (migrated.status !== 0) throw new Error("P0_PREFLIGHT_FAILED");
  const child = spawn(process.execPath, ["scripts/next-runner.cjs", "dev", args.includes("--with-workers") ? "--with-workers" : "--web-only", "--distDir", ".next-p0", ...(hasPort ? [] : ["-p", "3310"]), ...args.filter(arg => arg !== "--with-workers"), "-H", "127.0.0.1"], { stdio: "inherit", env: { ...process.env } });
  child.on("exit", code => { process.exitCode = code ?? 1; });
  child.on("error", () => { process.exitCode = 1; });
}
main().catch(() => { console.error("P0_DEV_UNAVAILABLE: prepare and verify the independent resource with scripts/prepare-p0-test-runtime.cjs first"); process.exitCode = 1; });
