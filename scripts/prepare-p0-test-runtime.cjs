// Creates a NEW disposable local PostgreSQL instance. Never loads .env or reuses a database.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const root = path.resolve(".runtime-local", "p0-test");
const manifestPath = path.join(root, "resource.json");
function docker(args, input) { return execFileSync("docker", args, { encoding: "utf8", input, timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] }).trim(); }
async function main() {
  if (fs.existsSync(manifestPath)) throw new Error("TEST_RESOURCE_ALREADY_EXISTS: inspect the recorded resource; do not overwrite it");
  fs.mkdirSync(root, { recursive: true });
  const instanceId = crypto.randomUUID();
  const containerName = `inkvia-p0-${instanceId.slice(0, 8)}`;
  const ownerPassword = crypto.randomBytes(32).toString("hex");
  const appPassword = crypto.randomBytes(32).toString("hex");
  const containerId = docker(["run", "-d", "--name", containerName, "--label", `inkvia.p0.instance=${instanceId}`, "--memory", "512m", "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${ownerPassword}`, "postgres:16", "-c", `inkvia.instance_id=${instanceId}`]);
  // Record ownership immediately so partial preparation is recoverable without guessing targets.
  fs.writeFileSync(manifestPath, JSON.stringify({ instanceId, containerId, containerName, state: "preparing" }, null, 2), { mode: 0o600 });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { docker(["exec", containerId, "pg_isready", "-U", "postgres"]); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!ready) throw new Error("TEST_DATABASE_NOT_READY");
  docker(["exec", "-i", containerId, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], `CREATE ROLE inkvia_p0_test LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE inkvia_p0_test OWNER inkvia_p0_test;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
`);
  const inspection = JSON.parse(docker(["inspect", containerId]))[0];
  if (inspection.Config.Labels["inkvia.p0.instance"] !== instanceId) throw new Error("TEST_RESOURCE_IDENTITY_MISMATCH");
  const port = inspection.NetworkSettings.Ports["5432/tcp"][0].HostPort;
  const policyPath = path.join(root, "policy.json");
  const writableRoots = ["uploads", "imports", "exports", "scratch"].map(name => path.join(root, name));
  for (const dir of writableRoots) fs.mkdirSync(dir, { recursive: true });
  const policy = { schemaVersion: 1, profile: "test", projectRoot: process.cwd(), database: { endpointId: `127.0.0.1:${port}`, databaseName: "inkvia_p0_test", roleName: "inkvia_p0_test", instanceId }, writableRoots, networkMode: "mock", allowedTestOrigins: [] };
  fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2));
  const keyPath = path.join(root, "password-keys.json");
  fs.writeFileSync(keyPath, JSON.stringify({ "p0-test-v1": crypto.randomBytes(32).toString("base64") }), { mode: 0o600 });
  const environment = { INKVIA_RUNTIME_PROFILE: "test", INKVIA_RUNTIME_POLICY: policyPath, DATABASE_URL: `postgresql://inkvia_p0_test:${appPassword}@127.0.0.1:${port}/inkvia_p0_test?schema=public`, UPLOADS_DIR: writableRoots[0], IMPORTS_DIR: writableRoots[1], EXPORTS_DIR: writableRoots[2], APP_ROOT_DIR: process.cwd(), PASSWORD_CIPHER_KEYRING_FILE: keyPath, PASSWORD_CIPHER_ACTIVE_KEY_ID: "p0-test-v1", NODE_ENV: "test" };
  fs.writeFileSync(path.join(root, "environment.json"), JSON.stringify(environment, null, 2), { mode: 0o600 });
  fs.writeFileSync(manifestPath, JSON.stringify({ instanceId, containerId, containerName, state: "ready", imageId: inspection.Image, createdAt: inspection.Created }, null, 2));
  console.log(JSON.stringify({ profile: "test", state: "ready", resource: "p0-test", policy: ".runtime-local/p0-test/policy.json" }));
}
main().catch(error => { console.error(error.message?.split("\n")[0].replace(/PASSWORD.*/i, "[redacted]")); process.exitCode = 1; });
