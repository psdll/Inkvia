const { spawnSync } = require("node:child_process");
const { loadEnvConfig } = require("@next/env");
async function main() {
  const args = process.argv.slice(2);
  const profileIndex = args.indexOf("--profile");
  const profile = profileIndex >= 0 ? args[profileIndex + 1] : process.env.INKVIA_RUNTIME_PROFILE || "local";
  if (!["local", "test"].includes(profile)) throw new Error("ENV_PROFILE_REQUIRED");
  if (profileIndex >= 0) args.splice(profileIndex, 2);
  process.env.INKVIA_RUNTIME_PROFILE = profile;
  if (profile === "test") process.env.NODE_ENV = "test";
  loadEnvConfig(process.cwd(), profile === "local");
  // Verify in a short-lived process so Windows can replace the Prisma engine during generate.
  const check = spawnSync(process.execPath, [require.resolve("./runtime-identity-check.cjs")], { stdio: "inherit", env: { ...process.env } });
  if (check.error || check.status !== 0) throw new Error("ENV_IDENTITY_UNVERIFIED");
  const prisma = require.resolve("prisma/build/index.js");
  const commands = args.length ? [args] : [["migrate", "deploy"], ["generate"]];
  for (const command of commands) {
    const childArgs = command[0] === "generate" ? [require.resolve("./generate-prisma-local.cjs")] : [prisma, ...command];
    const result = spawnSync(process.execPath, childArgs, { stdio: "inherit", env: { ...process.env } });
    if (result.error || result.status !== 0) throw new Error("LOCAL_MIGRATION_FAILED");
  }
}
main().catch((error) => { console.error(error.code || error.message); process.exitCode = 1; });
