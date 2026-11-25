const { loadEnvConfig } = require("@next/env");
const { prepareRuntime } = require("./lib/runtime-isolation.cjs");
const args = process.argv.slice(2);
const profileIndex = args.indexOf("--profile");
const profile = profileIndex >= 0 ? args[profileIndex + 1] : process.env.INKVIA_RUNTIME_PROFILE || "local";
if (!["local", "test"].includes(profile)) { console.error("ENV_PROFILE_REQUIRED"); process.exit(1); }
process.env.INKVIA_RUNTIME_PROFILE = profile;
if (profile === "test") process.env.NODE_ENV = "test";
loadEnvConfig(process.cwd(), profile === "local");
prepareRuntime().then((report) => console.log(JSON.stringify(report))).catch((error) => {
  console.error(error.code || "ENV_IDENTITY_UNVERIFIED");
  process.exitCode = 1;
});
