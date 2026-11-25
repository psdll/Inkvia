const { spawn } = require("node:child_process");
const { loadEnvConfig } = require("@next/env");
const { prepareRuntime } = require("./lib/runtime-isolation.cjs");
async function main() {
  const [purpose, ...args] = process.argv.slice(2);
  if (!["build", "local", "test", "production"].includes(purpose) || !args.length) throw new Error("ENV_PROFILE_REQUIRED");
  process.env.INKVIA_RUNTIME_PROFILE = purpose;
  if (purpose === "test") process.env.NODE_ENV = "test";
  loadEnvConfig(process.cwd(), purpose === "local");
  await prepareRuntime();
  const target = args.shift();
  const bin = target === "next" ? require.resolve("next/dist/bin/next") : target === "vitest" ? require("node:path").join(require("node:path").dirname(require.resolve("vitest/package.json")), "vitest.mjs") : target;
  const preload = purpose === "build" ? ["--require", require.resolve("./lib/build-boundaries.cjs")] : [];
  const child = spawn(process.execPath, [...preload, bin, ...args], { stdio: "inherit", env: { ...process.env, ...(purpose === "build" ? { NEXT_TELEMETRY_DISABLED: "1" } : {}) } });
  child.on("error", () => { process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
main().catch((error) => { console.error(error.code || "ENV_IDENTITY_UNVERIFIED"); process.exitCode = 1; });
