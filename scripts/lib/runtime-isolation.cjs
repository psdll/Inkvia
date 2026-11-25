// Shared by launchers and server code. Importing this module performs no I/O.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

class RuntimeIsolationError extends Error {
  constructor(code, category) {
    super(`${code}: ${category}`);
    this.name = "RuntimeIsolationError";
    this.code = code;
  }
}
const fail = (code, category) => { throw new RuntimeIsolationError(code, category); };
const fingerprint = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const within = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};

// Resolve the nearest existing ancestor, including junctions and dangling links.
function realTarget(value) {
  const absolute = path.resolve(value);
  let cursor = absolute;
  const suffix = [];
  for (;;) {
    try {
      fs.lstatSync(cursor);
      return path.resolve(fs.realpathSync.native(cursor), ...suffix.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // A dangling symlink must fail closed, not be treated as an absent directory.
      try { if (fs.lstatSync(cursor).isSymbolicLink()) fail("ENV_PATH_OUTSIDE_ROOT", "dangling-link"); } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) fail("ENV_PATH_OUTSIDE_ROOT", "unresolved-path");
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function databaseTarget(value) {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || url.hash) throw new Error();
    // Disallow connection-target overrides hidden in URL parameters.
    for (const key of url.searchParams.keys()) {
      if (!["schema", "connection_limit", "pool_timeout", "connect_timeout", "sslmode"].includes(key)) throw new Error();
    }
    if (url.searchParams.get("schema") && url.searchParams.get("schema") !== "public") throw new Error();
    return { endpointId: `${url.hostname.toLowerCase()}:${url.port || "5432"}`, databaseName: decodeURIComponent(url.pathname.slice(1)), roleName: decodeURIComponent(url.username) };
  } catch { fail("ENV_TARGET_MISMATCH", "database-url"); }
}

function readRuntimePolicy(env = process.env, cwd = process.cwd()) {
  const profile = env.INKVIA_RUNTIME_PROFILE;
  if (!["local", "test", "build", "production"].includes(profile)) fail("ENV_PROFILE_REQUIRED", "runtime-profile");
  if (profile === "build") return Object.freeze({ schemaVersion: 1, profile, projectRoot: realTarget(cwd), fingerprint: fingerprint({ profile, cwd }) });
  const policyPath = env.INKVIA_RUNTIME_POLICY || path.join(cwd, "config", "local-runtime.json");
  let policy;
  try { policy = JSON.parse(fs.readFileSync(policyPath, "utf8")); } catch { fail("ENV_IDENTITY_UNVERIFIED", "resource-policy"); }
  if (policy.schemaVersion !== 1 || policy.profile !== profile || typeof policy.projectRoot !== "string"
    || !Array.isArray(policy.writableRoots) || policy.writableRoots.length === 0
    || !policy.database || !policy.database.instanceId
    || !["business", "mock", "explicit-test", "production"].includes(policy.networkMode)
    || !Array.isArray(policy.allowedTestOrigins)) fail("ENV_TARGET_MISMATCH", "resource-policy");
  if (profile !== "production" && policy.networkMode === "production") fail("ENV_TARGET_MISMATCH", "network-mode");
  if (profile !== "local" && policy.networkMode === "business") fail("ENV_TARGET_MISMATCH", "network-mode");
  const projectRoot = realTarget(policy.projectRoot);
  // Next standalone changes cwd; APP_ROOT_DIR still names the installed release.
  // Pin that one production directory explicitly instead of accepting arbitrary descendants.
  let runtimeRoot = projectRoot;
  if (policy.runtimeRoot !== undefined) {
    if (profile !== "production" || typeof policy.runtimeRoot !== "string"
      || !path.isAbsolute(policy.runtimeRoot)
      || path.resolve(policy.runtimeRoot) !== path.join(projectRoot, ".next", "standalone")
      || realTarget(policy.runtimeRoot) !== path.resolve(policy.runtimeRoot)) fail("ENV_TARGET_MISMATCH", "runtime-root");
    runtimeRoot = realTarget(policy.runtimeRoot);
  }
  const workingRoot = realTarget(cwd);
  if ((workingRoot !== projectRoot && workingRoot !== runtimeRoot)
    || (env.APP_ROOT_DIR && realTarget(env.APP_ROOT_DIR) !== projectRoot)) fail("ENV_TARGET_MISMATCH", "project-root");
  const actual = databaseTarget(env.DATABASE_URL);
  for (const key of ["endpointId", "databaseName", "roleName"]) {
    if (actual[key] !== policy.database[key]) fail("ENV_TARGET_MISMATCH", `database-${key}`);
  }
  const writableRoots = policy.writableRoots.map((root) => {
    if (typeof root !== "string" || !path.isAbsolute(root)) fail("ENV_PATH_OUTSIDE_ROOT", "root-format");
    const resolved = realTarget(root);
    // Pin canonical roots: a configured junction must not silently authorize its destination.
    if (resolved !== path.resolve(root)) fail("ENV_PATH_OUTSIDE_ROOT", "root-link");
    return resolved;
  });
  const allowedTestOrigins = policy.allowedTestOrigins.map((origin) => {
    try { const url = new URL(origin); if (!/^https?:$/.test(url.protocol) || url.origin !== origin || url.username || url.password) throw new Error(); return origin; }
    catch { fail("ENV_TARGET_MISMATCH", "test-origin"); }
  });
  if (policy.networkMode === "mock" && allowedTestOrigins.length) fail("ENV_TARGET_MISMATCH", "mock-origins");
  if (policy.networkMode === "explicit-test" && !(Number.isSafeInteger(policy.testGenerationLimit) && policy.testGenerationLimit > 0 && policy.testGenerationLimit <= 10000)) fail("ENV_TARGET_MISMATCH", "test-generation-limit");
  const snapshot = { ...policy, projectRoot, writableRoots, allowedTestOrigins, database: { ...policy.database }, fingerprint: fingerprint(policy) };
  Object.freeze(snapshot.database); Object.freeze(writableRoots); Object.freeze(allowedTestOrigins);
  Object.freeze(snapshot);
  assertWritablePath(env.UPLOADS_DIR || path.join(projectRoot, "public", "uploads"), snapshot);
  return snapshot;
}

function assertWritablePath(target, policy = getRuntimePolicy()) {
  if (policy.profile === "build") fail("BUILD_EXTERNAL_IO_DENIED", "file-write");
  if (typeof target !== "string" && !(target instanceof URL) && !Buffer.isBuffer(target)) fail("ENV_PATH_OUTSIDE_ROOT", "file-descriptor");
  const value = target instanceof URL ? require("node:url").fileURLToPath(target) : String(target);
  const actual = realTarget(value);
  if (!policy.writableRoots.some((root) => realTarget(root) === root && within(root, actual))) fail("ENV_PATH_OUTSIDE_ROOT", "file-write");
  return actual;
}

function assertNetworkTarget(target, policy = getRuntimePolicy()) {
  if (policy.profile === "build") fail("BUILD_EXTERNAL_IO_DENIED", "network");
  let url;
  try { url = new URL(String(target)); } catch { fail("ENV_EGRESS_DENIED", "invalid-url"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) fail("ENV_EGRESS_DENIED", "url-protocol");
  if (policy.profile === "local" && policy.networkMode === "business") return;
  if (policy.profile === "production" && policy.networkMode === "production") return;
  if (policy.networkMode !== "explicit-test" || !policy.allowedTestOrigins.includes(url.origin)) fail("ENV_EGRESS_DENIED", "network-origin");
}

let cached;
let configSignature;
function currentSignature() {
  return fingerprint([process.env.INKVIA_RUNTIME_PROFILE, process.env.INKVIA_RUNTIME_POLICY, process.env.DATABASE_URL, process.env.UPLOADS_DIR, process.env.APP_ROOT_DIR, process.cwd()]);
}
function getRuntimePolicy() {
  if (!cached) { cached = readRuntimePolicy(); configSignature = currentSignature(); }
  if (currentSignature() !== configSignature) fail("ENV_TARGET_MISMATCH", "configuration-changed");
  return cached;
}

const identitySql = `SELECT current_database() AS "databaseName", current_user AS "roleName",
  COALESCE(current_setting('inkvia.instance_id', true), current_setting('ai_stools.instance_id', true)) AS "instanceId",
  r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls AS "privileged",
  EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AS "memberOfRole",
  EXISTS (SELECT 1 FROM pg_database d WHERE d.datname <> current_database() AND NOT d.datistemplate
    AND has_database_privilege(current_user, d.oid, 'CONNECT')) AS "otherDatabaseAccess"
  FROM pg_roles r WHERE r.rolname = current_user`;

const verifiedPolicies = new WeakSet();
function assertRuntimeVerified(policy = getRuntimePolicy()) {
  if (!verifiedPolicies.has(policy)) fail("ENV_IDENTITY_UNVERIFIED", "side-effect-before-preflight");
}

async function verifyDatabaseIdentity(client, policy = getRuntimePolicy()) {
  if (policy.profile === "build") fail("BUILD_EXTERNAL_IO_DENIED", "database");
  let rows;
  try { rows = await client.$queryRawUnsafe(identitySql); } catch { fail("ENV_IDENTITY_UNVERIFIED", "database-identity"); }
  const row = rows?.[0];
  if (!row || ["databaseName", "roleName", "instanceId"].some((key) => row[key] !== policy.database[key])) fail("ENV_IDENTITY_UNVERIFIED", "database-identity");
  if (policy.profile !== "production" && (row.privileged || row.memberOfRole || row.otherDatabaseAccess)) fail("ENV_IDENTITY_UNVERIFIED", "database-permissions");
  verifiedPolicies.add(policy);
  return { profile: policy.profile, fingerprint: policy.fingerprint, database: "verified", permissions: "verified" };
}

// Wrap connection and transaction entry too: query extensions alone run after BEGIN.
function guardPrismaClient(base, policy = undefined) {
  let ready;
  const ensureReady = () => {
    const snapshot = policy || getRuntimePolicy();
    if (!ready) ready = verifyDatabaseIdentity(base, snapshot);
    return ready;
  };
  const extended = base.$extends({ name: "runtime-isolation", query: {
    async $allOperations({ args, query }) { await ensureReady(); return query(args); },
  } });
  return new Proxy(extended, { get(target, key, receiver) {
    if (key === "$connect") return async () => { await ensureReady(); return base.$connect(); };
    if (key === "$transaction") return async (...args) => { await ensureReady(); return target.$transaction(...args); };
    return Reflect.get(target, key, receiver);
  } });
}

function createGuardedPrismaClient(options) {
  const policy = getRuntimePolicy();
  if (options?.datasources?.db?.url && fingerprint(databaseTarget(options.datasources.db.url)) !== fingerprint(databaseTarget(process.env.DATABASE_URL))) fail("ENV_TARGET_MISMATCH", "database-override");
  const { PrismaClient } = require("@prisma/client");
  require("./runtime-boundaries.cjs").installRuntimeBoundaries();
  return guardPrismaClient(new PrismaClient(options), policy);
}

async function prepareRuntime() {
  const policy = getRuntimePolicy();
  if (policy.profile === "build") return { profile: "build", fingerprint: policy.fingerprint, database: "disabled" };
  const { PrismaClient } = require("@prisma/client");
  const client = new PrismaClient();
  try { return await verifyDatabaseIdentity(client, policy); } finally { await client.$disconnect(); }
}

module.exports = { RuntimeIsolationError, readRuntimePolicy, getRuntimePolicy, assertWritablePath, assertNetworkTarget, assertRuntimeVerified, verifyDatabaseIdentity, guardPrismaClient, createGuardedPrismaClient, prepareRuntime, realTarget, within };
